import {env} from 'cloudflare:workers';
import {db,first,now,uid} from './server';
import {authProvider,convexUrls} from './auth-provider';
import {SUPABASE_ISSUER,SUPABASE_URL} from './standalone-auth';
import {AppError,loginEligibleSql,scopeOf,scopeSql,type Employee} from './policy';
import {notify} from './notifications';

// ---------------------------------------------------------------------------
// Sign-in invitations. An administrator invites an existing employee profile:
//   1. the sign-in service (Supabase Auth, or Convex) creates the account with no usable password and tells us its user id,
//   2. we bind that user id to the employee (the same approved binding the app already checks at every sign-in),
//   3. the person gets an email and chooses their own password with "Forgot your password?".
// Nothing here ever sets or sees a password.
// ---------------------------------------------------------------------------

export type LoginStatus='none'|'invited'|'active';

// The address of whoever signs people in; stored as the "issuer" of each binding.
const issuer=():string|null=>authProvider()==='convex'?(convexUrls()?.site??null):SUPABASE_ISSUER;
export const invitesEnabled=()=>authProvider()==='convex'
 ?convexUrls()!==null&&Boolean(env.UFS_INVITE_SECRET)
 :env.UFS_SUPABASE_URL===SUPABASE_URL&&Boolean(env.UFS_SUPABASE_SERVICE_KEY);

const notReady=()=>new AppError('Sign-in invitations are not set up on this site yet.',503);
async function call(url:string,init:RequestInit):Promise<Response>{
 try{return await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(20000)})}
 catch{throw new AppError('The sign-in service could not be reached. Try again in a minute.',503)}
}

// ---- Convex -----------------------------------------------------------------
async function convexCall(path:'/invite'|'/invite/revoke',email:string):Promise<{userId?:string}>{
 const urls=convexUrls();if(!urls||!env.UFS_INVITE_SECRET)throw notReady();
 const response=await call(`${urls.site}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.UFS_INVITE_SECRET}`},body:JSON.stringify({email})});
 if(!response.ok)throw new AppError('The sign-in service refused the request. Try again, or check its settings.',502);
 return await response.json() as {userId?:string};
}

