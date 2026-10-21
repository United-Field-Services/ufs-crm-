import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,asUser,jsonRequest,fileContext,fileRequest,origin,uploadRequest} from './harness.mjs';
const action=await import('../app/api/action/route.ts');
const state=await import('../app/api/state/route.ts');
const operations=await import('../app/api/operations/route.ts');
const profiles=await import('../app/api/profiles/[id]/route.ts');
const files=await import('../app/api/files/route.ts');
const file=await import('../app/api/files/[id]/route.ts');
const server=await import('../lib/server.ts');
const policy=await import('../lib/policy.ts');
const roles=['admin','hr_manager','manager','hiring_manager','employee'];
const hrRoles=['admin','hr_manager'],managerRoles=['admin','hr_manager','manager'];
let f,actors,subject,unrelated;
beforeEach(()=>{f=fixture();actors=Object.fromEntries(roles.map(role=>[role,f.employee(role,{role,email:role==='admin'?'owner@example.test':`${role}@example.test`})]));subject=f.employee('subject',{manager_id:actors.manager.id});unrelated=f.employee('unrelated')});
afterEach(()=>f.close());
const act=(who,body)=>asUser(who,()=>action.POST(jsonRequest(body)));
const op=(who,body)=>asUser(who,()=>operations.POST(jsonRequest(body)));
const profile=(who,id)=>asUser(who,()=>profiles.GET(fileRequest(id),fileContext(id)));
const update=(who,id,body)=>asUser(who,()=>profiles.POST(jsonRequest(body),fileContext(id)));
const download=(who,id)=>asUser(who,()=>file.GET(fileRequest(id),fileContext(id)));
const access=(person,values={})=>({action:'updateAccess',employeeId:person.id,role:person.role,active:!!person.active,managerId:person.manager_id,...values});
const job=values=>({action:'update_employment',values,effective_date:'2026-01-01',reason:'Synthetic role test'});
const time=(id,employeeId,managerId,status='submitted')=>f.run('INSERT INTO time_entries (id,employee_id,date,minutes,project,notes,status,required_manager_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',id,employeeId,'2026-01-01',60,'Synthetic project','Private time note',status,managerId,'2026-01-01','2026-01-01');
const task=(id,assignee)=>f.run('INSERT INTO tasks (id,title,assignee_id,due_date,created_by,created_at) VALUES (?,?,?,?,?,?)',id,'Synthetic task',assignee,'2026-11-02',actors.admin.id,'2026-01-01');

