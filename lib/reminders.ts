import {all,businessDate} from './server';
import {formatDate} from './format';
import {notify,queueDigests} from './notifications';

// Scheduled reminders. Runs every few minutes from the Worker's cron; every reminder has a dedupe key built from
// what it is about and the day (or threshold), so running again never repeats one.
// Reminders only go out during working hours in the business time zone (America/Los_Angeles).

const hourInBusinessZone=(date=new Date())=>Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',hour12:false}).format(date))%24;
const weekdayInBusinessZone=(date=new Date())=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',weekday:'short'}).format(date);
const dayNumber=(date:string)=>Math.floor(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7))-1,Number(date.slice(8,10)))/86400000);
export const daysUntil=(date:string,today:string)=>dayNumber(date)-dayNumber(today);
const plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`;
const hrIds=async()=>(await all<{id:string}>("SELECT id FROM employees WHERE role IN ('admin','hr_manager') AND active=1 AND demo=0 AND data_scope='live'")).map(row=>row.id);

export type ReminderSummary={created:number;skipped?:string};

export async function runReminders(options:{today?:string;hour?:number;weekday?:string}={}):Promise<ReminderSummary>{
 const today=options.today||businessDate(),hour=options.hour??hourInBusinessZone(),weekday=options.weekday||weekdayInBusinessZone();
 // The daily digest goes out at 8 am; other reminders wait for working hours.
 if(hour===8)await queueDigests();
 if(hour<7||hour>=19)return {created:0,skipped:'outside working hours'};
 let created=0;
 const add=async(count:number)=>{created+=count};

 // 1. Requests waiting for an approver: a daily nudge after one day, and HR is told after three.
 const waiting=await all<{id:string;required_manager_id:string;name:string;created_at:string;type:string}>("SELECT l.id,l.required_manager_id,e.name,l.created_at,l.type FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE l.status='pending' AND l.required_manager_id IS NOT NULL AND l.data_scope='live' AND l.end_date>=?",today);
 const waitingTime=await all<{id:string;required_manager_id:string;name:string;updated_at:string}>("SELECT t.id,t.required_manager_id,e.name,t.updated_at FROM time_entries t JOIN employees e ON e.id=t.employee_id WHERE t.status='submitted' AND t.required_manager_id IS NOT NULL AND t.data_scope='live'");
 const ageDays=(stamp:string)=>daysUntil(today,stamp.slice(0,10));
 const perManager=new Map<string,{leave:number;time:number}>();
 for(const item of waiting)if(ageDays(item.created_at)>=1){const entry=perManager.get(item.required_manager_id)||{leave:0,time:0};entry.leave++;perManager.set(item.required_manager_id,entry)}
 for(const item of waitingTime)if(ageDays(item.updated_at)>=1){const entry=perManager.get(item.required_manager_id)||{leave:0,time:0};entry.time++;perManager.set(item.required_manager_id,entry)}
 for(const [manager,counts] of perManager){
  const parts=[counts.leave?plural(counts.leave,'time-off request'):'',counts.time?plural(counts.time,'timesheet entry').replace('entrys','entries'):''].filter(Boolean);
  await add(await notify({recipients:manager,kind:'approval_reminder',title:`${parts.join(' and ')} waiting for your decision`,body:'Please review them so people are not left waiting.',link:counts.leave?'/time-off':'/time-tracking',dedupeKey:`approvals:${today}`}));
 }
 const hr=await hrIds();
 for(const item of waiting)if(ageDays(item.created_at)>=3&&hr.length)await add(await notify({recipients:hr,kind:'approval_escalation',title:`${item.name}’s ${item.type} request has waited ${plural(ageDays(item.created_at),'day')}`,body:'The assigned approver has not responded. Remind them or reassign the approver on the People page.',link:'/time-off',relatedId:item.id,dedupeKey:`escalate:${item.id}`}));

 // 2. Tasks due soon or overdue: one summary per person per day.
 const tasks=await all<{assignee_id:string;due_date:string}>("SELECT assignee_id,due_date FROM tasks WHERE status='pending' AND data_scope='live' AND due_date<=?",new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10));
 const perPerson=new Map<string,{overdue:number;today:number;tomorrow:number}>();
 for(const task of tasks){const entry=perPerson.get(task.assignee_id)||{overdue:0,today:0,tomorrow:0},gap=daysUntil(task.due_date,today);if(gap<0)entry.overdue++;else if(gap===0)entry.today++;else entry.tomorrow++;perPerson.set(task.assignee_id,entry)}
 for(const [person,entry] of perPerson){
  const parts=[entry.overdue?`${entry.overdue} overdue`:'',entry.today?`${entry.today} due today`:'',entry.tomorrow?`${entry.tomorrow} due tomorrow`:''].filter(Boolean);
  await add(await notify({recipients:person,kind:'task_due',title:`Tasks need attention: ${parts.join(', ')}`,body:'Open your task list to see them.',link:'/tasks',dedupeKey:`tasks:${today}`}));
 }

 // 3. Equipment to return: 3 days before, on the day, the day after, then weekly.
 const assets=await all<{id:string;name:string;tag:string;assigned_to:string;return_due:string}>("SELECT id,name,tag,assigned_to,return_due FROM assets WHERE status='assigned' AND return_due IS NOT NULL AND assigned_to IS NOT NULL AND data_scope='live'");
 for(const asset of assets){
  const gap=daysUntil(asset.return_due,today);
  if(!(gap===3||gap===0||gap===-1||(gap<-1&&(-gap-1)%7===0)))continue;
  const when=gap>0?`is due back in ${plural(gap,'day')}`:gap===0?'is due back today':`is ${plural(-gap,'day')} overdue`;
  await add(await notify({recipients:asset.assigned_to,kind:'asset_due',title:`${asset.name} (${asset.tag}) ${when}`,body:`Return date: ${formatDate(asset.return_due)}.`,link:'/assets',relatedId:asset.id,dedupeKey:`asset:${asset.id}:${gap}`}));
  if(gap<=0&&hr.length)await add(await notify({recipients:hr,kind:'asset_due',title:`${asset.name} (${asset.tag}) ${when}`,body:`Return date: ${formatDate(asset.return_due)}.`,link:'/assets',relatedId:asset.id,dedupeKey:`asset-hr:${asset.id}:${gap}`}));
 }

 // 4. Files with an expiry date: 30, 7 and 1 day before and on the day. The owner and HR are told.
 const documents=await all<{id:string;name:string;owner_id:string;expiry_date:string}>("SELECT id,name,owner_id,expiry_date FROM documents WHERE archived=0 AND expiry_date IS NOT NULL AND data_scope='live'");
 for(const doc of documents){
  const gap=daysUntil(doc.expiry_date,today);
  if(![30,7,1,0].includes(gap))continue;
  const title=gap===0?`${doc.name} expires today`:`${doc.name} expires in ${plural(gap,'day')}`;
  await add(await notify({recipients:[doc.owner_id,...hr],kind:'document_expiring',title,body:`Expiry date: ${formatDate(doc.expiry_date)}.`,link:'/files',relatedId:doc.id,dedupeKey:`doc:${doc.id}:${gap}`}));
 }

 // 5. Probation and contract end dates: two weeks and three days before, and on the day. HR and the manager are told.
 const ends=await all<{id:string;name:string;manager_id:string|null;date:string;kind:string}>("SELECT e.id,e.name,e.manager_id,p.probation_end AS date,'Probation' AS kind FROM employee_profiles p JOIN employees e ON e.id=p.employee_id WHERE p.probation_end<>'' AND e.active=1 AND p.data_scope='live' UNION ALL SELECT e.id,e.name,e.manager_id,p.contract_end,'Contract' FROM employee_profiles p JOIN employees e ON e.id=p.employee_id WHERE p.contract_end<>'' AND e.active=1 AND p.data_scope='live'");
 for(const end of ends){
  const gap=daysUntil(end.date,today);
  if(![14,3,0].includes(gap))continue;
  await add(await notify({recipients:[...hr,...(end.manager_id?[end.manager_id]:[])],kind:'contract_ending',title:`${end.name}’s ${end.kind.toLowerCase()} ${gap===0?'ends today':`ends in ${plural(gap,'day')}`}`,body:`${end.kind} end date: ${formatDate(end.date)}.`,link:'/people',relatedId:end.id,dedupeKey:`end:${end.id}:${end.kind}:${gap}`}));
 }

 // 6. Work anniversaries (month and day match, at least one year). The person and their manager are told.
 const month=today.slice(5),year=Number(today.slice(0,4));
 const hires=await all<{id:string;name:string;manager_id:string|null;hire_date:string}>("SELECT id,name,manager_id,hire_date FROM employees WHERE active=1 AND demo=0 AND data_scope='live' AND substr(hire_date,6)=?",month);
 for(const person of hires){
  const years=year-Number(person.hire_date.slice(0,4));
  if(years<1)continue;
  await add(await notify({recipients:person.id,kind:'work_anniversary',title:`Happy ${plural(years,'year')} at United Field Services!`,body:'Thank you for being part of the team.',link:'/',relatedId:person.id,dedupeKey:`anniversary:${person.id}:${year}`}));
  if(person.manager_id)await add(await notify({recipients:person.manager_id,kind:'work_anniversary',title:`${person.name} marks ${plural(years,'year')} today`,body:'Take a moment to say thank you.',link:'/people',relatedId:person.id,dedupeKey:`anniversary-manager:${person.id}:${year}`}));
 }

 // 7. Approved time off that starts tomorrow.
 const tomorrow=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 const starting=await all<{id:string;employee_id:string;type:string;start_date:string;end_date:string}>("SELECT id,employee_id,type,start_date,end_date FROM leave_requests WHERE status='approved' AND start_date=? AND data_scope='live'",tomorrow);
 for(const item of starting)await add(await notify({recipients:item.employee_id,kind:'leave_upcoming',title:`Your ${item.type} starts tomorrow`,body:`${formatDate(item.start_date)}${item.end_date!==item.start_date?` to ${formatDate(item.end_date)}`:''}. Enjoy the time off.`,link:'/time-off',relatedId:item.id,dedupeKey:`leave-upcoming:${item.id}`}));

 // 8. Friday timesheet reminder. Opt-in: only people who switched it on, and only if they logged nothing this week.
 if(weekday==='Fri'){
  const opted=await all<{employee_id:string}>("SELECT p.employee_id FROM notification_preferences p JOIN employees e ON e.id=p.employee_id AND e.active=1 AND e.demo=0 WHERE p.kind='timesheet_reminder' AND (p.in_app=1 OR p.email<>'off')");
  const monday=new Date(Date.parse(today+'T12:00:00Z')-4*86400000).toISOString().slice(0,10);
  for(const person of opted){
   const logged=await all<{n:number}>('SELECT COUNT(*) n FROM time_entries WHERE employee_id=? AND date>=? AND date<=?',person.employee_id,monday,today);
   if(!logged[0]?.n)await add(await notify({recipients:person.employee_id,kind:'timesheet_reminder',title:'You have not logged any time this week',body:'Add your hours before the weekend.',link:'/time-tracking',dedupeKey:`timesheet:${monday}`}));
  }
 }
 return {created};
}
