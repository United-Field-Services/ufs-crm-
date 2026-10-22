import {directoryActiveSql} from './employment-directory';
import {invitesEnabled,loginStatus} from './invites';
import {all,businessDate,db,first,now,uid} from './server';
import {AppError,scopeOf,scopeSql,loginEligibleSql,isHR,requireAdmin,requireHR,safeText,validDate,type Employee} from './policy';
import {photoMetadata} from './photos';

type Fields=Record<string,unknown>;
type Validator=(value:unknown)=>string|number|null;
const label=(key:string)=>key.replaceAll('_',' ');
function text(value:unknown,key:string,max=150,required=false){
 if(value===null||value===undefined){if(required)throw new AppError(`${label(key)} is required.`);return ''}
 if(typeof value!=='string'||value.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new AppError(`Enter a valid ${label(key)} (maximum ${max} characters).`);
 const result=value.trim();if(required&&!result)throw new AppError(`${label(key)} is required.`);return result;
}
const short=(key:string,max=150,required=false):Validator=>v=>text(v,key,max,required);
function choice(key:string,options:string[],required=false):Validator{return v=>{const s=text(v,key,100,required);if(s&&!options.includes(s))throw new AppError(`Choose an available ${label(key)}.`);return s}}
function date(key:string,required=false):Validator{return v=>{const s=text(v,key,10,required);if(!s)return '';const result=validDate(s),max=`${new Date().getUTCFullYear()+10}-12-31`;if(result<'1900-01-01'||result>max)throw new AppError(`Enter a realistic ${label(key)}.`);return result}}
const email=(key:string):Validator=>v=>{const s=text(v,key,254).toLowerCase();if(s&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw new AppError('Enter a valid email address.');return s};
const phone=(key:string,required=false):Validator=>v=>{const s=text(v,key,40,required);if(s&&!/^[+\d][\d\s()+.\-#xext]{4,39}$/i.test(s))throw new AppError(`Enter a valid ${label(key)}.`);return s};
const boolean=(key:string):Validator=>v=>{if(v===true||v===1)return 1;if(v===false||v===0)return 0;throw new AppError(`${label(key)} must be true or false.`)};
const PERSONAL:Record<string,Validator>={
 legal_first_name:short('legal_first_name',100),legal_last_name:short('legal_last_name',100),preferred_name:short('preferred_name',100),
 birth_date:v=>{const s=date('birth_date')(v);if(s&&String(s)>businessDate())throw new AppError('Birth date cannot be in the future.');return s},
 gender:choice('gender',['Female','Male','Non-binary','Self-described','Prefer not to say']),marital_status:choice('marital_status',['Single','Married','Domestic partnership','Separated','Divorced','Widowed','Prefer not to say']),
 nationality:short('nationality',100),citizenship:short('citizenship',100),personal_email:email('personal_email'),personal_phone:phone('personal_phone'),work_phone:phone('work_phone'),work_phone_public:boolean('work_phone_public'),
 address_line1:short('address_line1',200),address_line2:short('address_line2',200),city:short('city',100),state:short('state',100),postal_code:short('postal_code',24),country:short('country',100),
 secondary_address_line1:short('secondary_address_line1',200),secondary_address_line2:short('secondary_address_line2',200),secondary_city:short('secondary_city',100),secondary_state:short('secondary_state',100),secondary_postal_code:short('secondary_postal_code',24),secondary_country:short('secondary_country',100),
 linkedin:v=>{const s=text(v,'linkedin',300);if(s){let url:URL;try{url=new URL(s)}catch{throw new AppError('Enter a valid LinkedIn URL.')}if(url.protocol!=='https:'||!(url.hostname==='linkedin.com'||url.hostname.endsWith('.linkedin.com'))||url.username||url.password)throw new AppError('Use an https://linkedin.com profile URL.')}return s},
 languages:short('languages',500),bio:short('bio',2000)
};
const CORE:Record<string,Validator>={name:short('name',150,true),title:short('title',150),department:short('department',150),location:short('location',150),employment:choice('employment',['Full-Time','Part-Time','Contractor','Intern','Temporary'],true),hire_date:date('hire_date',true),manager_id:v=>v===null||v===''?null:text(v,'manager_id',100,true)};
const JOB:Record<string,Validator>={employee_number:short('employee_number',50),legal_entity:short('legal_entity',150),division:short('division',150),timezone:v=>{const s=text(v,'timezone',80);if(s){try{new Intl.DateTimeFormat('en',{timeZone:s}).format()}catch{throw new AppError('Enter a valid IANA time zone, such as America/Los_Angeles.')}}return s},work_schedule:short('work_schedule',200),work_arrangement:choice('work_arrangement',['On-site','Hybrid','Remote']),hours_per_day:v=>{if(v===null||v==='')return null;if(typeof v!=='number'||!Number.isFinite(v)||v<=0||v>24)throw new AppError('Working hours per day must be greater than zero and no more than 24.');return v},employment_status:choice('employment_status',['Active','Probation','On leave','Notice period','Inactive','Terminated'],true),probation_end:date('probation_end'),contract_end:date('contract_end'),exit_date:date('exit_date'),exit_reason:short('exit_reason',1000)};
const publicKeys=['id','name','title','department','location','employment','hire_date','manager_id','active','demo'];
const profileKeys=[...Object.keys(PERSONAL),...Object.keys(JOB)];
function object(value:unknown,name:string):Fields{if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError(`Enter a valid ${name}.`);return value as Fields}
function only(input:Fields,allowed:string[]){for(const key of Object.keys(input))if(!allowed.includes(key))throw new AppError('This request contains an unsupported field.');}
function validate(input:unknown,validators:Record<string,Validator>,required:string[]=[]){const values=object(input,'record');only(values,Object.keys(validators));const out:Fields={};for(const key of required)if(!(key in values))throw new AppError(`${label(key)} is required.`);for(const [key,value]of Object.entries(values))out[key]=validators[key](value);return out}
function forbiddenPayload(value:unknown,depth=0){
 if(depth>12)throw new AppError('Request nesting is too deep.');
 if(!value||typeof value!=='object')return;
 const forbidden=new Set(['ssn','fullssn','socialsecurity','socialsecuritynumber','socialinsurancenumber','identifiernumber','fullidentifier','number','passportnumber','nationalidnumber','driverslicensenumber','driverlicensenumber','licensenumber','taxnumber','taxidnumber','bank','bankaccount','bankaccountnumber','accountnumber','routingnumber','iban','swift','creditcard','creditcardnumber']);
 for(const [key,child]of Object.entries(value)){if(forbidden.has(key.toLowerCase().replace(/[^a-z0-9]/g,'')))throw new AppError('Full identifier and bank-account collection is disabled. Record document metadata and optional last four characters only.');forbiddenPayload(child,depth+1)}
}
function requirePrivate(actor:Employee,id:string){if(actor.id!==id&&!isHR(actor))throw new AppError('Personal employee details are limited to the employee and HR.',403)}
const supportedRoles="'employee','manager','hr_manager','hiring_manager','admin'";
async function currentActor(actor:Employee){const fresh=await first<Employee>(`SELECT * FROM employees WHERE id = ? AND user_id IS ? AND ${loginEligibleSql('employees')} AND ${scopeSql(actor,'employees')} AND role IN (${supportedRoles})`,actor.id,actor.user_id);if(!fresh)throw new AppError('Your profile access changed. Refresh and try again.',403);return fresh}
async function subject(actor:Employee,id:string){
 safeText(id,'Employee',100);
 // Match the directory's effective roster status, while preserving self and HR access.
 const target=await first<Employee>(`SELECT e.* FROM employees e LEFT JOIN employee_profiles p ON p.employee_id=e.id AND p.data_scope=e.data_scope LEFT JOIN source_employee_links s ON s.employee_id=e.id AND e.data_scope='live' WHERE ${scopeSql(actor,'e')} AND e.id = ? AND (? = 1 OR e.id = ? OR ${directoryActiveSql} = 1)`,id,isHR(actor)?1:0,actor.id);
 if(!target)throw new AppError('Employee not found.',404);return target;
}
type WriteGuard={sql:string;args:unknown[];dataScope:string};
function writeGuard(actor:Employee,id:string,scope:'private'|'hr'|'admin'):WriteGuard{
 const permission=scope==='admin'?"editor.role = 'admin'":scope==='hr'?"editor.role IN ('hr_manager','admin')":"(editor.id = ? OR editor.role IN ('hr_manager','admin'))";
 return {sql:`EXISTS (SELECT 1 FROM employees editor WHERE editor.id = ? AND editor.user_id IS ? AND ${loginEligibleSql('editor')} AND ${scopeSql(actor,'editor')} AND editor.role IN (${supportedRoles}) AND ${permission}) AND EXISTS (SELECT 1 FROM employees WHERE id = ? AND ${scopeSql(actor,'employees')})`,dataScope:scopeOf(actor),args:[actor.id,actor.user_id,...(scope==='private'?[id]:[]),id]};
}
async function writeBatch(commands:D1PreparedStatement[],guard:WriteGuard,conflict='This record changed. Refresh and try again.'){
 const results=await db().batch(commands);
 if(!results[0].meta.changes){if(!await first(`SELECT 1 WHERE ${guard.sql}`,...guard.args))throw new AppError('Your profile access changed. Refresh and try again.',403);throw new AppError(conflict,409)}
}
function audit(actor:Employee,action:string,id:string){return db().prepare('INSERT INTO audit (id,actor_id,action,target_id,created_at,data_scope) SELECT ?,?,?,?,?,? WHERE changes() > 0').bind(uid(),actor.id,action,id,now(),scopeOf(actor))}
function insert(table:string,values:Fields,guard:WriteGuard){values={...values,data_scope:guard.dataScope};const keys=Object.keys(values);return db().prepare(`INSERT INTO ${table} (${keys.join(',')}) SELECT ${keys.map(()=>'?').join(',')} WHERE ${guard.sql}`).bind(...keys.map(k=>values[k]),...guard.args)}
function profileUpsert(id:string,values:Fields,guard:WriteGuard){const row={employee_id:id,...values,updated_at:now(),data_scope:guard.dataScope},keys=Object.keys(row);return db().prepare(`INSERT INTO employee_profiles (${keys.join(',')}) SELECT ${keys.map(()=>'?').join(',')} WHERE ${guard.sql} ON CONFLICT(employee_id) DO UPDATE SET ${keys.filter(k=>k!=='employee_id'&&k!=='data_scope').map(k=>`${k}=excluded.${k}`).join(',')} WHERE employee_profiles.data_scope=excluded.data_scope`).bind(...Object.values(row),...guard.args)}

export async function readProfile(actor:Employee,id:string){
 actor=await currentActor(actor);const target=await subject(actor,id),hr=isHR(actor),privateAccess=hr||actor.id===id;
 const publicProfile:Fields=Object.fromEntries(publicKeys.map(key=>[key,target[key as keyof Employee]]));
 const source=scopeOf(actor)==='live'?await first<{source_id:string;manager_name:string;source_status:string}>('SELECT source_id,manager_name,source_status FROM source_employee_links WHERE employee_id=?',id):null;if(source){publicProfile.imported=true;publicProfile.source_manager_name=source.manager_name;}
 Object.assign(publicProfile,await photoMetadata(id,actor));
 // HR sees whether this person can actually sign in yet (a profile alone does not give access).
 if(hr){const status=await loginStatus(id);publicProfile.login_status=status;publicProfile.login_bound=status!=='none'||!!target.user_id;publicProfile.invites_enabled=invitesEnabled()&&actor.role==='admin'}
 // Never SELECT private columns for a public-only viewer, even if they manage the subject.
 if(!privateAccess){const contact=await first<{work_phone:string;work_phone_public:number;division:string;work_arrangement:string}>('SELECT CASE WHEN work_phone_public = 1 THEN work_phone ELSE \'\' END AS work_phone,work_phone_public,division,work_arrangement FROM employee_profiles WHERE employee_id = ? AND '+scopeSql(actor,'employee_profiles'),id);if(contact?.work_phone_public)publicProfile.work_phone=contact.work_phone;publicProfile.division=contact?.division??'';publicProfile.work_arrangement=contact?.work_arrangement??'';await subject(await currentActor(actor),id);return {profile:publicProfile,access:{private:false,employment:false,compensation:false,hr:false,editable:false},emergencyContacts:[],identifiers:[],compensation:[],history:[],education:[],benefits:[]}}
 const saved=await first<Fields>('SELECT * FROM employee_profiles WHERE employee_id = ? AND '+scopeSql(actor,'employee_profiles'),id);
 const profile:Fields={...publicProfile,email:target.email,...Object.fromEntries(profileKeys.map(key=>[key,saved?.[key]??(key==='work_phone_public'?0:key==='hours_per_day'?null:key==='employment_status'?'Active':'')]))};profile.work_phone_public=Boolean(profile.work_phone_public);
 const [contacts,identifiers,compensation,history,education,benefits]=await Promise.all([
 all<Fields>('SELECT * FROM emergency_contacts WHERE employee_id = ? AND '+scopeSql(actor,'emergency_contacts')+' ORDER BY is_primary DESC,priority,name',id),
 all('SELECT * FROM employee_identifiers WHERE employee_id = ? AND '+scopeSql(actor,'employee_identifiers')+' ORDER BY type,updated_at DESC',id),
 all('SELECT * FROM compensation_records WHERE employee_id = ? AND '+scopeSql(actor,'compensation_records')+' ORDER BY effective_date DESC,created_at DESC,id DESC',id),
 all<Fields>('SELECT * FROM employment_history WHERE employee_id = ? AND '+scopeSql(actor,'employment_history')+' ORDER BY effective_date DESC,created_at DESC,id DESC',id),
 all('SELECT * FROM education_records WHERE employee_id = ? AND '+scopeSql(actor,'education_records')+' ORDER BY end_date DESC,start_date DESC,institution',id),
 all('SELECT * FROM benefit_enrollments WHERE employee_id = ? AND '+scopeSql(actor,'benefit_enrollments')+' ORDER BY effective_date DESC,type',id)
 ]);
 const latestActor=await currentActor(actor);requirePrivate(latestActor,id);
 return {profile,access:{private:true,employment:true,compensation:true,hr:isHR(latestActor),editable:true},emergencyContacts:contacts.map(c=>({...c,is_primary:Boolean(c.is_primary)})),identifiers,compensation,history:history.map(h=>({...h,snapshot:JSON.parse(String(h.snapshot))})),education,benefits};
}

const CONTACT:Record<string,Validator>={name:short('name',150,true),relationship:short('relationship',100,true),phone:phone('phone',true),alternate_phone:phone('alternate_phone'),email:email('email'),address:short('address',500),is_primary:boolean('is_primary'),priority:v=>{if(typeof v!=='number'||!Number.isInteger(v)||v<1||v>10)throw new AppError('Priority must be a whole number from 1 to 10.');return v}};
const IDENTIFIER:Record<string,Validator>={type:choice('type',['Passport','National ID','Social Security (SSN)','Driver license','Work permit','Tax ID','Other'],true),country:short('country',100,true),expiry_date:date('expiry_date'),status:choice('status',['Pending','Recorded','Expired'],true),last4:v=>{const s=text(v,'last4',4);if(s&&!/^[A-Za-z0-9]{4}$/.test(s))throw new AppError('Last four must be exactly four letters or digits, or blank.');return s}};
const EDUCATION:Record<string,Validator>={institution:short('institution',200,true),degree:short('degree',150),field_of_study:short('field_of_study',150),department:short('department',150),graduation_date:date('graduation_date'),start_date:date('start_date'),end_date:date('end_date'),status:choice('status',['In progress','Completed','Paused'],true),notes:short('notes',1000)};
const BENEFIT:Record<string,Validator>={type:choice('type',['Health','Dental','Vision','Retirement','Life insurance','Wellness','Other'],true),plan:short('plan',150,true),provider:short('provider',150),coverage:short('coverage',150),cost:v=>{if(v===null||v==='')return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1000000000||Math.abs(v*100-Math.round(v*100))>0.00001)throw new AppError('Benefit cost must be a nonnegative amount with at most two decimal places.');return v},currency:v=>{const s=text(v,'currency',3);if(s&&!/^[A-Z]{3}$/.test(s))throw new AppError('Use a three-letter uppercase currency code.');return s},period:choice('period',['Annual','Quarterly','Monthly','Weekly','Daily','Hourly','One-time']),status:choice('status',['Eligible','Enrolled','Waived','Ended'],true),effective_date:date('effective_date',true),end_date:date('end_date'),notes:short('notes',1000)};
const COLLECTIONS:Record<string,{table:string;key:string;validators:Record<string,Validator>;required:string[];hr?:boolean;max:number;label:string}>={
 emergency_contact:{table:'emergency_contacts',key:'contact',validators:CONTACT,required:['name','relationship','phone'],max:10,label:'emergency contact'},
 identifier:{table:'employee_identifiers',key:'identifier',validators:IDENTIFIER,required:['type','country','status'],max:20,label:'identifier metadata'},
 education:{table:'education_records',key:'education',validators:EDUCATION,required:['institution','status'],max:30,label:'education record'},
 benefit:{table:'benefit_enrollments',key:'benefit',validators:BENEFIT,required:['type','plan','status','effective_date'],hr:true,max:30,label:'benefit enrollment'}
};
async function saveCollection(actor:Employee,id:string,kind:string,body:Fields){
 const config=COLLECTIONS[kind];requirePrivate(actor,id);if(config.hr)requireHR(actor);only(body,['action',config.key]);
 const submitted=object(body[config.key],config.label);only(submitted,['id',...Object.keys(config.validators)]);const recordId=submitted.id===undefined?uid():safeText(submitted.id,'Record',100),existing=submitted.id!==undefined;
 const saved=existing?await first<Fields>(`SELECT * FROM ${config.table} WHERE id = ? AND employee_id = ? AND ${scopeSql(actor,config.table)}`,recordId,id):null;if(existing&&!saved)throw new AppError('Record not found for this employee.',404);
 const fields={...submitted};delete fields.id;const savedFields=saved?Object.fromEntries(Object.keys(config.validators).map(key=>[key,saved[key]])):{};const values=validate({...savedFields,...fields},config.validators,config.required);
 if(kind==='benefit'&&values.cost!==undefined&&values.cost!==null&&(!values.currency||!values.period))throw new AppError('Choose currency and period when recording a benefit cost.');
 const start=values.start_date||values.effective_date;if(start&&values.graduation_date&&String(values.graduation_date)<String(start))throw new AppError('Graduation date must be on or after start date.');if(start&&values.end_date&&String(values.end_date)<String(start))throw new AppError('End date must be on or after start date.');
 const timestamp=now(),commands=[],guard=writeGuard(actor,id,config.hr?'hr':'private');
 if(existing){const keys=Object.keys(values);commands.push(db().prepare(`UPDATE ${config.table} SET ${keys.map(k=>`${k} = ?`).join(',')},updated_at = ? WHERE id = ? AND employee_id = ? AND ${scopeSql(actor,config.table)} AND ${guard.sql}`).bind(...keys.map(k=>values[k]),timestamp,recordId,id,...guard.args))}
 else {const row={id:recordId,employee_id:id,...values,updated_at:timestamp,data_scope:scopeOf(actor)},keys=Object.keys(row);commands.push(db().prepare(`INSERT INTO ${config.table} (${keys.join(',')}) SELECT ${keys.map(()=>'?').join(',')} WHERE (SELECT COUNT(*) FROM ${config.table} WHERE employee_id = ? AND ${scopeSql(actor,config.table)}) < ? AND ${guard.sql}`).bind(...Object.values(row),id,config.max,...guard.args))}
 // Audit only a successful mutation and never include private field values.
 commands.push(audit(actor,`Saved ${config.label}`,id));
 if(kind==='emergency_contact'&&values.is_primary===1)commands.push(db().prepare(`UPDATE emergency_contacts SET is_primary = 0 WHERE employee_id = ? AND ${scopeSql(actor,'emergency_contacts')} AND id <> ? AND EXISTS (SELECT 1 FROM emergency_contacts WHERE id = ? AND employee_id = ? AND ${scopeSql(actor,'emergency_contacts')}) AND ${guard.sql}`).bind(id,recordId,recordId,id,...guard.args));
 await writeBatch(commands,guard,existing?'This record changed. Refresh and try again.':`This employee has reached the ${config.max}-record limit.`);
}
async function deleteCollection(actor:Employee,id:string,kind:string,body:Fields){const config=COLLECTIONS[kind];requirePrivate(actor,id);if(config.hr)requireHR(actor);const key=kind==='emergency_contact'?'contact_id':`${kind}_id`;only(body,['action',key]);const recordId=safeText(body[key],'Record',100);if(!await first(`SELECT id FROM ${config.table} WHERE id = ? AND employee_id = ? AND ${scopeSql(actor,config.table)}`,recordId,id))throw new AppError('Record not found for this employee.',404);const guard=writeGuard(actor,id,config.hr?'hr':'private');await writeBatch([db().prepare(`DELETE FROM ${config.table} WHERE id = ? AND employee_id = ? AND ${scopeSql(actor,config.table)} AND ${guard.sql}`).bind(recordId,id,...guard.args),audit(actor,`Removed ${config.label}`,id)],guard)}

export async function updateProfile(actor:Employee,id:string,body:Fields){
 actor=await currentActor(actor);const target=await subject(actor,id);forbiddenPayload(body);const action=body.action;
 if(action==='update_personal'){
  requirePrivate(actor,id);only(body,['action','values']);const values=validate(body.values,PERSONAL);if(!Object.keys(values).length)throw new AppError('Choose at least one field to update.');const guard=writeGuard(actor,id,'private');await writeBatch([profileUpsert(id,values,guard),audit(actor,'Updated personal profile fields',id)],guard);
 }else if(action==='update_employment'){
  requireHR(actor);only(body,['action','values','effective_date','reason']);const values=validate(body.values,{...CORE,...JOB});if(!Object.keys(values).length)throw new AppError('Choose at least one job field to update.');
  const effective=date('effective_date',true)(body.effective_date);if(String(effective)>businessDate())throw new AppError('Job changes take effect now. Choose today or a past effective date.');const reason=text(body.reason,'reason',500,true);
  const managerChanged='manager_id' in values&&values.manager_id!==target.manager_id;if(managerChanged)requireAdmin(actor);
  if(managerChanged&&values.manager_id){const manager=String(values.manager_id);if(manager===id)throw new AppError('An employee cannot be their own manager.');if(!await first("SELECT id FROM employees WHERE "+scopeSql(actor,'employees')+" AND id = ? AND active = 1 AND role IN ('manager','hr_manager','admin')",manager))throw new AppError('Choose an active Manager, HR, or Super admin as the required approver.');const seen=new Set([id]);let next:string|null=manager;while(next){if(seen.has(next))throw new AppError('Manager assignments cannot create a reporting cycle.');seen.add(next);const managerRow: {manager_id:string|null}|null=await first('SELECT manager_id FROM employees WHERE '+scopeSql(actor,'employees')+' AND id = ?',next);next=managerRow?.manager_id??null}}
  const saved=await first<Fields>('SELECT * FROM employee_profiles WHERE employee_id = ? AND '+scopeSql(actor,'employee_profiles'),id),snapshot:Fields={...Object.fromEntries(Object.keys(CORE).map(k=>[k,target[k as keyof Employee]])),...Object.fromEntries(Object.keys(JOB).map(k=>[k,saved?.[k]??(k==='hours_per_day'?null:k==='employment_status'?'Active':'')])),...values};
  for(const key of ['probation_end','contract_end','exit_date'])if(snapshot[key]&&String(snapshot[key])<String(snapshot.hire_date))throw new AppError(`${label(key)} cannot be before the hire date.`);
  const offboarding=['Inactive','Terminated'].includes(String(values.employment_status||''));
  if(offboarding&&(id===actor.id||target.role==='admin'))throw new AppError('You cannot offboard yourself or a super admin through employment edits.',403);
  const core=Object.keys(values).filter(k=>k in CORE),privateFields=Object.fromEntries(Object.entries(values).filter(([k])=>k in JOB)),commands=[],guard=writeGuard(actor,id,managerChanged?'admin':'hr');
  const employmentGuard={sql:guard.sql,args:[...guard.args],dataScope:guard.dataScope};
  if(offboarding){employmentGuard.sql+=" AND EXISTS (SELECT 1 FROM employees lifecycle_target WHERE lifecycle_target.data_scope='"+scopeOf(actor)+"' AND lifecycle_target.id=? AND lifecycle_target.id<>? AND lifecycle_target.role<>'admin')";employmentGuard.args.push(id,actor.id)}
  // An unchanged manager field in an HR form cannot revert a concurrent admin transfer.
  if('manager_id' in values){employmentGuard.sql+=' AND EXISTS (SELECT 1 FROM employees WHERE '+scopeSql(actor,'employees')+' AND id = ? AND (manager_id IS ? OR manager_id IS ?))';employmentGuard.args.push(id,target.manager_id,values.manager_id)}
  if(managerChanged&&values.manager_id){employmentGuard.sql+=" AND EXISTS (SELECT 1 FROM employees WHERE "+scopeSql(actor,'employees')+" AND id = ? AND active = 1 AND role IN ('manager','hr_manager','admin')) AND NOT EXISTS (WITH RECURSIVE chain(id,manager_id) AS (SELECT id,manager_id FROM employees WHERE id = ? AND "+scopeSql(actor,'employees')+" UNION SELECT e.id,e.manager_id FROM employees e JOIN chain ON e.id=chain.manager_id WHERE "+scopeSql(actor,'e')+") SELECT 1 FROM chain WHERE id = ?)";employmentGuard.args.push(values.manager_id,values.manager_id,id)}
  if(core.length)commands.push(db().prepare(`UPDATE employees SET ${core.map(k=>`${k} = ?`).join(',')} WHERE id = ? AND ${employmentGuard.sql}`).bind(...core.map(k=>values[k]),id,...employmentGuard.args));
  if(Object.keys(privateFields).length)commands.push(profileUpsert(id,privateFields,employmentGuard));
  if(managerChanged){commands.push(db().prepare(`UPDATE leave_requests SET required_manager_id = ? WHERE employee_id = ? AND ${scopeSql(actor,'leave_requests')} AND status = ? AND ${employmentGuard.sql}`).bind(values.manager_id,id,'pending',...employmentGuard.args));commands.push(db().prepare(`UPDATE time_entries SET required_manager_id = ? WHERE employee_id = ? AND ${scopeSql(actor,'time_entries')} AND status = ? AND ${employmentGuard.sql}`).bind(values.manager_id,id,'submitted',...employmentGuard.args));}
  // Offboarding disables sign-in in the same transaction. A later rehire edit never reactivates it.
  if(offboarding)commands.push(db().prepare(`UPDATE employees SET active=0 WHERE id=? AND role<>'admin' AND ${employmentGuard.sql}`).bind(id,...employmentGuard.args));
  commands.push(insert('employment_history',{id:uid(),employee_id:id,effective_date:effective,reason,snapshot:JSON.stringify(snapshot),created_by:actor.id,created_at:now()},employmentGuard),audit(actor,'Updated employment fields',id));await writeBatch(commands,guard);
 }else if(action==='add_compensation'||action==='add_bonus'){
  requireHR(actor);only(body,['action','record']);const values=validate(body.record,{amount:v=>{if(typeof v!=='number'||!Number.isFinite(v)||v<=0||v>1000000000||Math.abs(v*100-Math.round(v*100))>0.00001)throw new AppError('Amount must be greater than zero, no more than 1 billion, and use at most two decimal places.');return v},currency:v=>{const s=text(v,'currency',3,true);if(!/^[A-Z]{3}$/.test(s))throw new AppError('Use a three-letter uppercase currency code.');return s},...(action==='add_compensation'?{frequency:choice('frequency',['Annual','Quarterly','Monthly','Biweekly','Weekly','Daily','Hourly'],true),pay_schedule:choice('pay_schedule',['Monthly','Twice monthly','Biweekly','Weekly']),overtime_status:choice('overtime_status',['Exempt','Nonexempt'])}:{}),effective_date:date('effective_date',true),reason:short('reason',500,true)},['amount','currency',...(action==='add_compensation'?['frequency']:[]),'effective_date','reason']);
  const guard=writeGuard(actor,id,'hr');await writeBatch([insert('compensation_records',{id:uid(),employee_id:id,...values,...(action==='add_bonus'?{record_type:'Bonus',frequency:'One-time',pay_schedule:'One-time'}:{record_type:'Salary'}),created_by:actor.id,created_at:now()},guard),audit(actor,action==='add_bonus'?'Added bonus record':'Added compensation record',id)],guard);
 }else if(typeof action==='string'&&action.startsWith('save_')&&Object.hasOwn(COLLECTIONS,action.slice(5)))await saveCollection(actor,id,action.slice(5),body);
 else if(typeof action==='string'&&action.startsWith('delete_')&&Object.hasOwn(COLLECTIONS,action.slice(7)))await deleteCollection(actor,id,action.slice(7),body);
 else throw new AppError('Unknown profile action.');
 return readProfile(actor,id);
}
