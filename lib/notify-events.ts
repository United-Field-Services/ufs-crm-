import {all,first} from './server';
import {formatDate} from './format';
import {notify} from './notifications';
import {scopeOf,type Employee} from './policy';

// What happens when someone acts: each helper looks the record up by id and tells the right people.
// They never throw, so a notification problem can never undo or block the action that triggered it.

const days=(count:number)=>`${count} ${count===1?'day':'days'}`;
const range=(start:string,end:string)=>start===end?formatDate(start):`${formatDate(start)} to ${formatDate(end)}`;
const hrIds=async(scope:string)=>(await all<{id:string}>("SELECT id FROM employees WHERE role IN ('admin','hr_manager') AND active=1 AND demo=0 AND data_scope=?",scope)).map(row=>row.id);

type Leave={scope:string;employee_id:string;required_manager_id:string|null;type:string;start_date:string;end_date:string;days:number;name:string;review_note:string;status:string};
const leave=(id:string)=>first<Leave>('SELECT l.data_scope AS scope,l.employee_id,l.required_manager_id,l.type,l.start_date,l.end_date,l.days,l.review_note,l.status,e.name FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE l.id=?',id);

export async function onLeaveRequested(id:string){
 try{
  const l=await leave(id);if(!l)return;
  if(l.required_manager_id)await notify({recipients:l.required_manager_id,kind:'leave_request',title:`${l.name} asked for ${days(l.days)} of ${l.type}`,body:range(l.start_date,l.end_date),link:'/time-off',relatedId:id,dedupeKey:`leave-request:${id}`,scope:l.scope});
  // Nobody can approve a request with no approver, so HR hears about it straight away.
  else await notify({scope:l.scope,recipients:await hrIds(l.scope),kind:'approval_escalation',title:`${l.name}’s time-off request has no approver`,body:`${l.type}, ${range(l.start_date,l.end_date)}. Assign a manager so it can be decided.`,link:'/people',relatedId:id,dedupeKey:`leave-no-approver:${id}`});
 }catch{/* never blocks the request */}
}

export async function onLeaveReviewed(me:Employee,id:string){
 try{
  const l=await leave(id);if(!l)return;
  const approved=l.status==='approved';
  await notify({recipients:l.employee_id,kind:'leave_decision',title:`Your ${l.type} request was ${approved?'approved':'declined'}`,body:`${range(l.start_date,l.end_date)} · ${approved?'Approved':'Declined'} by ${me.name}.${l.review_note?`\nNote: ${l.review_note}`:''}`,link:'/time-off',relatedId:id,dedupeKey:`leave-decision:${id}`,scope:l.scope});
 }catch{/* ignore */}
}

export async function onLeaveCancelled(id:string){
 try{
  const l=await leave(id);if(!l||!l.required_manager_id)return;
  await notify({recipients:l.required_manager_id,kind:'leave_cancelled',title:`${l.name} cancelled a ${l.type} request`,body:range(l.start_date,l.end_date),link:'/time-off',relatedId:id,dedupeKey:`leave-cancelled:${id}`,scope:l.scope});
 }catch{/* ignore */}
}

export async function onTasksAssigned(me:Employee,where:'id'|'workflow_id',value:string){
 try{
  const scope=scopeOf(me),tasks=await all<{id:string;title:string;assignee_id:string;due_date:string}>(`SELECT id,title,assignee_id,due_date FROM tasks WHERE ${where}=? AND data_scope=?`,value,scope);
  const mine=tasks.filter(task=>task.assignee_id!==me.id);
  // A checklist can create many tasks at once: one message per person, not one per task.
  const perPerson=new Map<string,typeof tasks>();
  for(const task of mine)perPerson.set(task.assignee_id,[...(perPerson.get(task.assignee_id)||[]),task]);
  for(const [person,items] of perPerson)await notify({recipients:person,kind:'task_assigned',title:items.length===1?`New task: ${items[0].title}`:`${items.length} new tasks assigned to you`,body:items.length===1?`Due ${formatDate(items[0].due_date)}.`:items.slice(0,5).map(item=>`• ${item.title} (due ${formatDate(item.due_date)})`).join('\n')+(items.length>5?`\n…and ${items.length-5} more`:''),link:'/tasks',relatedId:items[0].id,dedupeKey:`task-assigned:${where==='workflow_id'?value+':'+person:items[0].id}`,scope});
 }catch{/* ignore */}
}

