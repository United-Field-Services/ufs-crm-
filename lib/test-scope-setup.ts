import {env} from 'cloudflare:workers';
import {AppError,TEST_SCOPE,loginEligibleSql} from './policy';
import {database as pickDatabase} from './database';

// Optional, exact-account provisioning. Configuration is absent by default and
// may only be installed after verification and action-time approval. No password,
// invitation, provider user, email, or production employee is created here.
export const QA_EMPLOYEE_ID='qa-bots-v1:employee';
export const QA_HR_ID='qa-bots-v1:hr-manager';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailValue=(value:string|undefined)=>value&&value===value.trim().toLowerCase()&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?value:null;
export function approvedQaConfiguration(){
 if(env.UFS_QA_TEST_ACCESS!=='enabled')return null;
 const employeeSubject=env.UFS_QA_EMPLOYEE_SUB,hrSubject=env.UFS_QA_HR_MANAGER_SUB;
 if(!employeeSubject||!hrSubject||!UUID.test(employeeSubject)||!UUID.test(hrSubject)||employeeSubject===hrSubject||employeeSubject!==employeeSubject.toLowerCase()||hrSubject!==hrSubject.toLowerCase())return null;
 const admins=[env.UFS_SUPABASE_OWNER_SUB,env.UFS_SUPABASE_ADDITIONAL_ADMIN_SUB].map(s=>s?.toLowerCase());
 if(admins.includes(employeeSubject)||admins.includes(hrSubject))return null;
 return {employeeSubject,hrSubject};
}
export function approvedQaBootstrap(){
 if(env.UFS_QA_BOOTSTRAP!=='approved')return null;
 const config=approvedQaConfiguration(),employeeEmail=emailValue(env.UFS_QA_EMPLOYEE_EMAIL),hrEmail=emailValue(env.UFS_QA_HR_MANAGER_EMAIL);
 if(!config||!employeeEmail||!hrEmail||employeeEmail===hrEmail)return null;
 return {...config,employeeEmail,hrEmail};
}
export async function provisionApprovedTestProfiles(issuer:string,subject:string,verifiedEmail:string){
 const config=approvedQaBootstrap();if(!config)return;
 if(issuer!=='https://ycswaipyuonxwyalkits.supabase.co/auth/v1')throw new AppError('Your approved test identity needs administrator review.',403);
 const expected=subject===config.employeeSubject?config.employeeEmail:subject===config.hrSubject?config.hrEmail:null;
 if(!expected||verifiedEmail.toLowerCase()!==expected)throw new AppError('Your approved test identity needs administrator review.',403);
 let database:D1Database;try{database=pickDatabase()}catch{throw new AppError('Sign-in is temporarily unavailable.',503)}
 const stamp=new Date().toISOString();
 const profiles=[
  {id:QA_HR_ID,subject:config.hrSubject,email:config.hrEmail,name:'QA HR Manager',role:'hr_manager',manager:null},
  {id:QA_EMPLOYEE_ID,subject:config.employeeSubject,email:config.employeeEmail,name:'QA Employee',role:'employee',manager:QA_HR_ID},
 ];
 // The same guard is evaluated inside each serialized statement. Existing rows
 // are never repurposed, reactivated, rebound, re-roled or repaired by login.
 const guardParts:string[]=[],guardArgs:unknown[]=[];
 for(const p of profiles){
  guardParts.push(`NOT EXISTS (SELECT 1 FROM employees e WHERE e.id=? AND (NOT (${loginEligibleSql('e')}) OR e.data_scope<>? OR e.role<>? OR e.active<>1 OR e.demo<>0 OR e.user_id IS NOT NULL OR LOWER(e.email)<>? OR e.manager_id IS NOT ?))`);guardArgs.push(p.id,TEST_SCOPE,p.role,p.email,p.manager);
  guardParts.push("NOT EXISTS (SELECT 1 FROM employees e WHERE e.data_scope=? AND LOWER(e.email)=? AND e.id<>?)");guardArgs.push(TEST_SCOPE,p.email,p.id);
  guardParts.push("NOT EXISTS (SELECT 1 FROM employee_identities i WHERE i.issuer=? AND ((i.subject=? AND (i.employee_id<>? OR i.enabled<>1)) OR (i.employee_id=? AND (i.subject<>? OR i.enabled<>1))))");guardArgs.push(issuer,p.subject,p.id,p.id,p.subject);
 }
 const guard=guardParts.join(' AND '),commands:D1PreparedStatement[]=[];
 for(const p of profiles)commands.push(database.prepare(`INSERT OR IGNORE INTO employees (id,email,name,title,department,location,employment,hire_date,manager_id,role,active,demo,created_at,data_scope) SELECT ?,?,?,?,?,?,?,?,?,?,1,0,?,? WHERE ${guard}`).bind(p.id,p.email,p.name,'Synthetic test profile','QA Test Group','Test location','Full-Time',stamp.slice(0,10),p.manager,p.role,stamp,TEST_SCOPE,...guardArgs));
 const actorId=subject===config.employeeSubject?QA_EMPLOYEE_ID:QA_HR_ID;
 for(const p of profiles){
  commands.push(database.prepare(`INSERT OR IGNORE INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) SELECT ?,?,?,?,1,?,? WHERE ${guard} AND EXISTS (SELECT 1 FROM employees e WHERE e.id=? AND e.data_scope=? AND e.active=1 AND e.role=?)`).bind(crypto.randomUUID(),issuer,p.subject,p.id,stamp,'exact-qa-runtime-approval',...guardArgs,p.id,TEST_SCOPE,p.role));
  commands.push(database.prepare("INSERT INTO audit (id,actor_id,action,target_id,created_at,data_scope) SELECT ?,?,'Bound approved synthetic test identity',?,?,? WHERE changes()=1").bind(crypto.randomUUID(),actorId,p.id,stamp,TEST_SCOPE));
 }
 const complete:string[]=[],completeArgs:unknown[]=[];
 for(const p of profiles){complete.push(`EXISTS (SELECT 1 FROM employees e JOIN employee_identities i ON i.employee_id=e.id WHERE e.id=? AND ${loginEligibleSql('e')} AND e.data_scope=? AND e.role=? AND e.active=1 AND e.demo=0 AND e.user_id IS NULL AND LOWER(e.email)=? AND e.manager_id IS ? AND i.issuer=? AND i.subject=? AND i.enabled=1)`);completeArgs.push(p.id,TEST_SCOPE,p.role,p.email,p.manager,issuer,p.subject)}
 // CHECK(valid=1) is evaluated within the same batch transaction. A mismatch
 // rolls back all preceding profile, identity and audit inserts, not only login.
 commands.push(database.prepare(`INSERT INTO qa_provisioning_checks (id,valid) SELECT 1,CASE WHEN ${complete.join(' AND ')} THEN 1 ELSE 0 END ON CONFLICT(id) DO UPDATE SET valid=excluded.valid`).bind(...completeArgs));
 try{await database.batch(commands)}catch{throw new AppError('Your approved test identity needs administrator review.',403)}
 // Denial after a conflicting/disabled existing row is intentional. No sign-in
 // can silently undo a later offboarding, role change, or disabled mapping.
 for(const p of profiles){
  const ok=await database.prepare(`SELECT 1 AS ok FROM employees e JOIN employee_identities i ON i.employee_id=e.id WHERE e.id=? AND ${loginEligibleSql('e')} AND e.data_scope=? AND e.role=? AND e.active=1 AND e.demo=0 AND e.user_id IS NULL AND LOWER(e.email)=? AND e.manager_id IS ? AND i.issuer=? AND i.subject=? AND i.enabled=1`).bind(p.id,TEST_SCOPE,p.role,p.email,p.manager,issuer,p.subject).first();
  if(!ok)throw new AppError('Your approved test identity needs administrator review.',403);
 }
}