for(const role of roles){
 test(`${role}: role helpers never infer privileges from reporting assignments`,()=>{const actor=actors[role];assert.equal(policy.isAdmin(actor),role==='admin');assert.equal(policy.isHR(actor),hrRoles.includes(role));assert.equal(policy.isManager(actor),managerRoles.includes(role))});
 test(`${role}: directory, private profile, leave, documents and task read matrix`,async()=>{
  const actor=actors[role],hr=hrRoles.includes(role),manager=managerRoles.includes(role);
  f.run('UPDATE employees SET manager_id=? WHERE id=?',actor.id,subject.id);
  f.run('INSERT INTO employee_profiles (employee_id,birth_date,personal_email,personal_phone,address_line1,updated_at) VALUES (?,?,?,?,?,?)',subject.id,'1990-01-02','private@example.test','+1 555 010 0000','Synthetic private address','2026-01-01');
  f.run('INSERT INTO emergency_contacts (id,employee_id,name,relationship,phone,updated_at) VALUES (?,?,?,?,?,?)','contact',subject.id,'Synthetic private contact','Sibling','+1 555 010 0001','2026-01-01');
  f.run('INSERT INTO employee_identifiers (id,employee_id,type,country,status,last4,updated_at) VALUES (?,?,?,?,?,?,?)','identifier',subject.id,'Social Security (SSN)','United States','Recorded','1234','2026-01-01');
  f.run('INSERT INTO compensation_records (id,employee_id,amount,currency,frequency,effective_date,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)','pay',subject.id,123456,'USD','Annual','2026-01-01','Synthetic',actors.admin.id,'2026-01-01');
  f.document('linked',subject.id);f.document('private',subject.id);f.document('company',subject.id,{visibility:'company'});f.document('own',actor.id);
  f.leave('assigned',subject.id,{required_manager_id:actor.id,attachment_id:'linked'});f.leave('unrelated',unrelated.id);f.leave('own',actor.id);task('own-task',actor.id);task('subject-task',subject.id);
  const data=await (await asUser(actor,()=>state.GET())).json();
  assert.ok(data.requests.some(x=>x.id==='own'));assert.equal(data.requests.some(x=>x.id==='assigned'),manager);assert.equal(data.requests.some(x=>x.id==='unrelated'),hr);
  assert.ok(data.documents.some(x=>x.id==='company'));assert.ok(data.documents.some(x=>x.id==='own'));assert.equal(data.documents.some(x=>x.id==='linked'),manager);assert.equal(data.documents.some(x=>x.id==='private'),hr);
  assert.ok(data.tasks.some(x=>x.id==='own-task'));assert.equal(data.tasks.some(x=>x.id==='subject-task'),hr);
  for(const person of data.people)for(const key of ['birth_date','personal_email','personal_phone','address_line1','last4','amount'])assert.equal(key in person,false);
  const p=data.people.find(x=>x.id===subject.id);assert.equal('email' in p,hr);assert.equal('user_id' in p,hr);assert.equal('role' in p,hr);
  assert.equal(data.eligibleApprovers.length>0,role==='admin');if(role==='admin')assert.deepEqual(data.eligibleApprovers.map(p=>p.role).sort(),['admin','hr_manager','manager']);
  const privateData=await (await profile(actor,subject.id)).json();assert.equal(privateData.access.private,hr);assert.equal(privateData.access.compensation,hr);assert.equal('birth_date' in privateData.profile,hr);assert.equal(privateData.emergencyContacts.length,hr?1:0);assert.equal(privateData.identifiers.length,hr?1:0);assert.equal(privateData.compensation.length,hr?1:0);
  assert.equal((await download(actor,'private')).status,hr?200:404);assert.equal((await download(actor,'linked')).status,manager?200:404);assert.equal((await download(actor,'company')).status,200);
  assert.equal((await (await profile(actor,actor.id)).json()).access.private,true);
 });
 test(`${role}: HR mutations require HR role, never a manager assignment`,async()=>{
  const actor=actors[role],allowed=hrRoles.includes(role);const actionBodies=[
   {action:'createEmployee',name:'Synthetic new',email:`new-${role}@example.test`,title:'Tester',department:'Test',location:'Test',hireDate:'2026-01-01'},
   {action:'updateBudgets',employeeId:subject.id,year:2026,vacation:15,sick:5,wfh:30,bereavement:3},
   {action:'addEvent',title:'Synthetic event',date:'2026-01-01'},
   {action:'createTask',title:'Synthetic task',assigneeId:subject.id,dueDate:'2026-01-01'}
  ];for(const body of actionBodies)assert.equal((await act(actor,body)).status,allowed?200:403,body.action);
  for(const body of [{action:'saveTemplate',name:'Synthetic checklist',steps:[{title:'Start',assignee:'employee',offset:0}]},{action:'saveAsset',name:'Synthetic laptop',tag:`TEST-${role}`,category:'Laptop'},{action:'saveAnnouncement',title:'Synthetic notice',body:'Synthetic text',status:'draft'}])assert.equal((await op(actor,body)).status,allowed?200:403,body.action);
  assert.equal((await asUser(actor,()=>files.POST(uploadRequest('company.txt','Synthetic file',{visibility:'company'})))).status,allowed?200:403);
 });
 test(`${role}: all role and activation changes are Super admin-only`,async()=>{
  const actor=actors[role];for(const assignedRole of ['employee','manager','hr_manager','hiring_manager'])assert.equal((await act(actor,access(subject,{role:assignedRole,active:false}))).status,role==='admin'?200:403);
  if(role!=='admin'){assert.equal((await act(actor,access(actor,{role:'admin'}))).status,403);assert.equal(f.get('SELECT role FROM employees WHERE id=?',actor.id).role,role)}
  else{assert.equal((await act(actor,access(actor,{role:'employee'}))).status,403);assert.equal((await act(actor,access(actor,{active:false}))).status,403);assert.equal((await act(actor,access(subject,{role:'admin'}))).status,400)}
 });
 test(`${role}: other employee private writes and job changes stay HR-only`,async()=>{
  const actor=actors[role],allowed=hrRoles.includes(role);
  for(const body of [{action:'update_personal',values:{birth_date:'1990-01-01'}},job({title:'Synthetic title'}),{action:'save_emergency_contact',contact:{name:'Synthetic contact',relationship:'Sibling',phone:'+1 555 010 0002'}},{action:'save_identifier',identifier:{type:'Social Security (SSN)',country:'United States',status:'Recorded',last4:'1234'}},{action:'add_compensation',record:{amount:100,currency:'USD',frequency:'Annual',effective_date:'2026-01-01',reason:'Synthetic test'}}])assert.equal((await update(actor,subject.id,body)).status,allowed?200:403,body.action);
  assert.equal((await update(actor,subject.id,job({manager_id:actors.hr_manager.id}))).status,role==='admin'?200:403);
  assert.equal((await update(actor,actor.id,{action:'update_personal',values:{bio:'Own synthetic bio'}})).status,200);
  assert.equal((await update(actor,actor.id,job({title:'Own synthetic title'}))).status,allowed?200:403);
 });
 test(`${role}: time state and approvals require eligible assigned reviewer`,async()=>{
  const actor=actors[role],hr=hrRoles.includes(role),eligible=managerRoles.includes(role);
  time('own',actor.id,actors.admin.id,'draft');time('assigned',subject.id,actor.id);time('other',unrelated.id,actors.manager.id);time('subject-draft',subject.id,actor.id,'draft');
  const data=await (await asUser(actor,()=>operations.GET())).json();assert.ok(data.timeEntries.some(t=>t.id==='own'));assert.equal(data.timeEntries.some(t=>t.id==='assigned'),eligible);assert.equal(data.timeEntries.some(t=>t.id==='other'),hr||role==='manager');assert.equal(data.timeEntries.some(t=>t.id==='subject-draft'),hr);
  f.leave('assigned',subject.id,{required_manager_id:actor.id});f.leave('not-assigned',unrelated.id,{required_manager_id:null});
  assert.equal((await act(actor,{action:'reviewLeave',id:'assigned',status:'approved'})).status,eligible?200:403);assert.equal((await op(actor,{action:'reviewTime',id:'assigned',status:'approved'})).status,eligible?200:403);
  assert.equal((await act(actor,{action:'reviewLeave',id:'not-assigned',status:'approved'})).status,403);time('not-assigned',subject.id,null);assert.equal((await op(actor,{action:'reviewTime',id:'not-assigned',status:'approved'})).status,403);
 });
 test(`${role}: own assigned tasks do not grant access to other assignees`,async()=>{const actor=actors[role];task('own',actor.id);task('other',subject.id);assert.equal((await act(actor,{action:'toggleTask',id:'own',status:'completed'})).status,200);assert.equal((await act(actor,{action:'toggleTask',id:'other',status:'completed'})).status,hrRoles.includes(role)?200:403)});
}
for(const role of ['employee','manager','hr_manager','hiring_manager']){
 test(`${role}: pre-registered verified email binds without browser role selection`,async()=>{const p=f.employee(`pending-${role}`,{role,user_id:null});const me=await asUser({email:p.email,userId:`verified-${role}`},()=>server.currentEmployee());assert.equal(me.id,p.id);assert.equal(me.user_id,`verified-${role}`);assert.equal(me.role,role)});
 for(const [label,changes]of [['inactive',{active:0}],['demo',{demo:1}],['already bound',{user_id:'existing-identity'}]])test(`${role}: ${label} pre-registration never binds another identity`,async()=>{const p=f.employee(`pending-${role}`,{role,user_id:null,...changes});await assert.rejects(asUser({email:p.email,userId:`forged-${role}`},()=>server.currentEmployee()),e=>e.status===403);assert.equal(f.get('SELECT user_id FROM employees WHERE id=?',p.id).user_id,p.user_id)});
}
test('unsupported roles fail closed even with a bound identity',async()=>{const unknown=f.employee('unknown',{role:'super_admin'});assert.equal((await asUser(unknown,()=>state.GET())).status,403);assert.equal((await act(unknown,{action:'requestLeave',type:'Vacation',startDate:'2026-11-02',endDate:'2026-11-02'})).status,403)});
test('required approver assignment rejects employee/hiring manager, inactive, self and cycles',async()=>{
 for(const actor of [actors.employee,actors.hiring_manager]){assert.equal((await act(actors.admin,access(subject,{managerId:actor.id}))).status,400);assert.equal((await update(actors.admin,subject.id,job({manager_id:actor.id}))).status,400)}
 f.run('UPDATE employees SET active=0 WHERE id=?',actors.manager.id);assert.equal((await act(actors.admin,access(subject))).status,400);f.run('UPDATE employees SET active=1 WHERE id=?',actors.manager.id);
 assert.equal((await act(actors.admin,access(actors.manager,{managerId:actors.manager.id}))).status,400);f.run('UPDATE employees SET manager_id=? WHERE id=?',actors.manager.id,actors.hr_manager.id);assert.equal((await act(actors.admin,access(actors.manager,{managerId:actors.hr_manager.id}))).status,400);
});
for(const role of ['employee','hiring_manager'])test(`stale ${role} manager assignment cannot receive new time or leave review routes`,async()=>{f.run('UPDATE employees SET manager_id=? WHERE id=?',actors[role].id,subject.id);time('draft',subject.id,null,'draft');assert.equal((await op(subject,{action:'submitTime',id:'draft'})).status,400);assert.equal((await act(subject,{action:'requestLeave',type:'Vacation',startDate:'2026-11-02',endDate:'2026-11-02'})).status,200);assert.equal(f.get('SELECT required_manager_id FROM leave_requests').required_manager_id,null)});

