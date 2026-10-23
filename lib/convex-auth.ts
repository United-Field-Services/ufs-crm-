import {env} from 'cloudflare:workers';
import {headers} from 'next/headers';
import {AppError,isEmployeeRole,jsonBody,loginEligibleSql,sameOrigin,scopeOf,TEST_SCOPE,type Employee} from './policy';
import {authFailure,authResult,authStatus,rateLimit,readAuthCookies,revokePresentedSession,tokenFingerprint} from './standalone-auth';
import {convexConfigured,convexUrls} from './auth-provider';
import {database as pickDatabase} from './database';

// Convex Auth as a sign-in provider. The browser never talks to Convex: this server signs people in
// through Convex's HTTP API, verifies the signed tokens it gets back, and keeps them in HttpOnly
// cookies exactly like the Supabase flow. Access is still decided here: a person needs an
// approved binding (issuer + Convex user id) to a current, eligible employee record.

const MAX_AGE=12*60*60,IDLE_SECONDS=30*60,JWKS_TTL_MS=10*60*1000;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBJECT=/^([A-Za-z0-9_-]{16,64})\|([A-Za-z0-9_-]{16,64})$/;
const unavailable=()=>new AppError('Sign-in is temporarily unavailable.',503);
const signInAgain=()=>new AppError('Sign in again.',401);
function database(){try{return pickDatabase()}catch{throw unavailable()}}

