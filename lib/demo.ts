import {env} from 'cloudflare:workers';
import {db,now,businessDate} from './server';
import {scopeOf,type Employee} from './policy';
export async function ensureDemo(me:Employee){
 // Sample people, requests and tasks are only created when a developer asks for them (local setup). Never in production.
 if(env.UFS_DEMO_DATA!=='enabled')return;
 if(me.role!=='admin'||scopeOf(me)!=='live')return;
 const month=businessDate().slice(0,7),y=Number(month.slice(0,4));
 const people=[['demo-alex','Alex Morgan','Operations Coordinator','Administration & Operations','United States'],['demo-jamie','Jamie Chen','HR Specialist','Human Resources','Asia'],['demo-taylor','Taylor Brooks','Field Coordinator','Vendor Management','United States'],['demo-sam','Sam Rivera','Accountant','Accounting & Finance','Europe'],['demo-jordan','Jordan Lee','Order Specialist','Order processing','Asia'],['demo-casey','Casey Wilson','Account Manager','Marketing & Sales','Europe']];
 const cmds=people.map(([id,name,title,department,location])=>db().prepare('INSERT OR IGNORE INTO employees (id,email,name,title,department,location,employment,hire_date,role,demo,created_at,manager_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,`${id}@example.invalid`,name,title,department,location,'Full-Time',`${y-1}-03-04`,'employee',1,now(),me.id));
 cmds.push(db().prepare('INSERT OR IGNORE INTO leave_requests (id,employee_id,type,start_date,end_date,days,year,note,status,created_at,required_manager_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind('demo-request-1','demo-alex','Vacation',`${month}-19`,`${month}-20`,2,y,'Demo request. No real employee information.','pending',now(),me.id));
 cmds.push(db().prepare('INSERT OR IGNORE INTO leave_requests (id,employee_id,type,start_date,end_date,days,year,note,status,created_at,required_manager_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind('demo-request-2','demo-jamie','WFH',`${month}-22`,`${month}-22`,1,y,'Demo request.','pending',now(),me.id));
 cmds.push(db().prepare('INSERT OR IGNORE INTO leave_requests (id,employee_id,type,start_date,end_date,days,year,note,status,created_at,required_manager_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind('demo-request-3','demo-taylor','Vacation',`${month}-14`,`${month}-16`,3,y,'Sample approved absence.','approved',now(),me.id));
 for(const [id,title,date,kind]of [['demo-event-1','Team check-in',`${month}-15`,'Company event'],['demo-event-2','Monthly all-hands',`${month}-28`,'Company event']])cmds.push(db().prepare('INSERT OR IGNORE INTO events (id,title,date,kind,created_by,demo) VALUES (?,?,?,?,?,1)').bind(id,title,date,kind,me.id));
 for(const [id,title,due]of [['demo-task-1','Review sample onboarding checklist',`${month}-16`],['demo-task-2','Check document access before launch',`${month}-20`],['demo-task-3','Confirm leave policy and calendar',`${month}-23`]])cmds.push(db().prepare('INSERT OR IGNORE INTO tasks (id,title,assignee_id,due_date,status,created_by,created_at,demo) VALUES (?,?,?,?,?,?,?,1)').bind(id,title,me.id,due,'pending',me.id,now()));
 cmds.push(db().prepare("UPDATE employees SET manager_id = ? WHERE demo = 1 AND manager_id IS NULL AND NOT EXISTS (SELECT 1 FROM audit WHERE id = 'demo-routing-v2')").bind(me.id));
 cmds.push(db().prepare("UPDATE leave_requests SET required_manager_id = ? WHERE id LIKE 'demo-request-%' AND required_manager_id IS NULL AND NOT EXISTS (SELECT 1 FROM audit WHERE id = 'demo-routing-v2')").bind(me.id));
 cmds.push(db().prepare("INSERT OR IGNORE INTO audit (id,actor_id,action,target_id,created_at) VALUES ('demo-routing-v2',?,'Configured demo approval routes','demo',?)").bind(me.id,now()));
 await db().batch(cmds);
}