// ---- Supabase Auth ----------------------------------------------------------
const supabaseHeaders=()=>({'Content-Type':'application/json',apikey:env.UFS_SUPABASE_SERVICE_KEY!,Authorization:`Bearer ${env.UFS_SUPABASE_SERVICE_KEY}`});
async function supabaseCreate(email:string):Promise<string>{
 if(!env.UFS_SUPABASE_SERVICE_KEY)throw notReady();
 // email_confirm marks the address as verified; no password is set, so the person must choose one with "Forgot your password?".
 const created=await call(`${SUPABASE_URL}/auth/v1/admin/users`,{method:'POST',headers:supabaseHeaders(),body:JSON.stringify({email,email_confirm:true})});
 if(created.ok){const user=await created.json() as {id?:string};if(user.id)return user.id}
 else if(created.status===422||created.status===409){
  // Never attach an employee to an account that already exists: whoever created it (for example someone who signed up with this
  // address first) may know its password. The project owner must look at it and delete it if it should not exist.
  throw new AppError('This email already has a sign-in account in Supabase. Ask the project owner to review it (Authentication, Users) and delete it if it should not exist, then invite again.',409);
 }
 throw new AppError('The sign-in service could not create the account. Try again, or check its settings.',502);
}
async function supabaseRemove(subject:string){
 if(!env.UFS_SUPABASE_SERVICE_KEY)throw notReady();
 const response=await call(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(subject)}`,{method:'DELETE',headers:supabaseHeaders()});
 if(!response.ok&&response.status!==404)throw new AppError('The sign-in service could not withdraw the account. Try again.',502);
}

type Row={id:string;email:string;name:string;role:string};
async function eligibleEmployee(me:Employee,employeeId:string){
 if(!invitesEnabled())throw notReady();
 if(scopeOf(me)!=='live')throw new AppError('Sign-in invitations are only for live employees.',403);
 const employee=await first<Row>(`SELECT id,email,name,role FROM employees WHERE id=? AND ${scopeSql(me,'employees')} AND ${loginEligibleSql('employees')}`,employeeId);
 if(!employee)throw new AppError('This person cannot be invited: the profile is missing, inactive, a demo record, or marked as having left.',404);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email))throw new AppError('Add a valid work email to this profile first.',400);
 return employee;
}

export async function loginStatus(employeeId:string):Promise<LoginStatus>{
 const who=issuer();
 const identity=await first<{id:string}>('SELECT id FROM employee_identities WHERE employee_id=? AND enabled=1'+(who?' AND issuer=?':''),...(who?[employeeId,who]:[employeeId]));
 if(!identity)return 'none';
 const session=await first<{n:number}>('SELECT 1 n FROM auth_sessions WHERE employee_id=? LIMIT 1',employeeId);
 return session?'active':'invited';
}

export async function inviteEmployee(me:Employee,employeeId:string):Promise<{resent:boolean;emailed:boolean}>{
 const employee=await eligibleEmployee(me,employeeId),status=await loginStatus(employeeId),who=issuer()!;
 if(status==='active')throw new AppError(`${employee.name} has already signed in. If they forgot their password, they can use "Forgot your password?" on the sign-in page.`,409);
 const resent=status==='invited';
 if(!resent){
  const email=employee.email.toLowerCase();
  const userId=authProvider()==='convex'?(await convexCall('/invite',email)).userId:await supabaseCreate(email);
  if(!userId||!/^[A-Za-z0-9_-]{10,64}$/.test(userId))throw new AppError('The sign-in service did not return an account. Try again.',502);
  try{
   await db().batch([
    db().prepare('INSERT INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) VALUES (?,?,?,?,1,?,?)').bind(uid(),who,userId,employeeId,now(),me.id),
    db().prepare('INSERT INTO audit (id,actor_id,action,target_id,created_at,data_scope) VALUES (?,?,?,?,?,?)').bind(uid(),me.id,'Invited to sign in',employeeId,now(),scopeOf(me)),
   ]);
  }catch{
   // The address is already attached to another sign-in account for this site.
   throw new AppError('That sign-in account is already linked to someone else. Check the work email on this profile.',409);
  }
 }else{
  await db().prepare('INSERT INTO audit (id,actor_id,action,target_id,created_at,data_scope) VALUES (?,?,?,?,?,?)').bind(uid(),me.id,'Re-sent sign-in invite',employeeId,now(),scopeOf(me)).run();
 }
 const emailed=await notify({scope:scopeOf(me),recipients:employeeId,kind:'invite',title:'You are invited to UFS People',body:`${me.name} gave you access to UFS People.\n\nTo start: open the sign-in page, choose “Forgot your password?”, enter ${employee.email} and follow the emailed steps to create your password.`,link:'/login',relatedId:employeeId,dedupeKey:`invite:${employeeId}:${now().slice(0,13)}`})>0;
 return {resent,emailed};
}

// Only before the first sign-in. After that, deactivate the account instead (Manage access).
export async function withdrawInvite(me:Employee,employeeId:string):Promise<void>{
 if(!invitesEnabled())throw notReady();
 const employee=await first<Row>(`SELECT id,email,name,role FROM employees WHERE id=? AND ${scopeSql(me,'employees')}`,employeeId);
 if(!employee)throw new AppError('Employee not found.',404);
 const status=await loginStatus(employeeId),who=issuer()!;
 if(status==='none')throw new AppError('There is no invitation to withdraw.',409);
 if(status==='active')throw new AppError(`${employee.name} has already signed in. Deactivate the account under Manage access instead.`,409);
 if(authProvider()==='convex')await convexCall('/invite/revoke',employee.email.toLowerCase());
 else{
  const binding=await first<{subject:string}>('SELECT subject FROM employee_identities WHERE employee_id=? AND issuer=?',employeeId,who);
  if(binding)await supabaseRemove(binding.subject);
 }
 await db().batch([
  db().prepare('DELETE FROM employee_identities WHERE employee_id=? AND issuer=?').bind(employeeId,who),
  db().prepare('INSERT INTO audit (id,actor_id,action,target_id,created_at,data_scope) VALUES (?,?,?,?,?,?)').bind(uid(),me.id,'Withdrew sign-in invite',employeeId,now(),scopeOf(me)),
 ]);
}