// ---------- Convex HTTP API ----------
type Tokens={token:string;refreshToken:string};
type CallResult<T>={ok:true;value:T}|{ok:false};
export async function convexCall<T>(kind:'action'|'mutation'|'query',path:string,args:Record<string,unknown>,token?:string):Promise<CallResult<T>>{
 const urls=convexConfigured()?convexUrls():null;if(!urls)throw new AppError('Employee sign-in is not available yet.',503);
 let body:{status?:string;value?:unknown}|null;
 try{
  const response=await fetch(`${urls.cloud}/api/${kind}`,{method:'POST',cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({path,args,format:'json'})});
  // Never follow a redirect (the edge runtime has no "error" mode, so a 3xx is treated as a failure).
  if(response.status>=300&&response.status<400)throw unavailable();
  body=await response.json() as {status?:string;value?:unknown}|null;
 }catch{throw unavailable()}
 if(!body||typeof body!=='object')throw unavailable();
 // Convex reports a rejected sign-in as status "error". Its message is never passed on: it can tell
 // an unknown address from a wrong password.
 if(body.status==='success')return {ok:true,value:body.value as T};
 if(body.status==='error')return {ok:false};
 throw unavailable();
}
export function tokensFrom(value:unknown):Tokens|null{
 const t=(value as {tokens?:Partial<Tokens>|null}|null)?.tokens;
 return t&&typeof t.token==='string'&&typeof t.refreshToken==='string'&&t.token&&t.refreshToken?{token:t.token,refreshToken:t.refreshToken}:null;
}
// Convex refresh tokens contain a "|", which the cookie rules here do not allow, so they are stored encoded.
const encodeRefresh=(raw:string)=>btoa(String.fromCharCode(...new TextEncoder().encode(raw))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function decodeRefresh(value:string){try{return new TextDecoder().decode(bytesFromBase64Url(value))}catch{return null}}
const sessionCookies=(t:Tokens)=>({access_token:t.token,refresh_token:encodeRefresh(t.refreshToken)});

// ---------- Token verification (RS256, keys fetched from the deployment) ----------
function bytesFromBase64Url(value:string){
 const padded=value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4);
 return Uint8Array.from(atob(padded),c=>c.charCodeAt(0));
}
type SigningKey={kty:string;n:string;e:string;kid?:string};
let keyCache:{at:number;site:string;keys:SigningKey[]}|null=null;
async function signingKeys(site:string,refetch=false):Promise<SigningKey[]>{
 if(!refetch&&keyCache&&keyCache.site===site&&Date.now()-keyCache.at<JWKS_TTL_MS)return keyCache.keys;
 let body:{keys?:unknown}|null;
 try{
  const response=await fetch(`${site}/.well-known/jwks.json`,{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw unavailable();
  body=await response.json() as {keys?:unknown}|null;
 }catch{throw unavailable()}
 const list=Array.isArray(body?.keys)?body!.keys as Partial<SigningKey>[]:[];
 const keys=list.filter((k):k is SigningKey=>!!k&&k.kty==='RSA'&&typeof k.n==='string'&&typeof k.e==='string').slice(0,10);
 if(!keys.length)throw unavailable();
 keyCache={at:Date.now(),site,keys};return keys;
}
export function resetConvexKeyCache(){keyCache=null}
type Claims={sub:string;iss:string;aud:unknown;iat:number;exp:number};
async function signatureMatches(keys:SigningKey[],kid:string|undefined,signed:Uint8Array,signature:Uint8Array){
 for(const jwk of keys){
  if(kid&&jwk.kid&&jwk.kid!==kid)continue;
  try{
   const key=await crypto.subtle.importKey('jwk',{kty:'RSA',n:jwk.n,e:jwk.e,alg:'RS256',ext:true},{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
   if(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,signature as BufferSource,signed as BufferSource))return true;
  }catch{/* try the next key */}
 }
 return false;
}
export async function verifyConvexToken(token:string):Promise<{claims:Claims;userId:string;sessionId:string}>{
 const urls=convexConfigured()?convexUrls():null;if(!urls)throw new AppError('Employee sign-in is not available yet.',503);
 if(token.length>4000||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw signInAgain();
 const [h,p,s]=token.split('.');
 let header:{alg?:unknown;kid?:unknown},claims:Partial<Claims>;
 try{header=JSON.parse(new TextDecoder().decode(bytesFromBase64Url(h)));claims=JSON.parse(new TextDecoder().decode(bytesFromBase64Url(p)))}catch{throw signInAgain()}
 // Only RS256 is accepted; "none" and any other algorithm are rejected before any key is used.
 if(header.alg!=='RS256')throw signInAgain();
 const kid=typeof header.kid==='string'?header.kid:undefined,signed=new TextEncoder().encode(`${h}.${p}`),signature=bytesFromBase64Url(s);
 let ok=await signatureMatches(await signingKeys(urls.site),kid,signed,signature);
 // A rotated key is picked up once per bad signature, not on every request.
 if(!ok)ok=await signatureMatches(await signingKeys(urls.site,true),kid,signed,signature);
 if(!ok)throw signInAgain();
 const now=Math.floor(Date.now()/1000);
 const audience=Array.isArray(claims.aud)?claims.aud.includes('convex'):claims.aud==='convex';
 if(claims.iss!==urls.site||!audience||typeof claims.exp!=='number'||!Number.isFinite(claims.exp)||claims.exp<=now||typeof claims.iat!=='number'||!Number.isFinite(claims.iat)||claims.iat>now+30||typeof claims.sub!=='string')throw signInAgain();
 const parts=SUBJECT.exec(claims.sub);if(!parts)throw signInAgain();
 return {claims:claims as Claims,userId:parts[1],sessionId:parts[2]};
}

// ---------- Who the token belongs to ----------
export type ConvexIdentity={issuer:string;subject:string;sessionId:string;employee:Employee;accessToken:string};
const deniedAccount=()=>new AppError('Your employee account is unavailable. Contact your administrator to review access.',403);
export async function convexVerifyIdentity(accessToken:string,{registerSession=false}:{registerSession?:boolean}={}):Promise<ConvexIdentity>{
 const urls=convexConfigured()?convexUrls():null;if(!urls)throw new AppError('Employee sign-in is not available yet.',503);
 const {claims,userId,sessionId}=await verifyConvexToken(accessToken),issuer=urls.site,now=Math.floor(Date.now()/1000);
 // Optional, exact, owner-approved one-time bootstrap. An existing binding, even a disabled one, is never replaced.
 if(registerSession&&userId===env.UFS_CONVEX_OWNER_SUB&&UUID.test(env.UFS_CONVEX_OWNER_EMPLOYEE_ID||'')){
  await database().batch([
   database().prepare(`INSERT OR IGNORE INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) SELECT ?,?,?,e.id,1,?,? FROM employees e WHERE e.id=? AND e.role='admin' AND e.data_scope='live' AND e.user_id IS NOT NULL AND ${loginEligibleSql('e')}`).bind(crypto.randomUUID(),issuer,userId,new Date().toISOString(),'explicit-owner-runtime-approval',env.UFS_CONVEX_OWNER_EMPLOYEE_ID),
   database().prepare("INSERT INTO audit (id,actor_id,action,target_id,created_at) SELECT ?,?,'Bound approved standalone owner identity',?,? WHERE changes()=1").bind(crypto.randomUUID(),env.UFS_CONVEX_OWNER_EMPLOYEE_ID,env.UFS_CONVEX_OWNER_EMPLOYEE_ID,new Date().toISOString()),
  ]);
 }
 const employee=await database().prepare(`SELECT e.* FROM employee_identities i JOIN employees e ON e.id=i.employee_id WHERE i.issuer=? AND i.subject=? AND i.enabled=1 AND ${loginEligibleSql('e')}`).bind(issuer,userId).first<Employee>();
 if(!employee||!isEmployeeRole(employee.role))throw deniedAccount();
 // The isolated test scope belongs to the Supabase setup and is not available through Convex.
 if(scopeOf(employee)===TEST_SCOPE)throw deniedAccount();
 // App session ledger: logout and password reset revoke here immediately, even though a token stays valid until it expires.
 const guard='NOT EXISTS (SELECT 1 FROM auth_password_resets WHERE issuer=? AND subject=? AND (locked=1 OR not_before>=?))';
 if(registerSession)await database().prepare(`INSERT OR IGNORE INTO auth_sessions (session_id,issuer,subject,employee_id,created_at,last_seen) SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(sessionId,issuer,userId,employee.id,now,now,issuer,userId,claims.iat).run();
 const touched=await database().prepare(`UPDATE auth_sessions SET last_seen=? WHERE session_id=? AND issuer=? AND subject=? AND employee_id=? AND revoked_at IS NULL AND created_at>? AND last_seen>? AND ${guard}`).bind(now,sessionId,issuer,userId,employee.id,now-MAX_AGE,now-IDLE_SECONDS,issuer,userId,claims.iat).run();
 if(!touched.meta.changes)throw new AppError('Your session expired. Sign in again.',401);
 await database().prepare('INSERT OR IGNORE INTO auth_session_tokens (token_hash,session_id,created_at) VALUES (?,?,?)').bind(await tokenFingerprint(accessToken),sessionId,now).run();
 return {issuer,subject:userId,sessionId,employee,accessToken};
}
export async function convexRequestIdentity(req:Request){const {accessToken}=readAuthCookies(req.headers);if(!accessToken)throw signInAgain();return convexVerifyIdentity(accessToken)}
export async function convexEmployee():Promise<Employee>{const {accessToken}=readAuthCookies(await headers());if(!accessToken)throw new AppError('Sign in to your employee account.',401);return (await convexVerifyIdentity(accessToken)).employee}

// ---------- Route handlers ----------
async function endConvexSession(accessToken:string|null,refreshCookie:string|null){
 // Best effort: the app session is already revoked. Returns true when Convex confirmed the sign-out.
 try{
  let token=accessToken;
  if(token){const r=await convexCall('action','auth:signOut',{},token);if(r.ok)return true}
  const raw=refreshCookie?decodeRefresh(refreshCookie):null;
  if(raw){
   const refreshed=await convexCall<unknown>('action','auth:signIn',{refreshToken:raw});
   token=refreshed.ok?tokensFrom(refreshed.value)?.token??null:null;
   if(token)return (await convexCall('action','auth:signOut',{},token)).ok;
  }
 }catch{/* reported as incomplete */}
 return false;
}
export async function convexLogin(req:Request){try{
 sameOrigin(req);if(!req.headers.get('content-type')?.startsWith('application/json'))throw new AppError('Use the sign-in form.',415);
 const b=await jsonBody(req),email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
 if(!EMAIL.test(email)||email.length>254||typeof b.password!=='string'||b.password.length<1||b.password.length>1024)throw new AppError('Check your email and password.',400);
 await rateLimit(req,email);
 const result=await convexCall<unknown>('action','auth:signIn',{provider:'password',params:{email,password:b.password,flow:'signIn'}});
 b.password='';
 const tokens=result.ok?tokensFrom(result.value):null;
 // One message for an unknown address, a wrong password and a locked-out account.
 if(!tokens)throw new AppError('Check your email and password, or contact your administrator.',401);
 try{const identity=await convexVerifyIdentity(tokens.token,{registerSession:true});return authResult(await authStatus(identity),200,sessionCookies(tokens))}
 catch(error){await convexCall('action','auth:signOut',{},tokens.token).catch(()=>undefined);throw error}
 }catch(error){return authFailure(error)}}
export async function convexRefresh(req:Request){try{
 sameOrigin(req);const {refreshToken}=readAuthCookies(req.headers),raw=refreshToken?decodeRefresh(refreshToken):null;
 if(!raw)throw signInAgain();
 const result=await convexCall<unknown>('action','auth:signIn',{refreshToken:raw}),tokens=result.ok?tokensFrom(result.value):null;
 if(!tokens)throw new AppError('Your session expired. Sign in again.',401);
 const identity=await convexVerifyIdentity(tokens.token);
 return authResult(await authStatus(identity),200,sessionCookies(tokens));
 }catch(error){return authFailure(error)}}
export async function convexLogout(req:Request){try{
 sameOrigin(req);
 // Only a hash of a token previously verified for this app can revoke a session. This grants no
 // access and works with expired tokens and while Convex is unreachable.
 await revokePresentedSession(req);
 const {accessToken,refreshToken}=readAuthCookies(req.headers);
 const providerSignOutComplete=await endConvexSession(accessToken,refreshToken);
 return authResult({ok:true,providerSignOutComplete},200,undefined,true);
 }catch(error){return authFailure(error)}}
