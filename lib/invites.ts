import {env} from 'cloudflare:workers';
import {db,first,now,uid} from './server';
import {authProvider,convexUrls} from './auth-provider';
import {AppError,loginEligibleSql,scopeOf,scopeSql,type Employee} from './policy';
import {notify} from './notifications';

// ---------------------------------------------------------------------------
// Sign-in invitations. An administrator invites an existing employee profile:
//   1. the Convex backend creates the account (no usable password) and tells us its user id,
//   2. we bind that user id to the employee (the same approved binding the app already checks at every sign-in),
//   3. the person gets an email and chooses their own password with "Forgot your password?".
// Nothing here ever sets or sees a password.
// ---------------------------------------------------------------------------

export type LoginStatus='none'|'invited'|'active';
export const invitesEnabled=()=>authProvider()==='convex'&&convexUrls()!==null&&Boolean(env.UFS_INVITE_SECRET);

async function convexCall(path:'/invite'|'/invite/revoke',email:string):Promise<{userId?:string}>{
 const urls=convexUrls();if(!urls||!env.UFS_INVITE_SECRET)throw new AppError('Sign-in invitations are not set up on this site yet.',503);
 let response:Response;
 try{response=await fetch(`${urls.site}${path}`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.UFS_INVITE_SECRET}`},body:JSON.stringify({email})})}
 catch{throw new AppError('The sign-in service could not be reached. Try again in a minute.',503)}
 if(!response.ok)throw new AppError('The sign-in service refused the request. Try again, or check its settings.',502);
 return await response.json() as {userId?:string};
}

type Row={id:string;email:string;name:string;role:string};
async function eligibleEmployee(me:Employee,employeeId:string){
 if(!invitesEnabled())throw new AppError('Sign-in invitations are not set up on this site yet.',503);
 if(scopeOf(me)!=='live')throw new AppError('Sign-in invitations are only for live employees.',403);
 const employee=await first<Row>(`SELECT id,email,name,role FROM employees WHERE id=? AND ${scopeSql(me,'employees')} AND ${loginEligibleSql('employees')}`,employeeId);
 if(!employee)throw new AppError('This person cannot be invited: the profile is missing, inactive, a demo record, or marked as having left.',404);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email))throw new AppError('Add a valid work email to this profile first.',400);
 return employee;
}

export async function loginStatus(employeeId:string):Promise<LoginStatus>{
 const urls=convexUrls();
 const identity=await first<{id:string}>('SELECT id FROM employee_identities WHERE employee_id=? AND enabled=1'+(urls?' AND issuer=?':''),...(urls?[employeeId,urls.site]:[employeeId]));
 if(!identity)return 'none';
 const session=await first<{n:number}>('SELECT 1 n FROM auth_sessions WHERE employee_id=? LIMIT 1',employeeId);
 return session?'active':'invited';
}

export async function inviteEmployee(me:Employee,employeeId:string):Promise<{resent:boolean;emailed:boolean}>{
 const employee=await eligibleEmployee(me,employeeId),status=await loginStatus(employeeId);
 if(status==='active')throw new AppError(`${employee.name} has already signed in. If they forgot their password, they can use "Forgot your password?" on the sign-in page.`,409);
 let resent=status==='invited';
 if(!resent){
  const urls=convexUrls()!,created=await convexCall('/invite',employee.email.toLowerCase());
  if(!created.userId||!/^[A-Za-z0-9_-]{10,64}$/.test(created.userId))throw new AppError('The sign-in service did not return an account. Try again.',502);
  try{
   await db().batch([
    db().prepare('INSERT INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) VALUES (?,?,?,?,1,?,?)').bind(uid(),urls.site,created.userId,employeeId,now(),me.id),
    db().prepare('INSERT INTO audit (id,actor_id,action,target_id,created_at,data_scope) VALUES (?,?,?,?,?,?)').bind(uid(),me.id,'Invited to sign in',employeeId,now(),scopeOf(me)),
   ]);
  }catch{
   // The address is already attached to another sign-in account for this site.
   throw new AppError('That sign-in account is already linked to someone else. Check the work email on this profile.',409);
  }
 }else{
  await db().prepare('INSERT INTO audit (id,actor_id,action,target_id,created_at,data_scope) VALUES (?,?,?,?,?,?)').bind(uid(),me.id,'Re-sent sign-in invite',employeeId,now(),scopeOf(me)).run();
  resent=true;
 }
 const emailed=await notify({scope:scopeOf(me),recipients:employeeId,kind:'invite',title:'You are invited to UFS People',body:`${me.name} gave you access to UFS People.\n\nTo start: open the sign-in page, choose “Forgot your password?”, enter ${employee.email} and follow the emailed code to create your password.`,link:'/login',relatedId:employeeId,dedupeKey:`invite:${employeeId}:${now().slice(0,13)}`})>0;
 return {resent,emailed};
}

// Only before the first sign-in. After that, deactivate the account instead (Manage access).
export async function withdrawInvite(me:Employee,employeeId:string):Promise<void>{
 if(!invitesEnabled())throw new AppError('Sign-in invitations are not set up on this site yet.',503);
 const employee=await first<Row>(`SELECT id,email,name,role FROM employees WHERE id=? AND ${scopeSql(me,'employees')}`,employeeId);
 if(!employee)throw new AppError('Employee not found.',404);
 const status=await loginStatus(employeeId);
 if(status==='none')throw new AppError('There is no invitation to withdraw.',409);
 if(status==='active')throw new AppError(`${employee.name} has already signed in. Deactivate the account under Manage access instead.`,409);
 await convexCall('/invite/revoke',employee.email.toLowerCase());
 const urls=convexUrls()!;
 await db().batch([
  db().prepare('DELETE FROM employee_identities WHERE employee_id=? AND issuer=?').bind(employeeId,urls.site),
  db().prepare('INSERT INTO audit (id,actor_id,action,target_id,created_at,data_scope) VALUES (?,?,?,?,?,?)').bind(uid(),me.id,'Withdrew sign-in invite',employeeId,now(),scopeOf(me)),
 ]);
}

