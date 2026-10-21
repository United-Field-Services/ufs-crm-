import {env} from 'cloudflare:workers';
import {AppError,isEmployeeRole,jsonBody,loginEligibleSql,sameOrigin,scopeOf,TEST_SCOPE,type Employee} from './policy';
import {authFailure,authResult,rateLimit} from './standalone-auth';
import {convexRecoveryConfigured,convexUrls} from './auth-provider';
import {convexCall,tokensFrom,verifyConvexToken} from './convex-auth';

// Password reset with Convex Auth: an 8-digit code is emailed (through Resend) and the person enters it
// together with a new password. Off by default, like the Supabase reset: it needs UFS_PASSWORD_RECOVERY=enabled.
// A reset never signs anyone in and ends every session of the account.
export const CONVEX_RESET_NOTICE='If an eligible account matches that email, a reset code was sent. Check your inbox and spam folder.';
const INVALID_CODE='This code is invalid, expired, or already used. Request a new code.';
const PASSWORD_RULE='Use a password between 12 and 72 characters and enter it identically twice.';
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function input(req:Request){
 sameOrigin(req);
 if(!convexRecoveryConfigured())throw new AppError('Password reset is not enabled yet. Contact your UFS administrator.',503);
 if(!req.headers.get('content-type')?.startsWith('application/json'))throw new AppError('Use the password reset form.',415);
 return jsonBody(req);
}
const readEmail=(value:unknown)=>typeof value==='string'?value.trim().toLowerCase():'';
// Only an existing employee with an approved sign-in binding can reset. The profile email must match the Convex sign-in email.
async function eligibleByEmail(email:string){
 const urls=convexUrls();if(!env.DB||!urls)throw new AppError('Password reset is temporarily unavailable.',503);
 const row=await env.DB.prepare(`SELECT e.*,i.subject FROM employee_identities i JOIN employees e ON e.id=i.employee_id WHERE i.issuer=? AND i.enabled=1 AND lower(e.email)=? AND ${loginEligibleSql('e')} LIMIT 1`).bind(urls.site,email).first<Employee&{subject:string}>();
 if(!row||!isEmployeeRole(row.role)||scopeOf(row)===TEST_SCOPE)return null;
 return row;
}
const floor=(start:number)=>new Promise(resolve=>setTimeout(resolve,Math.max(0,700-(Date.now()-start))));

export async function requestConvexReset(req:Request){try{
 const body=await input(req),email=readEmail(body.email);
 if(!EMAIL.test(email)||email.length>254)throw new AppError('Enter a valid work email.',400);
 await rateLimit(req,email,'password-reset-request');
 // The response never reveals whether an account exists or whether the email could be sent.
 const start=Date.now();
 try{if(await eligibleByEmail(email))await convexCall('action','auth:signIn',{provider:'password',params:{email,flow:'reset'}})}catch{/* nothing about the address or provider is logged */}
 await floor(start);
 return authResult({ok:true,message:CONVEX_RESET_NOTICE});
 }catch(error){return authFailure(error)}}

export async function completeConvexReset(req:Request){try{
 const body=await input(req),email=readEmail(body.email),code=typeof body.code==='string'?body.code.replace(/\s+/g,''):'';
 if(!EMAIL.test(email)||email.length>254||!/^\d{8}$/.test(code))throw new AppError(INVALID_CODE,400);
 const password=typeof body.password==='string'?body.password:'';
 if(password.length<12||new TextEncoder().encode(password).length>72||password!==body.confirmPassword)throw new AppError(PASSWORD_RULE,400);
 await rateLimit(req,email,'password-reset-complete');
 const start=Date.now(),employee=await eligibleByEmail(email);
 if(!employee){await floor(start);throw new AppError(INVALID_CODE,400)}
 // Convex checks the code, sets the new password and ends the account's other sessions in one step.
 const result=await convexCall<unknown>('action','auth:signIn',{provider:'password',params:{email,code,newPassword:password,flow:'reset-verification'}});
 body.password='';body.confirmPassword='';
 const tokens=result.ok?tokensFrom(result.value):null;
 if(!tokens)throw new AppError(INVALID_CODE,400);
 const endSession=()=>convexCall('action','auth:signOut',{},tokens.token).then(r=>r.ok,()=>false);
 let verified:{userId:string};
 try{verified=await verifyConvexToken(tokens.token)}catch(error){await endSession();throw error}
 if(verified.userId!==employee.subject){await endSession();throw new AppError(INVALID_CODE,400)}
 // Advance the cutoff and revoke every app session for this account. Sign-in sessions registered before this moment stay dead.
 const now=Math.floor(Date.now()/1000),urls=convexUrls()!;
 await env.DB!.batch([
  env.DB!.prepare('INSERT INTO auth_password_resets (issuer,subject,not_before,locked) VALUES (?,?,?,0) ON CONFLICT(issuer,subject) DO UPDATE SET not_before=MAX(not_before,excluded.not_before),locked=0').bind(urls.site,verified.userId,now),
  env.DB!.prepare('UPDATE auth_sessions SET revoked_at=? WHERE issuer=? AND subject=? AND revoked_at IS NULL').bind(now,urls.site,verified.userId),
 ]);
 // The reset created one new session; end it so the person must sign in with the new password.
 const signedOut=await endSession();
 return authResult({ok:true,requiresSignIn:true,sessionRevocationPending:!signedOut},200,undefined,true);
 }catch(error){return authFailure(error)}}
