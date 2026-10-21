import {all,db,first,now,uid} from './server';
import {AppError,validDate,type Employee} from './policy';

// One bounded, insert-only migration. Ordinary employment data only; runtime data
// must remain outside source control. The temporary route pins the approved digest.
export const FORMER_IMPORT_ID='talenthr-former-v1';
export const FORMER_SOURCE_ORIGIN='https://unitedffs.talenthr.io';
const CATEGORIES=['Full-Time','Part-Time','Contractor','Furloughed','Temporary','Intern','Volunteer','Per-Diem','Other','Consultant','Fixed term contract','Trainee'];
type HistoryBase={effectiveDate:string;sourceOrder:number};
type StatusHistory=HistoryBase&{kind:'status';status:string};
type ManagerHistory=HistoryBase&{kind:'manager';managerName:string;managerSourceId:string|null};
type JobHistory=HistoryBase&{kind:'job';title:string;employmentType:string;location:string;division:string;department:string};
export type History=StatusHistory|ManagerHistory|JobHistory;
type Entry={sourceId:string;name:string;email:string;phone:string;title:string;department:string;division:string;location:string;employmentStatus:'Terminated';employmentCategory:string;employmentType:string;hireDate:string;exitDate:string;managerSourceId:string|null;managerName:string;history:History[]};
type Payload={schemaVersion:1;sourceOrigin:string;extractedAt:string;employees:Entry[]};
type Counts={employees:number;created:number;former:number;disabledAccess:number;historyRows:number;statusHistory:number;managerHistory:number;jobHistory:number;sourceReportingLinks:number};
type Batch={id:string;digest:string;counts_json:string;imported_at:string};
type SourceLink={source_id:string;employee_id:string;manager_source_id:string|null};

