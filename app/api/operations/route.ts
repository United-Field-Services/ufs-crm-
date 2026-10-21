import {all,currentEmployee,db,first,now,uid,response,failure,businessDate} from '../../../lib/server';
import {AppError,loginEligibleSql,isHR,isManager,requireHR,requireManager,safeText,validDate,sameOrigin,jsonBody,scopeOf,scopeSql,type Employee} from '../../../lib/policy';
export const dynamic='force-dynamic';
const text=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const optDate=(v:unknown)=>v==null||v===''?null:validDate(v);
// A request's scope is server-owned. Recheck that the actor still belongs to it
// in the mutation, so an in-flight request cannot follow an account into another scope.
const actorSql=(actor:Employee,hr=false)=>`EXISTS (SELECT 1 FROM employees actor WHERE actor.id=? AND ${scopeSql(actor,'actor')} AND ${loginEligibleSql('actor')} AND actor.role IN (${hr?"'admin','hr_manager'":"'admin','hr_manager','manager','hiring_manager','employee'"}))`;
type WorkflowTemplate={id:string;name:string;kind:string;steps:string;active:number};
type AssetMovement={status:string;assigned_to:string|null;history_version:number};
type Statement=ReturnType<ReturnType<typeof db>['prepare']>;
function auditStatement(actor:Employee,action:string,target:string){
 return db().prepare(`INSERT INTO audit (id,actor_id,action,target_id,created_at,data_scope) SELECT ?,?,?,?,?,? WHERE changes()>0 AND ${actorSql(actor)}`).bind(uid(),actor.id,action,target,now(),scopeOf(actor),actor.id);
}
// D1 batches are transactions. changes() refers to the immediately preceding
// statement within this batch, so rejected/no-op writes never create audit rows.
async function auditedWrite(statement:Statement,actor:Employee,action:string,target:string,after:Statement[]=[]){
 const results=await db().batch([statement,...after,auditStatement(actor,action,target)]);
 return results[0];
}
function templateSteps(value:unknown){
 if(!Array.isArray(value)||!value.length||value.length>30)throw new AppError('Add 1–30 checklist steps.');
 return value.map((entry:unknown)=>{
  if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new AppError('Invalid checklist step.');
  const s=entry as Record<string,unknown>;
  const raw=s.offset;
  if((typeof raw!=='number'&&typeof raw!=='string')||String(raw).trim()==='')throw new AppError('Enter a due-date offset.');
  const offset=Number(raw);
  if(!Number.isInteger(offset)||offset< -90||offset>365)throw new AppError('Due-date offsets must be −90 to 365 days.');
  if(typeof s.assignee!=='string'||!['employee','manager','hr'].includes(s.assignee))throw new AppError('Select a valid step assignee.');
  return {title:safeText(s.title,'Step title',200),description:text(s.description,1000),offset,assignee:s.assignee as string};
 });
}
export async function GET(req?:Request){try{
 const me=await currentEmployee(),hr=isHR(me),manager=isManager(me),s=(alias:string)=>scopeSql(me,alias);
 const section=req?new URL(req.url).searchParams.get('section'):null;
 if(section!==null&&!['workflows','assets','news','time'].includes(section))throw new AppError('Unknown workspace section.');
 const includes=(name:string)=>section===null||section===name;
 // A module must not wait for unrelated private records. Keep the full response
 // for existing callers, with the same scope checks and final access recheck.
 const templates=hr&&includes('workflows')?await all<WorkflowTemplate>(`SELECT * FROM workflow_templates WHERE ${s('workflow_templates')} AND EXISTS (SELECT 1 FROM employees author WHERE author.id=workflow_templates.created_by AND ${s('author')}) ORDER BY kind,name`):[];
 const workflows=includes('workflows')?await all(`SELECT w.*,e.name AS employee_name,(SELECT COUNT(*) FROM tasks t WHERE t.workflow_id=w.id AND ${s('t')}) AS total,(SELECT COUNT(*) FROM tasks t WHERE t.workflow_id=w.id AND ${s('t')} AND t.status=?) AS completed FROM workflow_runs w JOIN employees e ON e.id=w.employee_id AND ${s('e')} WHERE ${s('w')} AND EXISTS (SELECT 1 FROM workflow_templates template WHERE template.id=w.template_id AND ${s('template')}) AND EXISTS (SELECT 1 FROM employees author WHERE author.id=w.created_by AND ${s('author')}) ${hr?'':`AND (w.employee_id=? OR EXISTS (SELECT 1 FROM tasks t WHERE t.workflow_id=w.id AND ${s('t')} AND t.assignee_id=?))`} ORDER BY w.created_at DESC`,'completed',...(hr?[]:[me.id,me.id])):[];
 const assets=includes('assets')?await all(`SELECT a.*,e.name AS employee_name FROM assets a LEFT JOIN employees e ON e.id=a.assigned_to AND ${s('e')} WHERE ${s('a')} AND (a.assigned_to IS NULL OR e.id IS NOT NULL) AND EXISTS (SELECT 1 FROM employees author WHERE author.id=a.created_by AND ${s('author')}) ${hr?'':'AND a.assigned_to=?'} ORDER BY a.name`,...(hr?[]:[me.id])):[];
 const notices=includes('news')?await all(`SELECT a.*,e.name AS author,${hr?`(SELECT COUNT(*) FROM announcement_reads r JOIN employees reader ON reader.id=r.employee_id AND ${s('reader')} WHERE r.announcement_id=a.id AND ${s('r')}) AS read_count,`:''}(SELECT read_at FROM announcement_reads r WHERE r.announcement_id=a.id AND ${s('r')} AND r.employee_id=?) AS read_at FROM announcements a JOIN employees e ON e.id=a.created_by AND ${s('e')} WHERE ${s('a')} ${hr?'':'AND a.status=?'} ORDER BY a.pinned DESC,a.created_at DESC`,me.id,...(hr?[]:['published'])):[];
 const timeEntries=includes('time')?await all(`SELECT t.*,e.name AS employee_name,m.name AS manager_name FROM time_entries t JOIN employees e ON e.id=t.employee_id AND ${s('e')} LEFT JOIN employees m ON m.id=t.required_manager_id AND ${s('m')} WHERE ${s('t')} AND (t.required_manager_id IS NULL OR m.id IS NOT NULL) AND (t.reviewed_by IS NULL OR EXISTS (SELECT 1 FROM employees reviewer WHERE reviewer.id=t.reviewed_by AND ${s('reviewer')})) ${hr?'':manager?"AND (t.employee_id=? OR (t.required_manager_id=? AND t.status IN ('submitted','approved','rejected')))":'AND t.employee_id=?'} ORDER BY t.date DESC,t.created_at DESC`,...(hr?[]:manager?[me.id,me.id]:[me.id])):[];
 const acknowledgements=section===null?await all(`SELECT a.document_id,a.employee_id,a.acknowledged_at,e.name AS employee_name FROM document_acknowledgements a JOIN employees e ON e.id=a.employee_id AND ${s('e')} JOIN documents d ON d.id=a.document_id AND ${s('d')} JOIN employees owner ON owner.id=d.owner_id AND ${s('owner')} WHERE ${s('a')} ${hr?'':'AND a.employee_id=?'}`,...(hr?[]:[me.id])):[];
 const fresh=await currentEmployee();if(fresh.id!==me.id||fresh.user_id!==me.user_id||fresh.role!==me.role||scopeOf(fresh)!==scopeOf(me))throw new AppError('Your access changed. Refresh the workspace.',403);
 return response({templates:templates.filter(t=>t.active===1).map(t=>({...t,steps:JSON.parse(t.steps)})),archivedTemplates:templates.filter(t=>t.active===0).map(t=>({...t,steps:JSON.parse(t.steps)})),workflows,assets,announcements:notices,timeEntries,acknowledgements,today:businessDate()});
}catch(e){return failure(e)}}
export async function POST(req:Request){try{
 sameOrigin(req);const me=await currentEmployee(),b=await jsonBody(req);const action=b.action,scope=scopeOf(me),s=(alias:string)=>scopeSql(me,alias),activeActor=actorSql(me),activeHR=actorSql(me,true);
 if(action==='saveTemplate'){
  requireHR(me);const name=safeText(b.name,'Template name'),kind=b.kind===undefined?'Onboarding':b.kind,steps=templateSteps(b.steps);
  if(kind!=='Onboarding'&&kind!=='Offboarding')throw new AppError('Select an onboarding or offboarding workflow.');
  const id=b.id?safeText(b.id,'Template'):uid();if(b.id&&!await first(`SELECT id FROM workflow_templates WHERE id=? AND ${s('workflow_templates')} AND active=1`,id))throw new AppError('Template not found.',404);
  const statement=db().prepare(`INSERT INTO workflow_templates (id,name,kind,steps,created_by,updated_at,data_scope) SELECT ?,?,?,?,?,?,? WHERE ${activeHR} AND (?=0 OR EXISTS (SELECT 1 FROM workflow_templates WHERE id=? AND ${s('workflow_templates')} AND active=1 AND EXISTS (SELECT 1 FROM employees author WHERE author.id=workflow_templates.created_by AND ${s('author')}))) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,steps=excluded.steps,updated_at=excluded.updated_at WHERE ${s('workflow_templates')} AND workflow_templates.active=1`).bind(id,name,kind,JSON.stringify(steps),me.id,now(),scope,me.id,b.id?1:0,id);
  const r=await auditedWrite(statement,me,b.id?'Updated workflow template':'Created workflow template',id);
  if(!r.meta.changes)throw new AppError('The template or your access changed. Refresh before trying again.',409);
  return response({ok:true,id});
 }
 if(action==='applyTemplate'){
  requireHR(me);const templateId=safeText(b.templateId,'Template'),employeeId=safeText(b.employeeId,'Employee'),startDate=validDate(b.startDate);
  const template=await first<WorkflowTemplate>(`SELECT * FROM workflow_templates WHERE id=? AND ${s('workflow_templates')} AND active=1`,templateId),employee=await first<Pick<Employee,'id'|'manager_id'>>(`SELECT id,manager_id FROM employees WHERE id=? AND ${s('employees')} AND active=1`,employeeId);
  if(!template||!employee)throw new AppError('Choose an active employee and template.',404);
  let storedSteps:unknown;try{storedSteps=JSON.parse(template.steps)}catch{throw new AppError('This template needs to be corrected before it can be started.',409)}
  const steps=templateSteps(storedSteps),needsManager=steps.some(s=>s.assignee==='manager');
  if(needsManager&&(!employee.manager_id||employee.manager_id===employeeId||!await first(`SELECT id FROM employees WHERE id=? AND ${s('employees')} AND active=1 AND role IN ('manager','hr_manager','admin')`,employee.manager_id)))throw new AppError('Assign an active manager before starting a workflow with manager tasks.');
  const datedSteps=steps.map(step=>{
   const date=new Date(startDate+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+step.offset);
   // Keep due dates inside the supported four-digit calendar range.
   return {...step,dueDate:validDate(date.toISOString().split('T')[0])};
  });
  const id=uid(),stamp=now();
  const commands=[db().prepare(`INSERT INTO workflow_runs (id,template_id,employee_id,name,kind,start_date,created_by,created_at,data_scope) SELECT ?,?,?,?,?,?,?,?,? WHERE ${activeHR} AND EXISTS (SELECT 1 FROM workflow_templates template WHERE template.id=? AND ${s('template')} AND template.active=1 AND template.name=? AND template.kind=? AND template.steps=? AND EXISTS (SELECT 1 FROM employees author WHERE author.id=template.created_by AND ${s('author')})) AND EXISTS (SELECT 1 FROM employees e WHERE e.id=? AND ${s('e')} AND e.active=1 AND e.manager_id IS ? AND (?=0 OR EXISTS (SELECT 1 FROM employees m WHERE m.id=e.manager_id AND ${s('m')} AND m.id<>e.id AND m.active=1 AND m.role IN ('manager','hr_manager','admin'))))`).bind(id,templateId,employeeId,template.name,template.kind,startDate,me.id,stamp,scope,me.id,templateId,template.name,template.kind,template.steps,employeeId,employee.manager_id,needsManager?1:0)];
  for(const step of datedSteps){
   const assignee=step.assignee==='employee'?employeeId:step.assignee==='manager'?employee.manager_id:me.id;
   commands.push(db().prepare(`INSERT INTO tasks (id,title,description,assignee_id,related_employee_id,due_date,status,created_by,created_at,workflow_id,data_scope) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${activeHR} AND EXISTS (SELECT 1 FROM workflow_runs w JOIN employees subject ON subject.id=w.employee_id AND ${s('subject')} JOIN workflow_templates template ON template.id=w.template_id AND ${s('template')} WHERE w.id=? AND ${s('w')} AND w.created_by=? AND subject.active=1) AND EXISTS (SELECT 1 FROM employees assignee WHERE assignee.id=? AND ${s('assignee')} AND assignee.active=1)`).bind(uid(),step.title,step.description,assignee,employeeId,step.dueDate,'pending',me.id,stamp,id,scope,me.id,id,me.id,assignee));
  }
  commands.push(auditStatement(me,'Started employee checklist',id));
  const results=await db().batch(commands);
  if(!results[0].meta.changes)throw new AppError('The template, employee, manager, or your access changed. Refresh before trying again.',409);
  return response({ok:true,id,message:`${steps.length} assigned tasks created. No email or external account changes were made.`});
 }
 if(action==='archiveTemplate'||action==='restoreTemplate'){
  requireHR(me);const id=safeText(b.id,'Template'),restoring=action==='restoreTemplate';
  // Only the template's availability changes. Runs and assigned tasks retain
  // their immutable template reference and are never deleted or restarted.
  const r=await auditedWrite(db().prepare(`UPDATE workflow_templates SET active=?,updated_at=? WHERE id=? AND ${s('workflow_templates')} AND active=? AND ${activeHR} AND EXISTS (SELECT 1 FROM employees author WHERE author.id=workflow_templates.created_by AND ${s('author')})`).bind(restoring?1:0,now(),id,restoring?0:1,me.id),me,restoring?'Restored workflow template':'Archived workflow template',id);
  if(!r.meta.changes)throw new AppError('Template not found, already changed, or your access changed. Refresh before trying again.',404);
  return response({ok:true,message:restoring?'Template restored. It can be started again. Existing checklists and tasks are unchanged.':'Template archived. Existing checklists and tasks are unchanged. You can restore it from Archived templates.'});
 }
 if(action==='saveAsset'){
  requireHR(me);const id=b.id?safeText(b.id,'Asset'):uid(),name=safeText(b.name,'Asset name'),tag=safeText(b.tag,'Asset tag',80),category=safeText(b.category,'Category',80);
  if(b.id&&!await first(`SELECT id FROM assets WHERE id=? AND ${s('assets')}`,id))throw new AppError('Asset not found.',404);
  // Tag uniqueness is local to scope and checked in the actual write.
  const statement=b.id
   ?db().prepare(`UPDATE assets SET name=?,category=?,tag=?,serial=?,notes=?,updated_at=? WHERE id=? AND ${s('assets')} AND ${activeHR} AND EXISTS (SELECT 1 FROM employees author WHERE author.id=assets.created_by AND ${s('author')}) AND (assigned_to IS NULL OR EXISTS (SELECT 1 FROM employees assignee WHERE assignee.id=assets.assigned_to AND ${s('assignee')})) AND NOT EXISTS (SELECT 1 FROM assets other WHERE other.tag=? AND other.id<>? AND ${s('other')})`).bind(name,category,tag,text(b.serial,150),text(b.notes,1000),now(),id,me.id,tag,id)
   :db().prepare(`INSERT INTO assets (id,name,category,tag,serial,notes,created_by,updated_at,data_scope) SELECT ?,?,?,?,?,?,?,?,? WHERE ${activeHR} AND NOT EXISTS (SELECT 1 FROM assets WHERE tag=? AND ${s('assets')})`).bind(id,name,category,tag,text(b.serial,150),text(b.notes,1000),me.id,now(),scope,me.id,tag);
  const r=await auditedWrite(statement,me,b.id?'Updated asset':'Created asset',id);
  if(!r.meta.changes)throw new AppError('That asset tag is already in use, or the asset or your access changed.',409);
  return response({ok:true,id});
 }
 if(action==='assignAsset'||action==='returnAsset'||action==='setAssetStatus'){
  requireHR(me);const id=safeText(b.id,'Asset'),asset=await first<AssetMovement>(`SELECT a.*,(SELECT COUNT(*) FROM asset_history h WHERE h.asset_id=a.id AND ${s('h')}) AS history_version FROM assets a WHERE a.id=? AND ${s('a')}`,id);if(!asset)throw new AppError('Asset not found.',404);
  let employeeId:string|null=null,status='available',returnDue:string|null=null,assignedAt:string|null=null;
  if(action==='assignAsset'){
   employeeId=safeText(b.employeeId,'Employee');if(!await first(`SELECT id FROM employees WHERE id=? AND ${s('employees')} AND active=1`,employeeId))throw new AppError('Choose an active employee.');
   if(asset.status!=='available')throw new AppError('Return an assigned asset before assigning it again.',409);status='assigned';returnDue=optDate(b.returnDue);assignedAt=now();
  }
  if(action==='returnAsset'&&asset.status!=='assigned')throw new AppError('Only assigned assets can be returned.',409);
  if(action==='setAssetStatus'){if(asset.status==='assigned')throw new AppError('Return this asset before changing its inventory status.',409);if(typeof b.status!=='string'||!['available','maintenance','retired'].includes(b.status))throw new AppError('Select an inventory status.');status=b.status}
  const statement=db().prepare(`UPDATE assets SET status=?,assigned_to=?,assigned_at=?,return_due=?,updated_at=? WHERE id=? AND ${s('assets')} AND status=? AND assigned_to IS ? AND (SELECT COUNT(*) FROM asset_history h WHERE h.asset_id=assets.id AND ${s('h')})=? AND ${activeHR} AND EXISTS (SELECT 1 FROM employees author WHERE author.id=assets.created_by AND ${s('author')}) AND (assets.assigned_to IS NULL OR EXISTS (SELECT 1 FROM employees previous WHERE previous.id=assets.assigned_to AND ${s('previous')})) AND (? IS NULL OR EXISTS (SELECT 1 FROM employees WHERE id=? AND ${s('employees')} AND active=1))`).bind(status,employeeId,assignedAt,returnDue,now(),id,asset.status,asset.assigned_to,asset.history_version,me.id,employeeId,employeeId);
  const historyEmployee=employeeId||asset.assigned_to;
  const history=db().prepare(`INSERT INTO asset_history (id,asset_id,employee_id,action,actor_id,created_at,data_scope) SELECT ?,?,?,?,?,?,? WHERE changes()>0 AND ${activeHR} AND EXISTS (SELECT 1 FROM assets WHERE id=? AND ${s('assets')}) AND (? IS NULL OR EXISTS (SELECT 1 FROM employees WHERE id=? AND ${s('employees')}))`).bind(uid(),id,historyEmployee,action,me.id,now(),scope,me.id,id,historyEmployee,historyEmployee);
  const r=await auditedWrite(statement,me,action==='assignAsset'?'Assigned asset':action==='returnAsset'?'Recorded asset return':'Updated inventory status',id,[history]);
  if(!r.meta.changes)throw new AppError('The asset, employee, or your access changed. Refresh before trying again.',409);
  return response({ok:true});
 }
 if(action==='saveAnnouncement'){
  requireHR(me);const id=b.id?safeText(b.id,'Announcement'):uid(),title=safeText(b.title,'Title',180),body=safeText(b.body,'Announcement',6000),status=b.status===undefined?'draft':b.status;
  if(status!=='published'&&status!=='draft')throw new AppError('Select draft or published status.');
  if(b.id&&!await first(`SELECT id FROM announcements WHERE id=? AND ${s('announcements')}`,id))throw new AppError('Announcement not found.',404);
  const statement=db().prepare(`INSERT INTO announcements (id,title,body,category,status,pinned,created_by,created_at,published_at,data_scope) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${activeHR} AND (?=0 OR EXISTS (SELECT 1 FROM announcements WHERE id=? AND ${s('announcements')} AND EXISTS (SELECT 1 FROM employees author WHERE author.id=announcements.created_by AND ${s('author')}))) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,category=excluded.category,status=excluded.status,pinned=excluded.pinned,published_at=COALESCE(announcements.published_at,excluded.published_at) WHERE ${s('announcements')}`).bind(id,title,body,text(b.category,80)||'Company news',status,b.pinned===true?1:0,me.id,now(),status==='published'?now():null,scope,me.id,b.id?1:0,id);
  const r=await auditedWrite(statement,me,status==='published'?'Published internal announcement':'Saved announcement draft',id);
  if(!r.meta.changes)throw new AppError('The announcement or your access changed. Refresh before trying again.',409);
  return response({ok:true,id});
 }
 if(action==='readAnnouncement'){
  const id=safeText(b.id,'Announcement');
  const r=await db().prepare(`INSERT OR IGNORE INTO announcement_reads (id,announcement_id,employee_id,read_at,data_scope) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM announcements a JOIN employees author ON author.id=a.created_by AND ${s('author')} WHERE a.id=? AND ${s('a')} AND a.status=?) AND ${activeActor}`).bind(`${id}:${me.id}`,id,me.id,now(),scope,id,'published',me.id).run();
  if(!r.meta.changes&&!await first(`SELECT r.id FROM announcement_reads r JOIN announcements a ON a.id=r.announcement_id AND ${s('a')} JOIN employees author ON author.id=a.created_by AND ${s('author')} WHERE a.id=? AND a.status=? AND r.employee_id=? AND ${s('r')} AND ${activeActor}`,id,'published',me.id,me.id))throw new AppError('Announcement not found.',404);
  return response({ok:true});
 }
 if(action==='saveTime'){
  const id=b.id?safeText(b.id,'Time entry'):uid(),date=validDate(b.date),raw=b.minutes;
  if((typeof raw!=='string'&&typeof raw!=='number')||String(raw).trim()==='')throw new AppError('Enter minutes worked.');const minutes=Number(raw);
  if(!Number.isInteger(minutes)||minutes<1||minutes>1440)throw new AppError('Minutes must be between 1 and 1,440.');if(date>businessDate())throw new AppError('Log completed work on today or an earlier date.');
  if(b.id&&!await first(`SELECT id FROM time_entries WHERE id=? AND ${s('time_entries')} AND employee_id=? AND status IN ('draft','rejected')`,id,me.id))throw new AppError('Only your own draft or returned entries can be edited.',403);
  const statement=db().prepare(`INSERT INTO time_entries (id,employee_id,date,minutes,project,notes,status,created_at,updated_at,data_scope) SELECT ?,?,?,?,?,?,'draft',?,?,? WHERE ${activeActor} AND (SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE employee_id=? AND ${s('time_entries')} AND date=? AND id<>? AND status<>'cancelled') + ? <= 1440 AND (?=0 OR EXISTS (SELECT 1 FROM time_entries WHERE id=? AND ${s('time_entries')} AND employee_id=? AND status IN ('draft','rejected') AND (required_manager_id IS NULL OR EXISTS (SELECT 1 FROM employees manager WHERE manager.id=time_entries.required_manager_id AND ${s('manager')})) AND (reviewed_by IS NULL OR EXISTS (SELECT 1 FROM employees reviewer WHERE reviewer.id=time_entries.reviewed_by AND ${s('reviewer')})))) ON CONFLICT(id) DO UPDATE SET date=excluded.date,minutes=excluded.minutes,project=excluded.project,notes=excluded.notes,status='draft',required_manager_id=NULL,reviewed_by=NULL,review_note='',updated_at=excluded.updated_at WHERE ${s('time_entries')} AND time_entries.employee_id=? AND time_entries.status IN ('draft','rejected')`).bind(id,me.id,date,minutes,text(b.project,150),text(b.notes,1000),now(),now(),scope,me.id,me.id,date,id,minutes,b.id?1:0,id,me.id,me.id);
  const r=await auditedWrite(statement,me,'Saved own time entry',id);
  if(!r.meta.changes)throw new AppError('Daily entries exceed 24 hours, or this entry or your account is no longer editable.',409);
  return response({ok:true,id});
 }
 if(action==='submitTime'){
  const id=safeText(b.id,'Time entry');if(!me.manager_id||!await first(`SELECT id FROM employees WHERE id=? AND ${s('employees')} AND active=1 AND role IN ('manager','hr_manager','admin')`,me.manager_id))throw new AppError('An active required manager must be assigned before submitting.');if(me.manager_id===me.id)throw new AppError('You cannot review your own time.',403);
  const statement=db().prepare(`UPDATE time_entries SET status='submitted',required_manager_id=(SELECT manager_id FROM employees WHERE id=? AND ${s('employees')}),reviewed_by=NULL,review_note='',updated_at=? WHERE id=? AND ${s('time_entries')} AND employee_id=? AND status IN ('draft','rejected') AND ${activeActor} AND (time_entries.required_manager_id IS NULL OR EXISTS (SELECT 1 FROM employees previous WHERE previous.id=time_entries.required_manager_id AND ${s('previous')})) AND (time_entries.reviewed_by IS NULL OR EXISTS (SELECT 1 FROM employees reviewer WHERE reviewer.id=time_entries.reviewed_by AND ${s('reviewer')})) AND EXISTS (SELECT 1 FROM employees e JOIN employees m ON m.id=e.manager_id AND ${s('m')} WHERE e.id=? AND ${s('e')} AND e.active=1 AND m.active=1 AND m.role IN ('manager','hr_manager','admin') AND m.id<>e.id)`).bind(me.id,now(),id,me.id,me.id,me.id);
  const r=await auditedWrite(statement,me,'Submitted time entry',id);
  if(!r.meta.changes)throw new AppError('Only your own draft or returned entries can be submitted.',403);return response({ok:true});
 }
 if(action==='reviewTime'){
  requireManager(me);
  const id=safeText(b.id,'Time entry'),status=b.status;if(status!=='approved'&&status!=='rejected')throw new AppError('Choose approve or return.');
  const statement=db().prepare(`UPDATE time_entries SET status=?,review_note=?,reviewed_by=?,updated_at=? WHERE id=? AND ${s('time_entries')} AND required_manager_id=? AND employee_id<>? AND status='submitted' AND EXISTS (SELECT 1 FROM employees e WHERE e.id=time_entries.employee_id AND ${s('e')} AND e.active=1) AND (time_entries.reviewed_by IS NULL OR EXISTS (SELECT 1 FROM employees previous WHERE previous.id=time_entries.reviewed_by AND ${s('previous')})) AND EXISTS (SELECT 1 FROM employees reviewer WHERE reviewer.id=? AND ${s('reviewer')} AND ${loginEligibleSql('reviewer')} AND reviewer.role IN ('manager','hr_manager','admin'))`).bind(status,text(b.note,500),me.id,now(),id,me.id,me.id,me.id);
  const r=await auditedWrite(statement,me,status==='approved'?'Approved time entry':'Returned time entry',id);
  if(!r.meta.changes)throw new AppError('Only the assigned manager may review an employee’s submitted time.',403);return response({ok:true});
 }
 if(action==='deleteTime'){
  const id=safeText(b.id,'Time entry');
  const statement=db().prepare(`UPDATE time_entries SET status='cancelled',updated_at=? WHERE id=? AND ${s('time_entries')} AND employee_id=? AND status IN ('draft','rejected') AND ${activeActor} AND (required_manager_id IS NULL OR EXISTS (SELECT 1 FROM employees manager WHERE manager.id=time_entries.required_manager_id AND ${s('manager')})) AND (reviewed_by IS NULL OR EXISTS (SELECT 1 FROM employees reviewer WHERE reviewer.id=time_entries.reviewed_by AND ${s('reviewer')}))`).bind(now(),id,me.id,me.id);
  const r=await auditedWrite(statement,me,'Cancelled time entry',id);
  if(!r.meta.changes)throw new AppError('Only your own draft or returned entries can be cancelled.',403);return response({ok:true});
 }
 if(action==='acknowledgeDocument'){
  const id=safeText(b.id,'Document');
  const statement=db().prepare(`INSERT OR IGNORE INTO document_acknowledgements (id,document_id,employee_id,acknowledged_at,data_scope) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM documents d JOIN employees owner ON owner.id=d.owner_id AND ${s('owner')} WHERE d.id=? AND ${s('d')} AND d.visibility=? AND d.archived=0) AND ${activeActor}`).bind(`${id}:${me.id}`,id,me.id,now(),scope,id,'company',me.id);
  const r=await auditedWrite(statement,me,'Acknowledged company document (not a signature)',id);
  if(!r.meta.changes&&!await first(`SELECT a.id FROM document_acknowledgements a JOIN documents d ON d.id=a.document_id AND ${s('d')} JOIN employees owner ON owner.id=d.owner_id AND ${s('owner')} WHERE d.id=? AND d.visibility=? AND d.archived=0 AND a.employee_id=? AND ${s('a')} AND ${activeActor}`,id,'company',me.id,me.id))throw new AppError('Company document not found.',404);
  return response({ok:true});
 }
 throw new AppError('Unknown operation.');
}catch(e){return failure(e)}}
