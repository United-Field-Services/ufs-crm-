import {env} from 'cloudflare:workers';
import {standaloneMode,standaloneEmployee as supabaseEmployee,readAuthCookies} from './standalone-auth';
import {authProvider} from './auth-provider';
import {d1Bucket,type StorageBucket} from './d1-storage';
import {convexEmployee} from './convex-auth';
import {headers} from 'next/headers';
import {getChatGPTUser} from '../app/chatgpt-auth';
import {AppError,isEmployeeRole,loginEligibleSql,scopeOf,scopeSql,type Employee} from './policy';
export function db(){if(!env.DB)throw new AppError('The database is not configured.',503);return env.DB}
// An R2 bucket is used when one is bound; otherwise files are kept in the database (lib/d1-storage.ts).
export function bucket():StorageBucket{return env.BUCKET?env.BUCKET as unknown as StorageBucket:d1Bucket(db())}
export async function all<T=Record<string,unknown>>(sql:string,...args:unknown[]){return (await db().prepare(sql).bind(...args).all<T>()).results}
export async function first<T=Record<string,unknown>>(sql:string,...args:unknown[]){return db().prepare(sql).bind(...args).first<T>()}
export const businessDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const now=()=>new Date().toISOString();
export const uid=()=>crypto.randomUUID();
const standaloneEmployee=()=>authProvider()==='convex'?convexEmployee():supabaseEmployee();
export async function currentEmployee():Promise<Employee>{
 // Public-pilot intent must not revert to legacy identity on a mistyped mode.
 if(env.UFS_AUTH_PUBLIC_PILOT_UNTIL!==undefined)return standaloneEmployee();
 if(standaloneMode()){
  const cookies=readAuthCookies(await headers());
  if(cookies.accessToken||cookies.refreshToken||env.UFS_AUTH_MODE==='standalone')return standaloneEmployee();
  // During private pilot only the already-bound legacy administrator may enter.
  // No email bootstrap/linking runs while standalone authentication is active.
  const owner=await getChatGPTUser();
  const existing=owner?await first<Employee>(`SELECT * FROM employees WHERE user_id=? AND data_scope='live' AND role='admin' AND ${loginEligibleSql('employees')}`,owner.userId):null;
  if(existing)return existing;
  return standaloneEmployee();
 }
 const user=await getChatGPTUser();if(!user)throw new AppError('Sign in with your own ChatGPT account.',401);
 let e=await first<Employee>('SELECT * FROM employees WHERE user_id = ?',user.userId);
 if(!e){
  const email=user.email.toLowerCase().trim(),owner=env.UFS_OWNER_EMAIL?.toLowerCase().trim();
  if(owner&&email===owner){
   // Initial owner only. A configured address must never create a second admin or restore a disabled one.
   await db().prepare("INSERT OR IGNORE INTO employees (id,user_id,email,name,title,department,location,employment,hire_date,role,active,annual_allowance,sick_allowance,demo,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM employees WHERE role='admin')").bind(uid(),user.userId,email,user.fullName||'UFS Administrator','Administrator','Administration & Operations','United States','Full-Time',now().slice(0,10),'admin',1,15,5,0,now()).run();
  }else{
   // Bind a pre-approved profile once, using only Sites' verified identity, never submitted roles or user IDs.
   await db().prepare(`UPDATE employees SET user_id = ? WHERE data_scope='live' AND email = ? AND user_id IS NULL AND ${loginEligibleSql('employees')} AND role IN (?,?,?,?)`).bind(user.userId,email,'employee','manager','hr_manager','hiring_manager').run();
  }
  e=await first<Employee>('SELECT * FROM employees WHERE user_id = ?',user.userId);
 }
 const fresh=e?await first<Employee>(`SELECT * FROM employees WHERE id=? AND user_id=? AND ${loginEligibleSql('employees')}`,e.id,user.userId):null;
 if(!fresh||!isEmployeeRole(fresh.role))throw new AppError('Your employee account is unavailable. Contact your administrator to review access.',403);
 if(scopeOf(fresh)!=='live')throw new AppError('Test accounts require standalone employee sign-in.',403);return fresh;
}
export async function log(actor:Employee,action:string,target:string){await db().prepare(`INSERT INTO audit (id,actor_id,action,target_id,created_at,data_scope) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM employees WHERE id=? AND user_id IS ? AND ${scopeSql(actor,'employees')} AND ${loginEligibleSql('employees')})`).bind(uid(),actor.id,action,target,now(),scopeOf(actor),actor.id,actor.user_id).run()}
export function response(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
export function failure(e:unknown){console.error(e instanceof Error?e.message:'Request failed');return response({error:e instanceof AppError?e.message:'Something went wrong. Please try again.'},e instanceof AppError?e.status:500)}
