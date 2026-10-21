import {approvedQaConfiguration,provisionApprovedTestProfiles} from './test-scope-setup';
import {env} from 'cloudflare:workers';
import {headers} from 'next/headers';
import {createClient,type Session,type SupabaseClient,type User} from '@supabase/supabase-js';
import {AppError,scopeOf,TEST_SCOPE,isEmployeeRole,loginEligibleSql,employmentEligibleSql,type Employee} from './policy';
import {authProvider,convexConfigured} from './auth-provider';

export const SUPABASE_URL='https://ycswaipyuonxwyalkits.supabase.co';
export const SUPABASE_ISSUER=SUPABASE_URL+'/auth/v1';
export const ACCESS_COOKIE='__Host-ufs-access';
export const REFRESH_COOKIE='__Host-ufs-refresh';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AGE=12*60*60,IDLE_SECONDS=30*60;
export function standaloneMode(){return env.UFS_AUTH_MODE==='pilot'||env.UFS_AUTH_MODE==='standalone'}
export function standaloneConfigured(){if(authProvider()==='convex')return convexConfigured();return standaloneMode()&&env.UFS_SUPABASE_URL===SUPABASE_URL&&!!env.UFS_SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')&&env.UFS_SUPABASE_SESSION_CHECK==='enabled'&&(!publicPilotEnabled()||publicPilotDeadline()!==null)}
function database(){if(!env.DB)throw new AppError('Sign-in is temporarily unavailable.',503);return env.DB}
export function newAuthClient(accessToken?:string):SupabaseClient{
 if(!standaloneConfigured())throw new AppError('Employee sign-in is not available yet.',503);
 return createClient(SUPABASE_URL,env.UFS_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,flowType:'pkce'},global:{...(accessToken?{headers:{Authorization:`Bearer ${accessToken}`}}:{}),fetch:(input,init)=>fetch(input,{...init,cache:'no-store'})}});
}
export function readAuthCookies(h:Headers){
 const all=h.get('cookie')||'';const values=new Map<string,string>();
 for(const part of all.split(';')){const at=part.indexOf('=');if(at<0)continue;const key=part.slice(0,at).trim();if(key!==ACCESS_COOKIE&&key!==REFRESH_COOKIE)continue;if(values.has(key))throw new AppError('Sign in again.',401);const v=part.slice(at+1).trim();if(v.length>8192||!/^[A-Za-z0-9_.-]*$/.test(v))throw new AppError('Sign in again.',401);values.set(key,v)}
 return {accessToken:values.get(ACCESS_COOKIE)||null,refreshToken:values.get(REFRESH_COOKIE)||null};
}
export function authCookieHeaders(session?:Pick<Session,'access_token'|'refresh_token'>){
 const result=new Headers({'Cache-Control':'no-store, private','Pragma':'no-cache','Vary':'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
 for(const [key,value] of [[ACCESS_COOKIE,session?.access_token],[REFRESH_COOKIE,session?.refresh_token]]){
  if(value&&(!/^[A-Za-z0-9_.-]+$/.test(value)||value.length>3800))throw new AppError('Sign-in is temporarily unavailable.',503);
  result.append('Set-Cookie',`${key}=${value||''}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${value?MAX_AGE:0}`);
 }
 return result;
}
export type VerifiedIdentity={issuer:string;subject:string;sessionId:string;aal:'aal1'|'aal2';user:User;employee:Employee;client:SupabaseClient;accessToken:string};
// Public pilot is a separately approved, two-account scope. It never enables
// legacy ChatGPT fallback, and remains restricted to these identities.
// The public-pilot limits belong to the Supabase setup; the Convex provider relies on identity bindings alone.
export const publicPilotEnabled=()=>authProvider()!=='convex'&&(env.UFS_AUTH_MODE==='standalone'||env.UFS_AUTH_PUBLIC_PILOT_UNTIL!==undefined);
export const approvedPilotSubject=(subject:string)=>UUID.test(subject)&&(subject===env.UFS_SUPABASE_OWNER_SUB||subject===env.UFS_SUPABASE_ADDITIONAL_ADMIN_SUB);
// Disabled until exact identities and bindings receive separate approval. These
// subjects never inherit legacy sign-in.
export function approvedTestSubjectRole(subject:string):'employee'|'hr_manager'|null{
 const config=approvedQaConfiguration();if(!config)return null;
 return subject===config.employeeSubject?'employee':subject===config.hrSubject?'hr_manager':null;
}
function approvedExpiry(until:string|undefined){
 if(!until||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(until))return null;
 const expiresAt=Date.parse(until);
 return Number.isFinite(expiresAt)&&new Date(expiresAt).toISOString()===until?expiresAt:null;
}
function publicPilotDeadline(){
 if(env.UFS_AUTH_MODE!=='standalone')return null;
 const expiresAt=approvedExpiry(env.UFS_AUTH_PUBLIC_PILOT_UNTIL);
 // A runtime typo or later date cannot extend the owner's approved exception.
 return expiresAt!==null&&expiresAt<=Date.parse('2026-10-13T01:35:00.000Z')?expiresAt:null;
}
// Password-only sign-in for every role (owner request, 2026-10-15). Password verification,
// identity bindings, role checks and session revocation remain required; the authenticator flow was removed.
export async function verifyIdentity(accessToken:string,{registerSession=false}:{registerSession?:boolean}={}):Promise<VerifiedIdentity>{
 const client=newAuthClient(accessToken);
 const {data:claimData,error:claimError}=await client.auth.getClaims(accessToken);
 if(claimError||!claimData?.claims)throw new AppError('Sign in again.',401);
 const c=claimData.claims,now=Math.floor(Date.now()/1000);
 if(c.iss!==SUPABASE_ISSUER||c.aud!=='authenticated'||c.role!=='authenticated'||!UUID.test(c.sub)||!UUID.test(String(c.session_id))||c.is_anonymous!==false||!Number.isFinite(c.exp)||c.exp<=now||!Number.isFinite(c.iat)||c.iat>now+30||(c.aal!=='aal1'&&c.aal!=='aal2')||!Array.isArray(c.amr)||!(c.amr as unknown[]).some(m=>!!m&&typeof m==='object'&&'method' in m&&m.method==='password'))throw new AppError('Sign in again.',401);
 if(publicPilotEnabled()&&!approvedPilotSubject(c.sub)&&!approvedTestSubjectRole(c.sub))throw new AppError('Your employee account is unavailable. Contact your administrator to review access.',403);
 // Fresh user state plus a bounded DB-backed self-session check are deliberate.
 // JWT verification alone cannot provide immediate revocation guarantees.
 const {data:userData,error:userError}=await client.auth.getUser(accessToken);
 if(userError||!userData?.user||userData.user.id!==c.sub||userData.user.is_anonymous||!userData.user.email_confirmed_at)throw new AppError('Sign in again.',401);
 const {data:live,error:liveError}=await client.rpc('ufs_session_is_active');
 if(liveError)throw new AppError('Sign-in verification is temporarily unavailable.',503);
 if(live!==true)throw new AppError('Sign in again.',401);
 if(c.aal==='aal2'&&!(c.amr as unknown[]).some(m=>!!m&&typeof m==='object'&&'method' in m&&m.method==='totp'))throw new AppError('Authenticator verification is required.',401);
 const currentUser=userData.user as User & {banned_until?:string;deleted_at?:string};if(currentUser.deleted_at||(currentUser.banned_until&&Date.parse(currentUser.banned_until)>Date.now()))throw new AppError('Sign in again.',401);
 // Optional, exact, owner-approved one-time bootstrap. Existing bindings, even
 // disabled ones, are immutable here and can never be replaced/reactivated.
 if(registerSession&&c.sub===env.UFS_SUPABASE_OWNER_SUB&&UUID.test(env.UFS_SUPABASE_OWNER_EMPLOYEE_ID||'')){
  await database().batch([
   database().prepare(`INSERT OR IGNORE INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) SELECT ?,?,?,e.id,1,?,? FROM employees e WHERE e.id=? AND e.role='admin' AND e.data_scope='live' AND e.user_id IS NOT NULL AND ${loginEligibleSql('e')}`).bind(crypto.randomUUID(),SUPABASE_ISSUER,c.sub,new Date().toISOString(),'explicit-owner-runtime-approval',env.UFS_SUPABASE_OWNER_EMPLOYEE_ID),
   database().prepare("INSERT INTO audit (id,actor_id,action,target_id,created_at) SELECT ?,?,'Bound approved standalone owner identity',?,? WHERE changes()=1").bind(crypto.randomUUID(),env.UFS_SUPABASE_OWNER_EMPLOYEE_ID,env.UFS_SUPABASE_OWNER_EMPLOYEE_ID,new Date().toISOString()),
  ]);
 }
 // Separately approved second admin: only this exact pending profile can be
 // promoted, and only in the same transaction as its FIRST identity binding.
 // A disabled/conflicting row, later demotion or deactivation is never undone.
 if(registerSession&&c.sub===env.UFS_SUPABASE_ADDITIONAL_ADMIN_SUB&&env.UFS_SUPABASE_ADDITIONAL_ADMIN_EMPLOYEE_ID){
  const target=env.UFS_SUPABASE_ADDITIONAL_ADMIN_EMPLOYEE_ID,auditId=crypto.randomUUID(),timestamp=new Date().toISOString();
  await database().batch([
   database().prepare(`INSERT OR IGNORE INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) SELECT ?,?,?,e.id,1,?,? FROM employees e WHERE e.id=? AND e.role='employee' AND e.data_scope='live' AND e.active=0 AND e.user_id IS NULL AND e.demo=0 AND ${employmentEligibleSql('e')}`).bind(crypto.randomUUID(),SUPABASE_ISSUER,c.sub,timestamp,'explicit-additional-admin-runtime-approval',target),
   database().prepare("INSERT INTO audit (id,actor_id,action,target_id,created_at) SELECT ?,?,'Activated approved standalone super-admin identity',?,? WHERE changes()=1").bind(auditId,env.UFS_SUPABASE_OWNER_EMPLOYEE_ID||target,target,timestamp),
   database().prepare("UPDATE employees SET role='admin',active=1 WHERE id=? AND role='employee' AND active=0 AND EXISTS (SELECT 1 FROM audit WHERE id=? AND target_id=?)").bind(target,auditId,target),
  ]);
 }
 if(registerSession&&approvedTestSubjectRole(c.sub))await provisionApprovedTestProfiles(SUPABASE_ISSUER,c.sub,userData.user.email||'');
 const employee=await database().prepare(`SELECT e.* FROM employee_identities i JOIN employees e ON e.id=i.employee_id WHERE i.issuer=? AND i.subject=? AND i.enabled=1 AND ${loginEligibleSql('e')}`).bind(SUPABASE_ISSUER,c.sub).first<Employee>();
 if(!employee||!isEmployeeRole(employee.role))throw new AppError('Your employee account is unavailable. Contact your administrator to review access.',403);
 const testRole=approvedTestSubjectRole(c.sub);
 if(scopeOf(employee)===TEST_SCOPE?(!testRole||employee.role!==testRole||employee.user_id!==null):!!testRole)throw new AppError('Your employee account is unavailable. Contact your administrator to review access.',403);
 // Refresh advances JWT iat, but must not erase the original password-auth cutoff.
 const passwordAt=Math.max(0,...(c.amr as {method?:string;timestamp?:number}[]).filter(m=>!!m&&typeof m==='object'&&m.method==='password'&&Number.isFinite(m.timestamp)).map(m=>m.timestamp!));
 const credentialAt=Math.min(c.iat,passwordAt);
 const sessionId=String(c.session_id);
 if(registerSession)await database().prepare('INSERT OR IGNORE INTO auth_sessions (session_id,issuer,subject,employee_id,created_at,last_seen) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM auth_password_resets WHERE issuer=? AND subject=? AND (locked=1 OR not_before>=?))').bind(sessionId,SUPABASE_ISSUER,c.sub,employee.id,now,now,SUPABASE_ISSUER,c.sub,credentialAt).run();
 const touched=await database().prepare('UPDATE auth_sessions SET last_seen=? WHERE session_id=? AND issuer=? AND subject=? AND employee_id=? AND revoked_at IS NULL AND created_at>? AND last_seen>? AND NOT EXISTS (SELECT 1 FROM auth_password_resets WHERE issuer=? AND subject=? AND (locked=1 OR not_before>=?))').bind(now,sessionId,SUPABASE_ISSUER,c.sub,employee.id,now-MAX_AGE,now-IDLE_SECONDS,SUPABASE_ISSUER,c.sub,credentialAt).run();
 if(!touched.meta.changes)throw new AppError('Your session expired. Sign in again.',401);
 await database().prepare('INSERT OR IGNORE INTO auth_session_tokens (token_hash,session_id,created_at) VALUES (?,?,?)').bind(await tokenFingerprint(accessToken),sessionId,now).run();
 return {issuer:SUPABASE_ISSUER,subject:c.sub,sessionId,aal:c.aal as 'aal1'|'aal2',user:userData.user,employee,client,accessToken};
}
export async function standaloneEmployee():Promise<Employee>{const h=await headers(),{accessToken}=readAuthCookies(h);if(!accessToken)throw new AppError('Sign in to your employee account.',401);return (await verifyIdentity(accessToken)).employee}
export async function authStatus(identity:Pick<VerifiedIdentity,'employee'>){
 return {ok:true,enabled:true,...(scopeOf(identity.employee)===TEST_SCOPE?{testMode:true}:{}),authenticated:true};
}
export async function requestIdentity(req:Request){const {accessToken}=readAuthCookies(req.headers);if(!accessToken)throw new AppError('Sign in again.',401);return verifyIdentity(accessToken)}
export async function restoreClientSession(client:SupabaseClient,req:Request){const {accessToken,refreshToken}=readAuthCookies(req.headers);if(!accessToken||!refreshToken)throw new AppError('Sign in again.',401);const {error}=await client.auth.setSession({access_token:accessToken,refresh_token:refreshToken});if(error)throw new AppError('Sign in again.',401)}
export async function revokeLocalSession(sessionId:string){await database().prepare('UPDATE auth_sessions SET revoked_at=? WHERE session_id=?').bind(Math.floor(Date.now()/1000),sessionId).run()}
export async function rateLimit(req:Request,identity:string,kind='login'){
 const now=Math.floor(Date.now()/1000),window=Math.floor(now/900)*900;
 const ip=req.headers.get('cf-connecting-ip')||'unknown';
 for(const [label,value,limit] of [['network',ip,40],['identity',identity,10]] as const){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${kind}:${label}:${value}`));
  const key=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  await database().prepare('INSERT INTO auth_rate_limits (key,window_start,attempts) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start=? THEN attempts+1 ELSE 1 END,window_start=?').bind(key,window,window,window).run();
  const row=await database().prepare('SELECT attempts FROM auth_rate_limits WHERE key=? AND window_start=?').bind(key,window).first<{attempts:number}>();
  if(!row||row.attempts>limit)throw new AppError('Too many sign-in attempts. Please try again later.',429);
 }
}
export function authResult(body:unknown,status=200,session?:Pick<Session,'access_token'|'refresh_token'>,clear=false){return Response.json(body,{status,headers:session||clear?authCookieHeaders(session):{'Cache-Control':'no-store, private','Pragma':'no-cache','Vary':'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}})}
export function authFailure(error:unknown){return authResult({error:error instanceof AppError?error.message:'Sign-in is temporarily unavailable.'},error instanceof AppError?error.status:503)}

export async function tokenFingerprint(token:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}
export async function revokePresentedSession(req:Request){const {accessToken}=readAuthCookies(req.headers);if(!accessToken)return;await database().prepare('UPDATE auth_sessions SET revoked_at=? WHERE session_id IN (SELECT session_id FROM auth_session_tokens WHERE token_hash=?)').bind(Math.floor(Date.now()/1000),await tokenFingerprint(accessToken)).run()}