// Pause the actual prepared write after authentication to exercise TOCTOU revocation.
async function raceWrite(match,started,change){
 const prepare=f.env.DB.prepare;let reached,release;const atWrite=new Promise(r=>reached=r),resume=new Promise(r=>release=r);
 f.env.DB.prepare=sql=>{const statement=prepare(sql);if(match.test(sql)){const run=statement.run;statement.run=async()=>{reached();await resume;return run()}}return statement};
 const pending=started();await atWrite;try{await change()}finally{release()}return pending;
}
for(const from of ['manager','hr_manager','admin'])for(const to of ['employee','hiring_manager'])test(`${from} → ${to}: in-flight leave and time reviews fail after role revocation`,async()=>{
 const actor=actors[from];f.leave('pending-leave',subject.id,{required_manager_id:actor.id});time('pending-time',subject.id,actor.id);
 for(const [kind,match,start] of [['leave',/^UPDATE leave_requests SET status = \?, reviewer_id = \?/,()=>act(actor,{action:'reviewLeave',id:'pending-leave',status:'approved'})],['time',/^UPDATE time_entries SET status=\?,review_note=\?/,()=>op(actor,{action:'reviewTime',id:'pending-time',status:'approved'})]]){
  f.run('UPDATE employees SET role=? WHERE id=?',from,actor.id);const result=await raceWrite(match,start,()=>f.run('UPDATE employees SET role=? WHERE id=?',to,actor.id));assert.ok([403,409].includes(result.status));assert.equal(f.get(`SELECT status FROM ${kind==='leave'?'leave_requests':'time_entries'} WHERE id=?`,`pending-${kind}`).status,kind==='leave'?'pending':'submitted');
 }
 assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);
});
test('in-flight time review fails if reviewer becomes inactive',async()=>{time('pending-time',subject.id,actors.manager.id);const result=await raceWrite(/^UPDATE time_entries SET status=\?,review_note=\?/,()=>op(actors.manager,{action:'reviewTime',id:'pending-time',status:'approved'}),()=>f.run('UPDATE employees SET active=0 WHERE id=?',actors.manager.id));assert.equal(result.status,403);assert.equal(f.get('SELECT status FROM time_entries').status,'submitted')});
test('in-flight time submission rejects a reviewer demoted before the write',async()=>{time('draft',subject.id,null,'draft');const result=await raceWrite(/^UPDATE time_entries SET status='submitted'/,()=>op(subject,{action:'submitTime',id:'draft'}),()=>f.run("UPDATE employees SET role='employee' WHERE id=?",actors.manager.id));assert.equal(result.status,403);assert.equal(f.get('SELECT status FROM time_entries').status,'draft')});
for(const role of roles)test(`${role}: HR-confidential files stay HR-only even for owner or assigned approver`,async()=>{
 const actor=actors[role],hr=hrRoles.includes(role);
 f.document('own-hr',actor.id,{visibility:'hr',folder:'Admin Folder'});f.document('subject-hr',subject.id,{visibility:'hr',folder:'Admin Folder'});f.leave('forged-link',subject.id,{required_manager_id:actor.id,attachment_id:'subject-hr'});f.leave('own-forged-link',actor.id,{attachment_id:'own-hr'});
 const listed=await (await asUser(actor,()=>state.GET())).json();assert.equal(listed.documents.some(d=>d.id==='own-hr'),hr);assert.equal(listed.documents.some(d=>d.id==='subject-hr'),hr);
 for(const request of listed.requests.filter(l=>['own-forged-link','forged-link'].includes(l.id))){assert.equal(request.attachment_name!==null,hr);assert.equal(request.attachment_id!==null,hr)}
 for(const id of ['own-hr','subject-hr']){
  assert.equal((await download(actor,id)).status,hr?200:404);
  const patch=new Request(`${origin}/api/files/${id}`,{method:'PATCH',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'renamed.txt',folder:'Another folder'})});
  assert.equal((await asUser(actor,()=>file.PATCH(patch,fileContext(id)))).status,hr?200:404);
  assert.equal((await op(actor,{action:'acknowledgeDocument',id})).status,404);
  assert.equal((await asUser(actor,()=>file.DELETE(fileRequest(id,'DELETE'),fileContext(id)))).status,hr?200:404);
 }
 if(!hr)assert.deepEqual(f.bucketReads,[]);
});
for(const role of roles)test(`${role}: HR-confidential uploads require HR and stay subject-hidden`,async()=>{
 const actor=actors[role],hr=hrRoles.includes(role),result=await asUser(actor,()=>files.POST(uploadRequest('confidential.txt','Synthetic HR file',{employeeId:subject.id,visibility:'hr',folder:'Admin Folder'})));
 assert.equal(result.status,hr?200:403);if(hr){const {id}=await result.json();assert.equal(f.get('SELECT visibility FROM documents WHERE id=?',id).visibility,'hr');assert.equal((await download(subject,id)).status,404);assert.equal((await download(actors.manager,id)).status,404);assert.equal((await download(actors.hr_manager,id)).status,200)}else assert.equal(f.storage.size,0);
});
test('folder labels never widen permissions and unknown visibility does not silently become personal',async()=>{
 f.document('ordinary',subject.id,{visibility:'personal',folder:'Admin Folder'});assert.equal((await download(subject,'ordinary')).status,200);assert.equal((await download(unrelated,'ordinary')).status,404);
 assert.equal((await asUser(actors.hr_manager,()=>files.POST(uploadRequest('unknown.txt','Synthetic file',{visibility:'unknown'})))).status,400);assert.equal(f.get('SELECT COUNT(*) n FROM documents').n,1);
});
test('HR-confidential file cannot be attached to leave even by its subject or HR owner',async()=>{
 for(const actor of [subject,actors.hr_manager]){f.document(`hr-${actor.id}`,actor.id,{visibility:'hr'});assert.equal((await act(actor,{action:'requestLeave',type:'Vacation',startDate:'2026-11-02',endDate:'2026-11-02',attachmentId:`hr-${actor.id}`})).status,403)}assert.equal(f.get('SELECT COUNT(*) n FROM leave_requests').n,0);
});