function object(raw:unknown,keys:string[],label:string):Record<string,unknown>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AppError(`${label} must be an object.`);
 const value=raw as Record<string,unknown>;
 if(Object.keys(value).some(k=>!keys.includes(k)))throw new AppError(`${label} contains fields outside the approved former-staff transfer.`);
 return value;
}
function text(raw:unknown,label:string,max=180,required=false){
 if(raw===undefined&&!required)return '';
 if(typeof raw!=='string'||raw.length>max||/[\u0000-\u001f\u007f]/.test(raw))throw new AppError(`${label} is invalid.`);
 const value=raw.trim();if(required&&!value)throw new AppError(`${label} is required.`);return value;
}
function sourceId(raw:unknown,manager=false){const value=text(raw,'Source record',80,true);if(!(manager?/^\/(people\/\d+|my-profile)$/:/^\/people\/\d+$/).test(value))throw new AppError('Use an observed TalentHR source profile path.');return value}
function managerId(raw:unknown){return raw===null||raw===''||raw===undefined?null:sourceId(raw,true)}
function arrangement(raw:unknown){const value=text(raw,'Work arrangement',20);if(value&&!['On-site','Hybrid','Remote'].includes(value))throw new AppError('Unsupported work arrangement.');return value}
function category(raw:unknown,terminated=false){const value=text(raw,'Employment category',40,true);if(!CATEGORIES.includes(value)&&!(terminated&&value==='Terminated'))throw new AppError('Unsupported source employment status.');return value}
function date(raw:unknown){const value=validDate(raw);if(value<'1900-01-01'||value>'2100-12-31')throw new AppError('Employment date is out of range.');return value}
export function validateSourceHistory(raw:unknown):History{
 const item=object(raw,['kind','effectiveDate','sourceOrder','status','managerName','managerSourceId','title','employmentType','location','division','department'],'History');
 const common=['kind','effectiveDate','sourceOrder'];
 const fields=item.kind==='status'?['status']:item.kind==='manager'?['managerName','managerSourceId']:item.kind==='job'?['title','employmentType','location','division','department']:null;
 if(!fields||Object.keys(item).some(k=>!common.includes(k)&&!fields.includes(k)))throw new AppError('History contains unsupported fields for its source table.');
 if(!Number.isSafeInteger(item.sourceOrder)||Number(item.sourceOrder)<0||Number(item.sourceOrder)>99)throw new AppError('History source order is invalid.');
 const base={effectiveDate:date(item.effectiveDate),sourceOrder:Number(item.sourceOrder)};
 if(item.kind==='status')return {...base,kind:'status',status:category(item.status,true)};
 if(item.kind==='manager')return {...base,kind:'manager',managerName:text(item.managerName,'Source reporting manager'),managerSourceId:managerId(item.managerSourceId)};
 return {...base,kind:'job',title:text(item.title,'Job title'),employmentType:arrangement(item.employmentType),location:text(item.location,'Work location'),division:text(item.division,'Division'),department:text(item.department,'Department')};
}
export function validateFormerImport(raw:unknown):Payload{
 const root=object(raw,['schemaVersion','sourceOrigin','extractedAt','employees'],'Former-staff import');
 if(root.schemaVersion!==1||root.sourceOrigin!==FORMER_SOURCE_ORIGIN)throw new AppError('Unsupported import version or source tenant.');
 const extractedAt=text(root.extractedAt,'Extraction time',40,true);if(!/^\d{4}-\d\d-\d\dT/.test(extractedAt)||Number.isNaN(Date.parse(extractedAt)))throw new AppError('Extraction time is invalid.');
 if(!Array.isArray(root.employees)||!root.employees.length||root.employees.length>100)throw new AppError('Import requires 1–100 former employee records.');
 const employees=root.employees.map((raw,i)=>{
  const e=object(raw,['sourceId','name','email','phone','title','department','division','location','employmentStatus','employmentCategory','employmentType','hireDate','exitDate','managerSourceId','managerName','history'],`Former employee ${i+1}`);
  if(e.employmentStatus!=='Terminated')throw new AppError('Only explicitly terminated source employees are approved for this transfer.');
  const email=text(e.email,'Source account email',254,true);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new AppError('Source account email is invalid.');
  const hireDate=date(e.hireDate),exitDate=date(e.exitDate);if(exitDate<hireDate||exitDate>extractedAt.slice(0,10))throw new AppError('Departure date must follow hire and precede extraction.');
  if(!Array.isArray(e.history)||!e.history.length||e.history.length>100)throw new AppError('Each former employee needs its observed dated history.');
  const rows=e.history.map(validateSourceHistory).sort((a,b)=>a.kind.localeCompare(b.kind)||a.sourceOrder-b.sourceOrder);
  if(new Set(rows.map(h=>h.kind+':'+h.sourceOrder)).size!==rows.length)throw new AppError('Duplicate source history row.');
  if(rows.some(h=>h.effectiveDate>extractedAt.slice(0,10)))throw new AppError('History cannot be future-dated beyond source extraction.');
  const statuses=rows.filter((h):h is StatusHistory=>h.kind==='status').sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate)||a.sourceOrder-b.sourceOrder);
  if(statuses[0]?.status!=='Terminated'||statuses[0]?.effectiveDate!==exitDate)throw new AppError('Latest source status and departure date must verify former employment.');
  const employmentCategory=category(e.employmentCategory);if(statuses.find(h=>h.status!=='Terminated')?.status!==employmentCategory)throw new AppError('Last employment category needs source history evidence.');
  return {sourceId:sourceId(e.sourceId),name:text(e.name,'Name',180,true),email,phone:text(e.phone,'Directory phone',80),title:text(e.title,'Title'),department:text(e.department,'Department'),division:text(e.division,'Division'),location:text(e.location,'Location'),employmentStatus:'Terminated' as const,employmentCategory,employmentType:arrangement(e.employmentType),hireDate,exitDate,managerSourceId:managerId(e.managerSourceId),managerName:text(e.managerName,'Source reporting manager'),history:rows};
 }).sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
 if(new Set(employees.map(e=>e.sourceId)).size!==employees.length||new Set(employees.map(e=>e.email.toLowerCase())).size!==employees.length)throw new AppError('Duplicate former employee source ID or account email.');
 for(const e of employees)for(const m of [{managerSourceId:e.managerSourceId},...e.history.filter((h):h is ManagerHistory=>h.kind==='manager')])if(m.managerSourceId===e.sourceId)throw new AppError('An employee cannot be their own source reporting manager.');
 return {schemaVersion:1,sourceOrigin:FORMER_SOURCE_ORIGIN,extractedAt,employees};
}
export async function formerDigest(payload:Payload){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')}
export async function planFormerImport(raw:unknown){
 const payload=validateFormerImport(raw),digest=await formerDigest(payload),completed=await first<Batch>('SELECT * FROM migration_batches WHERE id=?',FORMER_IMPORT_ID);
 if(completed){if(completed.digest!==digest)throw new AppError('This one-time former-staff transfer already used a different snapshot.',409);return {payload,digest,completed,counts:JSON.parse(completed.counts_json) as Counts,entries:[]};}
 const existing=await all<Employee>("SELECT * FROM employees WHERE data_scope='live'");
 const links=await all<SourceLink>('SELECT source_id,employee_id,manager_source_id FROM source_employee_links');
 const ids=new Set([...links.map(l=>l.source_id),...payload.employees.map(e=>e.sourceId)]);
 const entries=payload.employees.map(entry=>{
  const id='talenthr:'+entry.sourceId.slice(1).replaceAll('/',':');
  if(links.some(l=>l.source_id===entry.sourceId||l.employee_id===id)||existing.some(e=>e.id===id||e.email.toLowerCase()===entry.email.toLowerCase()))throw new AppError('A former record conflicts with an existing profile. Nothing was changed; reconcile it first.',409);
  for(const m of [{managerSourceId:entry.managerSourceId},...entry.history.filter((h):h is ManagerHistory=>h.kind==='manager')])if(m.managerSourceId&&!ids.has(m.managerSourceId))throw new AppError('Source reporting manager must resolve to an existing or included source record.');
  return {entry,id};
 });
 // Latest reporting metadata must remain a well-formed source graph. It never
 // becomes the application's operational manager_id or grants any permission.
 const managers=new Map([...links.map(l=>[l.source_id,l.manager_source_id] as const),...entries.map(e=>[e.entry.sourceId,e.entry.managerSourceId] as const)]);
 for(const e of entries){const seen=new Set([e.entry.sourceId]);let next=e.entry.managerSourceId;while(next){if(seen.has(next))throw new AppError('Source reporting relationships contain a cycle.');seen.add(next);next=managers.get(next)??null;}}
 const rows=payload.employees.flatMap(e=>e.history);
 const counts:Counts={employees:entries.length,created:entries.length,former:entries.length,disabledAccess:entries.length,historyRows:rows.length,statusHistory:rows.filter(h=>h.kind==='status').length,managerHistory:rows.filter(h=>h.kind==='manager').length,jobHistory:rows.filter(h=>h.kind==='job').length,sourceReportingLinks:entries.filter(e=>e.entry.managerSourceId||e.entry.managerName).length};
 return {payload,digest,completed:null,counts,entries};
}
export function formerHistorySnapshot(entry:{sourceId:string;exitDate:string},row:History){
 const provenance={source_kind:row.kind,source_record:entry.sourceId,source_order:row.sourceOrder};
 if(row.kind==='status')return {...provenance,...(row.status==='Terminated'?{employment_status:'Terminated',exit_date:entry.exitDate}:{employment:row.status,source_employment_category:row.status})};
 if(row.kind==='manager')return {...provenance,source_manager_name:row.managerName,source_manager_id:row.managerSourceId};
 return {...provenance,title:row.title,work_arrangement:row.employmentType,location:row.location,division:row.division,department:row.department};
}
export async function applyFormerImport(raw:unknown,expectedDigest:unknown,actorId:string){
 const plan=await planFormerImport(raw);
 if(typeof expectedDigest!=='string'||expectedDigest!==plan.digest)throw new AppError('Preview this exact former-staff snapshot before importing.',409);
 if(plan.completed)return {ok:true,replayed:true,digest:plan.digest,counts:plan.counts,importedAt:plan.completed.imported_at};
 const timestamp=now(),commands=[db().prepare('INSERT INTO migration_batches (id,source_origin,digest,counts_json,imported_at) VALUES (?,?,?,?,?)').bind(FORMER_IMPORT_ID,FORMER_SOURCE_ORIGIN,plan.digest,JSON.stringify(plan.counts),timestamp)];
 for(const {entry:e,id} of plan.entries){
  commands.push(db().prepare('INSERT INTO employees (id,email,name,title,department,location,employment,hire_date,role,active,demo,created_at,manager_id,user_id) VALUES (?,?,?,?,?,?,?,?,?,0,0,?,NULL,NULL)').bind(id,e.email.toLowerCase(),e.name,e.title,e.department,e.location,e.employmentCategory,e.hireDate,'employee',timestamp));
  commands.push(db().prepare('INSERT INTO employee_profiles (employee_id,division,work_arrangement,employment_status,exit_date,updated_at) VALUES (?,?,?,?,?,?)').bind(id,e.division,e.employmentType,'Terminated',e.exitDate,timestamp));
  commands.push(db().prepare('INSERT INTO source_employee_links (source_id,employee_id,source_email,directory_phone,manager_source_id,manager_name,source_status,source_employment_type,review_flag,imported_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(e.sourceId,id,e.email,e.phone,e.managerSourceId,e.managerName,'Terminated',e.employmentType,'',timestamp));
  for(const row of e.history)commands.push(db().prepare('INSERT INTO employment_history (id,employee_id,effective_date,reason,snapshot,created_by,created_at) VALUES (?,?,?,?,?,?,?)').bind('talenthr-history:'+e.sourceId.slice(1).replaceAll('/',':')+':'+row.kind+':'+row.sourceOrder,id,row.effectiveDate,'Imported TalentHR '+({status:'employment status',manager:'reporting manager',job:'job information'}[row.kind])+' history',JSON.stringify(formerHistorySnapshot(e,row)),actorId,timestamp));
 }
 commands.push(db().prepare('INSERT INTO audit (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)').bind(uid(),actorId,`Imported ${plan.counts.employees} former TalentHR profiles and ${plan.counts.historyRows} ordinary employment-history rows; all new access disabled`,FORMER_IMPORT_ID,timestamp));
 // D1 batches are atomic. The unique ledger insert is the first statement and
 // locks this snapshot against concurrent/repeated imports without partial rows.
 try{await db().batch(commands)}catch{const saved=await first<Batch>('SELECT * FROM migration_batches WHERE id=?',FORMER_IMPORT_ID);if(saved?.digest===plan.digest)return {ok:true,replayed:true,digest:plan.digest,counts:JSON.parse(saved.counts_json) as Counts,importedAt:saved.imported_at};throw new AppError('Former-staff import was not committed. Reconcile conflicts and retry only the same approved snapshot.',409);}
 for(const {id,entry} of plan.entries){const verified=await first<{active:number;user_id:string|null;manager_id:string|null;employment_status:string;exit_date:string;source_status:string}>('SELECT e.active,e.user_id,e.manager_id,p.employment_status,p.exit_date,s.source_status FROM employees e JOIN employee_profiles p ON p.employee_id=e.id JOIN source_employee_links s ON s.employee_id=e.id WHERE e.id=? AND s.source_id=?',id,entry.sourceId);if(!verified||verified.active!==0||verified.user_id!==null||verified.manager_id!==null||verified.employment_status!=='Terminated'||verified.source_status!=='Terminated'||verified.exit_date!==entry.exitDate)throw new AppError('Import committed, but former-staff reconciliation needs review.',500);}
 return {ok:true,replayed:false,digest:plan.digest,counts:plan.counts,importedAt:timestamp};
}
