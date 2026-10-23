import {env} from 'cloudflare:workers';
import {database} from './database';
import {AppError,jsonBody,sameOrigin,loginEligibleSql,isEmployeeRole,scopeOf,TEST_SCOPE,type Employee} from './policy';
import {authResult,authFailure,newAuthClient,rateLimit,SUPABASE_ISSUER,publicPilotEnabled,approvedPilotSubject,approvedTestSubjectRole,standaloneConfigured} from './standalone-auth';

// Exact, query-free destinations only. Never accept a client redirect/next parameter.
export const RESET_ORIGINS=['http://localhost:5173','https://ufs-people.artman79.chatgpt.site'] as const;
export const RESET_NOTICE='If an eligible account matches that email, you will receive a password reset link. Check your inbox and spam folder.';
export function passwordRecoveryConfigured(){return standaloneConfigured()&&env.UFS_PASSWORD_RECOVERY==='enabled'}
const INVALID_LINK='This reset link is invalid, expired, or already used. Request a new link.';
function destination(req:Request){const origin=new URL(req.url).origin;if(!(RESET_ORIGINS as readonly string[]).includes(origin))throw new AppError('Password reset is unavailable on this address.',403);return origin+'/reset-password'}
async function input(req:Request){sameOrigin(req);if(!passwordRecoveryConfigured())throw new AppError('Password reset is not enabled yet. Contact your UFS administrator.',503);destination(req);if(!req.headers.get('content-type')?.startsWith('application/json'))throw new AppError('Use the password reset form.',415);return jsonBody(req)}
async function eligible(subjectOrEmail:string,byEmail=false){
 try{database()}catch{throw new AppError('Password reset is temporarily unavailable.',503)}
 const row=await database().prepare(`SELECT e.*,i.subject FROM employee_identities i JOIN employees e ON e.id=i.employee_id WHERE i.issuer=? AND i.enabled=1 AND ${byEmail?'lower(e.email)=?':'i.subject=?'} AND ${loginEligibleSql('e')} LIMIT 1`).bind(SUPABASE_ISSUER,subjectOrEmail).first<Employee & {subject:string}>();
 if(!row||!isEmployeeRole(row.role))return null;
 if(publicPilotEnabled()&&!approvedPilotSubject(row.subject)&&!approvedTestSubjectRole(row.subject))return null;
 const testRole=approvedTestSubjectRole(row.subject);
 if(scopeOf(row)===TEST_SCOPE?(!testRole||row.role!==testRole||row.user_id!==null):!!testRole)return null;
 return row;
}
export async function requestPasswordReset(req:Request){try{
 const body=await input(req),email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new AppError('Enter a valid work email.',400);
 const client=newAuthClient();await rateLimit(req,email,'password-reset-request');
 // Do not expose provider existence, SMTP errors or eligibility in the response.
 // Provider rate limits remain in force in addition to the shared D1 limiter.
 const start=Date.now();
 try{if(await eligible(email,true))await client.auth.resetPasswordForEmail(email,{redirectTo:destination(req)})}catch{/* No tokens, addresses or provider errors are logged. */}
 // A modest floor reduces trivial known/unknown timing differences, not a claim
 // of constant-time network behavior. Never use this as the abuse-control layer.
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,700-(Date.now()-start))));
 return authResult({ok:true,message:RESET_NOTICE});
 }catch(error){return authFailure(error)}}
export async function completePasswordReset(req:Request){
 let client:ReturnType<typeof newAuthClient>|undefined;
 try{
 const body=await input(req);
 const token=typeof body.token_hash==='string'?body.token_hash:'';
 if(!/^[a-f0-9]{32,256}$/i.test(token))throw new AppError(INVALID_LINK,400);
 if(typeof body.password!=='string'||body.password.length<12||body.password.length>128||body.password!==body.confirmPassword)throw new AppError('Use a password between 12 and 128 characters and enter it identically twice.',400);
 await rateLimit(req,token,'password-reset-complete');client=newAuthClient();
 // This is deliberately one-shot: GET never consumes a token and no recovery
 // session/refresh token ever reaches a cookie, response, localStorage or app DB.
 const {data,error}=await client.auth.verifyOtp({token_hash:token,type:'recovery'});body.token_hash='';
 if(error||!data.session||!data.user||data.user.is_anonymous||!data.user.email_confirmed_at||data.session.user.id!==data.user.id)throw new AppError(INVALID_LINK,400);
 const user=data.user as typeof data.user & {banned_until?:string;deleted_at?:string};
 if(user.deleted_at||(user.banned_until&&Date.parse(user.banned_until)>Date.now()))throw new AppError(INVALID_LINK,400);
 if(!await eligible(data.user.id))throw new AppError(INVALID_LINK,400);
 // Revoke app sessions before changing the password, so a cleanup failure cannot
 // leave pre-reset application sessions usable. A failed update may require login.
 await revokeBeforeReset(data.user.id,true);
 const password=body.password;body.password='';body.confirmPassword='';
 const updated=await client.auth.updateUser({password});
 if(updated.error)throw new AppError('The password could not be changed. Request a new link and use a different strong password.',400);
 await revokeBeforeReset(data.user.id,false);
 // AdminApi.signOut uses this user's JWT, not a service/admin credential. Unlike
 // auth.signOut it does not hide 401/403/404 logout errors.
 const signedOut=await client.auth.admin.signOut(data.session.access_token,'global').catch(()=>({error:true}));
 return authResult({ok:true,requiresSignIn:true,sessionRevocationPending:!!signedOut.error},200,undefined,true);
 }catch(error){return authFailure(error)}
 finally{if(client)await client.auth.signOut({scope:'local'}).catch(()=>{});}
}

async function revokeBeforeReset(subject:string,locked:boolean){
 const now=Math.floor(Date.now()/1000);
 await database().batch([
  database().prepare('INSERT INTO auth_password_resets (issuer,subject,not_before,locked) VALUES (?,?,?,?) ON CONFLICT(issuer,subject) DO UPDATE SET not_before=MAX(auth_password_resets.not_before,excluded.not_before),locked=excluded.locked').bind(SUPABASE_ISSUER,subject,now,locked?1:0),
  database().prepare('UPDATE auth_sessions SET revoked_at=? WHERE issuer=? AND subject=? AND revoked_at IS NULL').bind(now,SUPABASE_ISSUER,subject),
 ]);
}
