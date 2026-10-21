import {all,db,first,now,uid} from './server';
import {AppError} from './policy';
import {FORMER_SOURCE_ORIGIN,validateSourceHistory,formerHistorySnapshot,type History} from './former-import';

export const CURRENT_HISTORY_IMPORT_ID='talenthr-current-history-v1';
type Entry={sourceId:string;history:History[]};
type Payload={schemaVersion:1;sourceOrigin:string;extractedAt:string;employees:Entry[]};
type Batch={id:string;digest:string;counts_json:string;imported_at:string};
type Counts={employees:number;historyRows:number;statusHistory:number;managerHistory:number;jobHistory:number};
function object(raw:unknown,keys:string[]){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AppError('History import must be an object.');const value=raw as Record<string,unknown>;if(Object.keys(value).some(k=>!keys.includes(k)))throw new AppError('Fields outside ordinary source employment history are not approved.');return value;}
export function validateCurrentHistoryImport(raw:unknown):Payload{
 const b=object(raw,['schemaVersion','sourceOrigin','extractedAt','employees']);
 if(b.schemaVersion!==1||b.sourceOrigin!==FORMER_SOURCE_ORIGIN)throw new AppError('Unsupported current-history source or version.');
 if(typeof b.extractedAt!=='string'||b.extractedAt.length>40||!/^\d{4}-\d\d-\d\dT/.test(b.extractedAt)||Number.isNaN(Date.parse(b.extractedAt)))throw new AppError('History extraction time is invalid.');
 const extractedAt=b.extractedAt;
 if(!Array.isArray(b.employees)||!b.employees.length||b.employees.length>100)throw new AppError('History requires 1–100 current source profiles.');
 const employees=b.employees.map(raw=>{
  const e=object(raw,['sourceId','history']);if(typeof e.sourceId!=='string'||!/^\/(people\/\d+|my-profile)$/.test(e.sourceId))throw new AppError('History must use observed source profile paths.');
  if(!Array.isArray(e.history)||!e.history.length||e.history.length>100)throw new AppError('Current source history is empty or oversized.');
  const history=e.history.map(validateSourceHistory).sort((a,b)=>a.kind.localeCompare(b.kind)||a.sourceOrder-b.sourceOrder);
  if(new Set(history.map(h=>h.kind+':'+h.sourceOrder)).size!==history.length)throw new AppError('Duplicate source history row.');
  if(history.some(h=>h.effectiveDate>extractedAt.slice(0,10)))throw new AppError('History may not be future-dated beyond extraction.');
  const statuses=history.filter(h=>h.kind==='status').sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate)||a.sourceOrder-b.sourceOrder);
  if(!statuses.length||statuses[0].status==='Terminated')throw new AppError('This snapshot does not verify current source employment.');
  if(history.some(h=>h.kind==='manager'&&h.managerSourceId===e.sourceId))throw new AppError('Self-reporting source history is invalid.');
  return {sourceId:e.sourceId,history};
 }).sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
 if(new Set(employees.map(e=>e.sourceId)).size!==employees.length)throw new AppError('Duplicate current source employee.');
 return {schemaVersion:1,sourceOrigin:FORMER_SOURCE_ORIGIN,extractedAt,employees};
}
export async function currentHistoryDigest(p:Payload){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(p)));return Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,'0')).join('')}
export async function planCurrentHistoryImport(raw:unknown){
 const payload=validateCurrentHistoryImport(raw),digest=await currentHistoryDigest(payload),completed=await first<Batch>('SELECT * FROM migration_batches WHERE id=?',CURRENT_HISTORY_IMPORT_ID);
 if(completed){if(completed.digest!==digest)throw new AppError('Current employment history already used a different source snapshot.',409);return {payload,digest,completed,counts:JSON.parse(completed.counts_json) as Counts,entries:[]};}
 const links=await all<{source_id:string;employee_id:string;source_status:string;demo:number;employment_status:string}>('SELECT s.source_id,s.employee_id,s.source_status,e.demo,p.employment_status FROM source_employee_links s JOIN employees e ON e.id=s.employee_id LEFT JOIN employee_profiles p ON p.employee_id=e.id');
 const sourceIds=new Set(links.map(l=>l.source_id));
 const entries=payload.employees.map(entry=>{
  const link=links.find(l=>l.source_id===entry.sourceId);
  if(!link||link.demo||['terminated','inactive','archived'].includes(link.source_status.toLowerCase())||['terminated','inactive'].includes((link.employment_status||'').toLowerCase()))throw new AppError('History source must resolve to an existing current non-demo profile.',409);
  for(const row of entry.history)if(row.kind==='manager'&&row.managerSourceId&&!sourceIds.has(row.managerSourceId))throw new AppError('Historical reporting manager is unresolved. Import its source profile first.',409);
  return {entry,id:link.employee_id};
 });
 const existing=new Set((await all<{id:string}>('SELECT id FROM employment_history')).map(h=>h.id));
 for(const {entry} of entries)for(const h of entry.history)if(existing.has(historyId(entry,h)))throw new AppError('Source history row already exists outside this ledger. Reconcile before importing.',409);
 const rows=entries.flatMap(e=>e.entry.history),counts:Counts={employees:entries.length,historyRows:rows.length,statusHistory:rows.filter(h=>h.kind==='status').length,managerHistory:rows.filter(h=>h.kind==='manager').length,jobHistory:rows.filter(h=>h.kind==='job').length};
 return {payload,digest,completed:null,counts,entries};
}
function historyId(e:Entry,h:History){return 'talenthr-history:'+e.sourceId.slice(1).replaceAll('/',':')+':'+h.kind+':'+h.sourceOrder;}
export async function applyCurrentHistoryImport(raw:unknown,expectedDigest:unknown,actorId:string){
 const plan=await planCurrentHistoryImport(raw);if(expectedDigest!==plan.digest)throw new AppError('Preview this exact current-history snapshot before importing.',409);
 if(plan.completed)return {ok:true,replayed:true,digest:plan.digest,counts:plan.counts,importedAt:plan.completed.imported_at};
 const timestamp=now(),commands=[db().prepare('INSERT INTO migration_batches (id,source_origin,digest,counts_json,imported_at) VALUES (?,?,?,?,?)').bind(CURRENT_HISTORY_IMPORT_ID,FORMER_SOURCE_ORIGIN,plan.digest,JSON.stringify(plan.counts),timestamp)];
 for(const {entry,id} of plan.entries)for(const row of entry.history)commands.push(db().prepare('INSERT INTO employment_history (id,employee_id,effective_date,reason,snapshot,created_by,created_at) VALUES (?,?,?,?,?,?,?)').bind(historyId(entry,row),id,row.effectiveDate,'Imported TalentHR '+({status:'employment status',manager:'reporting manager',job:'job information'}[row.kind])+' history',JSON.stringify(formerHistorySnapshot({sourceId:entry.sourceId,exitDate:row.kind==='status'&&row.status==='Terminated'?row.effectiveDate:''},row)),actorId,timestamp));
 commands.push(db().prepare('INSERT INTO audit (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)').bind(uid(),actorId,`Imported ${plan.counts.historyRows} ordinary TalentHR employment-history rows for ${plan.counts.employees} current profiles; current fields and access unchanged`,CURRENT_HISTORY_IMPORT_ID,timestamp));
 try{await db().batch(commands)}catch{const saved=await first<Batch>('SELECT * FROM migration_batches WHERE id=?',CURRENT_HISTORY_IMPORT_ID);if(saved?.digest===plan.digest)return {ok:true,replayed:true,digest:plan.digest,counts:JSON.parse(saved.counts_json) as Counts,importedAt:saved.imported_at};throw new AppError('Current employment history was not committed. Reconcile conflicts before retrying the same snapshot.',409);}
 return {ok:true,replayed:false,digest:plan.digest,counts:plan.counts,importedAt:timestamp};
}