export async function onAccessChanged(me:Employee,employeeId:string,role:string,active:number){
 try{
  if(employeeId===me.id)return;
  const label=({admin:'Super admin',hr_manager:'HR',manager:'Manager',hiring_manager:'Hiring manager',employee:'Employee'} as Record<string,string>)[role]||role;
  await notify({recipients:employeeId,kind:'access_changed',title:active?`Your UFS People role is now ${label}`:'Your UFS People account was deactivated',body:active?`${me.name} updated your access. What you can see and do may have changed.`:`${me.name} turned off your access.`,link:'/',relatedId:employeeId,scope:scopeOf(me),dedupeKey:`access:${employeeId}:${role}:${active}:${new Date().toISOString().slice(0,13)}`});
 }catch{/* ignore */}
}

export async function onTimeSubmitted(id:string){
 try{
  const t=await first<{scope:string;required_manager_id:string|null;date:string;minutes:number;name:string}>('SELECT t.data_scope AS scope,t.required_manager_id,t.date,t.minutes,e.name FROM time_entries t JOIN employees e ON e.id=t.employee_id WHERE t.id=?',id);
  if(!t?.required_manager_id)return;
  await notify({recipients:t.required_manager_id,kind:'time_submitted',title:`${t.name} submitted ${(t.minutes/60).toFixed(1)} hours for review`,body:formatDate(t.date),link:'/time-tracking',relatedId:id,scope:t.scope,dedupeKey:`time-submitted:${id}:${t.minutes}`});
 }catch{/* ignore */}
}

export async function onTimeReviewed(me:Employee,id:string){
 try{
  const t=await first<{employee_id:string;date:string;status:string;review_note:string}>('SELECT employee_id,date,status,review_note FROM time_entries WHERE id=? AND data_scope=?',id,scopeOf(me));
  if(!t)return;
  const approved=t.status==='approved';
  await notify({recipients:t.employee_id,kind:'time_decision',title:approved?'Your time entry was approved':'Your time entry was returned for correction',body:`${formatDate(t.date)} · ${me.name}${t.review_note?`\nNote: ${t.review_note}`:''}`,link:'/time-tracking',relatedId:id,scope:scopeOf(me),dedupeKey:`time-decision:${id}:${t.status}:${new Date().toISOString().slice(0,16)}`});
 }catch{/* ignore */}
}

export async function onAssetAssigned(me:Employee,assetId:string){
 try{
  const a=await first<{name:string;tag:string;assigned_to:string|null;return_due:string|null}>('SELECT name,tag,assigned_to,return_due FROM assets WHERE id=? AND data_scope=?',assetId,scopeOf(me));
  if(!a?.assigned_to||a.assigned_to===me.id)return;
  await notify({recipients:a.assigned_to,kind:'asset_assigned',title:`${a.name} (${a.tag}) was assigned to you`,body:a.return_due?`Please return it by ${formatDate(a.return_due)}.`:'Look after it and tell HR if anything is wrong.',link:'/assets',relatedId:assetId,scope:scopeOf(me),dedupeKey:`asset-assigned:${assetId}:${new Date().toISOString().slice(0,16)}`});
 }catch{/* ignore */}
}

export async function onAnnouncementSaved(me:Employee,id:string){
 try{
  const a=await first<{title:string;body:string;status:string}>('SELECT title,body,status FROM announcements WHERE id=? AND data_scope=?',id,scopeOf(me));
  if(!a||a.status!=='published')return;
  const everyone=(await all<{id:string}>("SELECT id FROM employees WHERE active=1 AND demo=0 AND id<>? AND data_scope=?",me.id,scopeOf(me))).map(row=>row.id);
  // The same key means editing a published post never alerts people twice.
  await notify({recipients:everyone,kind:'announcement',title:a.title,body:a.body.length>240?a.body.slice(0,237)+'…':a.body,link:'/company-news',relatedId:id,scope:scopeOf(me),dedupeKey:`announcement:${id}`});
 }catch{/* ignore */}
}
