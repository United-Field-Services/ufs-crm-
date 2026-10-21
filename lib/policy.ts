export type Employee={data_scope?:string;id:string;manager_id:string|null;user_id:string|null;email:string;name:string;title:string;department:string;location:string;employment:string;hire_date:string;role:string;active:number;annual_allowance:number;sick_allowance:number;wfh_allowance:number;bereavement_allowance:number;demo:number;created_at:string};
export class AppError extends Error { constructor(message:string,public status=400){super(message)} }
// Scope is loaded from an immutable server-owned database column, never client input.
export const TEST_SCOPE='qa-bots-v1' as const;
export type DataScope='live'|typeof TEST_SCOPE;
export function scopeOf(actor:Pick<Employee,'data_scope'>):DataScope{
 const value=actor.data_scope??'live';
 if(value!=='live'&&value!==TEST_SCOPE)throw new AppError('Your account data scope is unavailable.',403);
 return value;
}
export function scopeSql(actor:Pick<Employee,'data_scope'>,alias:string){
 if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias))throw new Error('Invalid scope SQL alias');
 return `${alias}.data_scope='${scopeOf(actor)}'`;
}
export function rejectScopeInput(value:Record<string,unknown>){
 if(Object.keys(value).some(k=>['scope','datascope','testscope','testmode'].includes(k.toLowerCase().replaceAll('_',''))))throw new AppError('Data scope is controlled by your account.',400);
}
export function requireLiveScope(actor:Employee){if(scopeOf(actor)!=='live')throw new AppError('This operation is unavailable to test accounts.',403)}
export const isAdmin=(e:Employee)=>e.role==='admin';
export const isHR=(e:Employee)=>isAdmin(e)||e.role==='hr_manager';
// Role names are server-owned. A reporting assignment alone never grants permissions.
export const isManager=(e:Employee)=>isHR(e)||e.role==='manager';
export const assignableRoles=['employee','manager','hr_manager','hiring_manager'] as const;
export const isEmployeeRole=(role:string)=>role==='admin'||(assignableRoles as readonly string[]).includes(role);
export function requireManager(e:Employee){if(!isManager(e))throw new AppError('An eligible manager role is required.',403)}
export function requireHR(e:Employee){if(!isHR(e))throw new AppError('HR administrator access required.',403)}
export function requireAdmin(e:Employee){if(!isAdmin(e))throw new AppError('Administrator access required.',403)}
export function canReadDocument(e:Employee,d:{owner_id:string;visibility:string;archived:number}){return !d.archived&&(isHR(e)||d.visibility==='company'||(d.visibility==='personal'&&d.owner_id===e.id))}
export function safeText(v:unknown,label:string,max=150){if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw new AppError(`${label} is required (maximum ${max} characters).`);return v.trim()}
export function validDate(v:unknown){const s=safeText(v,'Date',10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw new AppError('Enter a valid date.');return s}
export function workingDays(start:string,end:string,holidays:string[]=[]){if(end<start)throw new AppError('End date must be on or after start date.');if(start.slice(0,4)!==end.slice(0,4))throw new AppError('Submit separate requests for each calendar year.');let n=0;const d=new Date(start+'T12:00:00Z');for(let i=0;d.toISOString().slice(0,10)<=end;i++,d.setUTCDate(d.getUTCDate()+1)){if(i>365)throw new AppError('Request cannot exceed one year.');if(d.getUTCDay()!==0&&d.getUTCDay()!==6&&!holidays.includes(d.toISOString().slice(0,10)))n++;}if(!n)throw new AppError('Choose at least one working day.');return n}
export function sameOrigin(req:Request){const origin=req.headers.get('origin');if(!origin||origin!==new URL(req.url).origin)throw new AppError('This action must be submitted from this site.',403);if(req.headers.get('sec-fetch-site')==='cross-site')throw new AppError('Cross-site request rejected.',403)}
export async function readLimited(req:Request,limit:number){
 const reader=req.body?.getReader();if(!reader)return new Uint8Array();const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new AppError('Request is too large.',413)}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength}return bytes;
}
export async function jsonBody(req:Request){let body:unknown;try{body=JSON.parse(new TextDecoder().decode(await readLimited(req,20000)))}catch(e){if(e instanceof AppError)throw e;throw new AppError('Enter a valid JSON request.')}if(!body||typeof body!=='object'||Array.isArray(body))throw new AppError('Enter a valid request object.');rejectScopeInput(body as Record<string,unknown>);return body as Record<string,unknown>}

// SQL aliases are fixed application identifiers, never request data. Imported former status fails closed.
export function employmentEligibleSql(alias:string){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias))throw new Error('Invalid SQL alias');return `NOT EXISTS (SELECT 1 FROM employee_profiles login_profile WHERE login_profile.employee_id=${alias}.id AND login_profile.data_scope=${alias}.data_scope AND LOWER(TRIM(login_profile.employment_status)) IN ('inactive','terminated','archived')) AND NOT EXISTS (SELECT 1 FROM source_employee_links login_source WHERE login_source.employee_id=${alias}.id AND ${alias}.data_scope='live' AND LOWER(TRIM(login_source.source_status)) IN ('inactive','terminated','archived'))`}
export function loginEligibleSql(alias:string){return `${alias}.active = 1 AND ${alias}.demo = 0 AND ${employmentEligibleSql(alias)}`}
