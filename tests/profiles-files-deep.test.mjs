import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,asUser,jsonRequest,uploadRequest,fileContext,fileRequest,origin} from './harness.mjs';
const profiles=await import('../app/api/profiles/[id]/route.ts');
const files=await import('../app/api/files/route.ts');
const file=await import('../app/api/files/[id]/route.ts');
const state=await import('../app/api/state/route.ts');
const roles=['employee','manager','hiring_manager','hr_manager','admin'];
function setup(t){const f=fixture();t.after(()=>f.close());const actors=Object.fromEntries(roles.map(role=>[role,f.employee(role,{role})]));const alice=f.employee('alice'),bob=f.employee('bob');return {...f,actors,alice,bob}}
const getProfile=(actor,id)=>asUser(actor,()=>profiles.GET(fileRequest('profile'),fileContext(id)));
const postProfile=(actor,id,body)=>asUser(actor,()=>profiles.POST(jsonRequest(body),fileContext(id)));
const upload=(actor,fields={})=>asUser(actor,()=>files.POST(uploadRequest('synthetic.txt','Synthetic file content',fields)));
const download=(actor,id)=>asUser(actor,()=>file.GET(fileRequest('file'),fileContext(id)));
const archive=(actor,id)=>asUser(actor,()=>file.DELETE(fileRequest('file','DELETE'),fileContext(id)));
const patch=(actor,id,body={})=>asUser(actor,()=>file.PATCH(new Request(`${origin}/api/files/file`,{method:'PATCH',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'renamed.txt',folder:'Synthetic folder',...body})}),fileContext(id)));
async function data(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json()}
const personal={action:'update_personal',values:{bio:'Synthetic change'}};
const job=values=>({action:'update_employment',values,effective_date:'2026-01-01',reason:'Synthetic change'});
const contact={name:'Synthetic person',relationship:'Sibling',phone:'+1 555 010 1234',is_primary:true};
const identifier={type:'Passport',country:'United States',status:'Recorded',last4:'AB12'};
const education={institution:'Synthetic College',status:'Completed'};
const benefit={type:'Health',plan:'Synthetic plan',status:'Enrolled',effective_date:'2026-01-01'};
const compensation={amount:100,currency:'USD',frequency:'Annual',effective_date:'2026-01-01',reason:'Synthetic change'};
function imported(f,employee,status='Active'){f.run('INSERT INTO source_employee_links (source_id,employee_id,source_email,source_status,imported_at) VALUES (?,?,?,?,?)',`source-${employee.id}`,employee.id,employee.email,status,'2026-01-01')}
function profile(f,employee,status='Active'){f.run('INSERT INTO employee_profiles (employee_id,employment_status,bio,updated_at) VALUES (?,?,?,?)',employee.id,status,'Synthetic private biography','2026-01-01')}
// Apply a competing change immediately before the real guarded statement executes.
function beforeWrite(f,pattern,change){const prepare=f.env.DB.prepare;let fired=false;f.env.DB.prepare=sql=>{const statement=prepare(sql);if(pattern.test(sql)){const run=statement.run;statement.run=async()=>{if(!fired){fired=true;change()}return run()}}return statement};return ()=>assert.ok(fired,'The intended write boundary was exercised')}
function snapshot(f){return JSON.stringify(Object.fromEntries(['employees','employee_profiles','emergency_contacts','employee_identifiers','education_records','benefit_enrollments','compensation_records','employment_history','leave_requests','audit'].map(table=>[table,f.rows(`SELECT * FROM ${table} ORDER BY 1`)])))}

for(const role of roles)for(const status of ['Inactive','Terminated'])test(`${role}: direct imported ${status} profile follows directory roster visibility`,async t=>{
 const f=setup(t),actor=f.actors[role];f.run('UPDATE employees SET active=0 WHERE id=?',f.alice.id);imported(f,f.alice);profile(f,f.alice,status);
 const hr=['hr_manager','admin'].includes(role),response=await getProfile(actor,f.alice.id);await data(response,hr?200:404);
 const directory=await data(await asUser(actor,()=>state.GET()));assert.equal(directory.people.some(person=>person.id===f.alice.id),hr);
});
for(const role of ['employee','manager','hiring_manager'])for(const sourceStatus of ['Terminated','INACTIVE','Archived'])test(`${role}: active login does not expose former source profile ${sourceStatus}`,async t=>{
 const f=setup(t);imported(f,f.alice,sourceStatus);profile(f,f.alice);await data(await getProfile(f.actors[role],f.alice.id),404);
});
test('unactivated current source staff retain public profiles while their private fields remain hidden',async t=>{
 const f=setup(t);f.run('UPDATE employees SET active=0 WHERE id=?',f.alice.id);imported(f,f.alice);profile(f,f.alice);
 const result=await data(await getProfile(f.actors.employee,f.alice.id));assert.equal(result.profile.imported,true);assert.equal(result.access.private,false);assert.ok(!JSON.stringify(result).includes('Synthetic private biography'));
});
test('local employment-status suppression also matches directory visibility',async t=>{
 const f=setup(t);profile(f,f.alice,'Terminated');await data(await getProfile(f.actors.employee,f.alice.id),404);await data(await getProfile(f.actors.hr_manager,f.alice.id));
});
test('former employees cannot retain self-service even if the account active flag is stale',async t=>{
 const f=setup(t);imported(f,f.alice,'Terminated');profile(f,f.alice,'Inactive');await data(await getProfile(f.alice,f.alice.id),403);await data(await postProfile(f.alice,f.alice.id,personal),403);assert.equal(f.get('SELECT bio FROM employee_profiles WHERE employee_id=?',f.alice.id).bio,'Synthetic private biography');
});
test('HR can save imported blank title department and location without inventing source data',async t=>{
 const f=setup(t);f.run("UPDATE employees SET title='',department='',location='',active=0 WHERE id=?",f.alice.id);imported(f,f.alice);profile(f,f.alice);
 await data(await postProfile(f.actors.hr_manager,f.alice.id,job({name:f.alice.name,title:'',department:'',location:'',employment:f.alice.employment,hire_date:f.alice.hire_date,division:'Synthetic division'})));
 assert.equal(f.get('SELECT title FROM employees WHERE id=?',f.alice.id).title,'');assert.equal(f.get('SELECT division FROM employee_profiles WHERE employee_id=?',f.alice.id).division,'Synthetic division');
});

const profileActions=[
 ['personal',personal,/^INSERT INTO employee_profiles/],
 ['job core',job({title:'Changed title'}),/^UPDATE employees SET/],
 ['job private',job({division:'Changed division'}),/^INSERT INTO employee_profiles/],
 ['salary',{action:'add_compensation',record:compensation},/^INSERT INTO compensation_records/],
 ['bonus',{action:'add_bonus',record:{amount:100,currency:'USD',effective_date:'2026-01-01',reason:'Synthetic bonus'}},/^INSERT INTO compensation_records/],
 ['contact',{action:'save_emergency_contact',contact},/^INSERT INTO emergency_contacts/],
 ['identifier',{action:'save_identifier',identifier},/^INSERT INTO employee_identifiers/],
 ['education',{action:'save_education',education},/^INSERT INTO education_records/],
 ['benefit',{action:'save_benefit',benefit},/^INSERT INTO benefit_enrollments/],
];
for(const [label,body,pattern]of profileActions)for(const revoke of ['role','active','identity'])test(`profile ${label} cannot commit after HR ${revoke} revocation`,async t=>{
 const f=setup(t),hr=f.actors.hr_manager;profile(f,f.alice);const verify=beforeWrite(f,pattern,()=>f.run(revoke==='role'?"UPDATE employees SET role='employee' WHERE id=?":revoke==='active'?'UPDATE employees SET active=0 WHERE id=?':'UPDATE employees SET user_id=NULL WHERE id=?',hr.id));
 await data(await postProfile(hr,f.alice.id,body),403);verify();assert.equal(f.get('SELECT title FROM employees WHERE id=?',f.alice.id).title,'Tester');assert.equal(f.get('SELECT bio FROM employee_profiles WHERE employee_id=?',f.alice.id).bio,'Synthetic private biography');assert.equal(f.get('SELECT division FROM employee_profiles WHERE employee_id=?',f.alice.id).division,'');for(const table of ['emergency_contacts','employee_identifiers','education_records','benefit_enrollments','compensation_records','employment_history','audit'])assert.equal(f.get(`SELECT COUNT(*) n FROM ${table}`).n,0,table);
});
for(const [label,body,pattern]of profileActions.filter(([label])=>['personal','contact','identifier','education'].includes(label)))test(`self-service ${label} cannot commit after deactivation`,async t=>{
 const f=setup(t);const verify=beforeWrite(f,pattern,()=>f.run('UPDATE employees SET active=0 WHERE id=?',f.alice.id));await data(await postProfile(f.alice,f.alice.id,body),403);verify();for(const table of ['employee_profiles','emergency_contacts','employee_identifiers','education_records','audit'])assert.equal(f.get(`SELECT COUNT(*) n FROM ${table}`).n,0,table);
});
for(const [kind,key,record,table]of [['emergency_contact','contact',contact,'emergency_contacts'],['identifier','identifier',identifier,'employee_identifiers'],['education','education',education,'education_records'],['benefit','benefit',benefit,'benefit_enrollments']])for(const operation of ['update','delete'])test(`${kind} ${operation} rechecks current HR authorization`,async t=>{
 const f=setup(t),hr=f.actors.hr_manager;await data(await postProfile(hr,f.alice.id,{action:`save_${kind}`,[key]:record}));const saved=f.get(`SELECT * FROM ${table}`);f.run('DELETE FROM audit');
 const body=operation==='update'?{action:`save_${kind}`,[key]:{...record,id:saved.id}}:{action:`delete_${kind}`,[kind==='emergency_contact'?'contact_id':`${kind}_id`]:saved.id};
 const verify=beforeWrite(f,new RegExp(`^${operation==='update'?'UPDATE':'DELETE FROM'} ${table}`),()=>f.run("UPDATE employees SET role='manager' WHERE id=?",hr.id));
 await data(await postProfile(hr,f.alice.id,body),403);verify();assert.deepEqual(f.get(`SELECT * FROM ${table}`),saved);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);
});
test('admin demotion cannot change a profile manager or transfer pending approvals',async t=>{
 const f=setup(t),admin=f.actors.admin,manager=f.actors.manager;f.leave('pending',f.alice.id);const verify=beforeWrite(f,/^UPDATE employees SET/,()=>f.run("UPDATE employees SET role='hr_manager' WHERE id=?",admin.id));
 await data(await postProfile(admin,f.alice.id,job({manager_id:manager.id,title:'Changed title'})),403);verify();assert.equal(f.get('SELECT manager_id FROM employees WHERE id=?',f.alice.id).manager_id,null);assert.equal(f.get('SELECT required_manager_id FROM leave_requests').required_manager_id,null);assert.equal(f.get('SELECT COUNT(*) n FROM employment_history').n,0);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);
});
test('HR demotion preserves authorized self personal updates while downgrading response access',async t=>{
 const f=setup(t),hr=f.actors.hr_manager;const verify=beforeWrite(f,/^INSERT INTO employee_profiles/,()=>f.run("UPDATE employees SET role='employee' WHERE id=?",hr.id));const result=await data(await postProfile(hr,hr.id,personal));verify();assert.equal(result.profile.bio,'Synthetic change');assert.equal(result.access.hr,false);
});
test('simultaneous primary emergency contacts leave exactly one primary and two truthful audit records',async t=>{
 const f=setup(t);const results=await Promise.all([postProfile(f.alice,f.alice.id,{action:'save_emergency_contact',contact}),postProfile(f.alice,f.alice.id,{action:'save_emergency_contact',contact:{...contact,name:'Another synthetic person'}})]);for(const result of results)await data(result);assert.equal(f.get('SELECT COUNT(*) n FROM emergency_contacts').n,2);assert.equal(f.get('SELECT COUNT(*) n FROM emergency_contacts WHERE is_primary=1').n,1);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,2);
});
test('concurrent collection deletions succeed once without a duplicate audit',async t=>{
 const f=setup(t);await data(await postProfile(f.alice,f.alice.id,{action:'save_identifier',identifier}));const {id}=f.get('SELECT id FROM employee_identifiers');f.run('DELETE FROM audit');const results=await Promise.all([postProfile(f.alice,f.alice.id,{action:'delete_identifier',identifier_id:id}),postProfile(f.alice,f.alice.id,{action:'delete_identifier',identifier_id:id})]);assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,1);
});

for(const action of ['patch','archive'])for(const revoke of ['role','active','identity','visibility','archived','owner'])test(`file ${action} rejects stale ${revoke} authorization`,async t=>{
 const f=setup(t),actor=['role','active','identity'].includes(revoke)?f.actors.hr_manager:f.alice;const doc=f.document('file',f.alice.id);const verify=beforeWrite(f,action==='patch'?/^UPDATE documents SET name=/:/^UPDATE documents SET archived = 1/,()=>{
  if(revoke==='role')f.run("UPDATE employees SET role='employee' WHERE id=?",actor.id);
  else if(revoke==='active')f.run('UPDATE employees SET active=0 WHERE id=?',actor.id);
  else if(revoke==='identity')f.run('UPDATE employees SET user_id=NULL WHERE id=?',actor.id);
  else if(revoke==='visibility')f.run("UPDATE documents SET visibility='hr' WHERE id=?",doc.id);
  else if(revoke==='archived')f.run('UPDATE documents SET archived=1 WHERE id=?',doc.id);
  else f.run('UPDATE documents SET owner_id=? WHERE id=?',f.bob.id,doc.id);
 });
 await data(await(action==='patch'?patch(actor,doc.id):archive(actor,doc.id)),404);verify();assert.equal(f.get('SELECT name FROM documents').name,'file.txt');assert.equal(f.get('SELECT archived FROM documents').archived,revoke==='archived'?1:0);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);assert.ok(f.storage.has(doc.object_key));
});
test('concurrent file archives succeed once and write one audit record',async t=>{
 const f=setup(t);f.document('file',f.alice.id);const results=await Promise.all([archive(f.alice,'file'),archive(f.alice,'file')]);assert.deepEqual(results.map(result=>result.status).sort(),[200,404]);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,1);
});
test('HR metadata rename with no pin field preserves a concurrently changed company pin',async t=>{
 const f=setup(t);f.document('file',f.alice.id,{visibility:'company',pinned:0});const verify=beforeWrite(f,/^UPDATE documents SET name=/,()=>f.run("UPDATE documents SET pinned=1 WHERE id='file'"));await data(await patch(f.actors.hr_manager,'file'));verify();assert.equal(f.get('SELECT pinned FROM documents').pinned,1);
});
test('HR cannot pin a resource that became private before the metadata write',async t=>{
 const f=setup(t);f.document('file',f.alice.id,{visibility:'company'});const verify=beforeWrite(f,/^UPDATE documents SET name=/,()=>f.run("UPDATE documents SET visibility='personal' WHERE id='file'"));await data(await patch(f.actors.hr_manager,'file',{pinned:true}),404);verify();assert.equal(f.get('SELECT pinned FROM documents').pinned,0);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);
});
for(const revoke of ['role','active','identity','target'])test(`upload rejects ${revoke} revocation and cleans uncommitted storage`,async t=>{
 const f=setup(t),hr=f.actors.hr_manager;const verify=beforeWrite(f,/^INSERT INTO documents/,()=>f.run(revoke==='role'?"UPDATE employees SET role='employee' WHERE id=?":revoke==='identity'?'UPDATE employees SET user_id=NULL WHERE id=?':'UPDATE employees SET active=0 WHERE id=?',revoke==='target'?f.alice.id:hr.id));await data(await upload(hr,{employeeId:f.alice.id,visibility:'company'}),revoke==='target'?404:403);verify();assert.equal(f.get('SELECT COUNT(*) n FROM documents').n,0);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);assert.equal(f.storage.size,0);
});
test('personal self upload remains allowed after an HR-to-employee role change',async t=>{
 const f=setup(t),hr=f.actors.hr_manager;const verify=beforeWrite(f,/^INSERT INTO documents/,()=>f.run("UPDATE employees SET role='employee' WHERE id=?",hr.id));const result=await data(await upload(hr));verify();assert.equal(f.get('SELECT owner_id FROM documents WHERE id=?',result.id).owner_id,hr.id);
});
for(const revoke of ['role','active','identity','archived','visibility','reviewer'])test(`download checks ${revoke} revocation after asynchronous storage fetch`,async t=>{
 const f=setup(t),actor=revoke==='role'?f.actors.hr_manager:revoke==='reviewer'?f.actors.manager:f.alice;f.document('file',revoke==='role'||revoke==='reviewer'?f.bob.id:f.alice.id);if(revoke==='reviewer')f.leave('leave',f.bob.id,{attachment_id:'file',required_manager_id:actor.id});
 const original=f.env.BUCKET.get;f.env.BUCKET.get=async key=>{const result=await original(key);if(revoke==='role')f.run("UPDATE employees SET role='employee' WHERE id=?",actor.id);else if(revoke==='active')f.run('UPDATE employees SET active=0 WHERE id=?',actor.id);else if(revoke==='identity')f.run('UPDATE employees SET user_id=NULL WHERE id=?',actor.id);else if(revoke==='archived')f.run("UPDATE documents SET archived=1 WHERE id='file'");else if(revoke==='visibility')f.run("UPDATE documents SET visibility='hr' WHERE id='file'");else f.run("UPDATE leave_requests SET required_manager_id=NULL WHERE id='leave'");return result};await data(await download(actor,'file'),404);assert.equal(f.bucketReads.length,1);
});
for(const id of [null,undefined,{},[],42,'',' '.repeat(5),'a'.repeat(101),"file' OR 1=1 --",'../../private','\u0000','\ud800'])test(`adversarial profile/file IDs return controlled errors: ${JSON.stringify(id)}`,async t=>{
 const f=setup(t);f.document('file',f.alice.id);const before=snapshot(f);for(const response of [await getProfile(f.alice,id),await postProfile(f.alice,id,personal),await download(f.alice,id),await patch(f.alice,id),await archive(f.alice,id)])assert.ok([400,404].includes(response.status),`Unexpected ${response.status}: ${await response.text()}`);assert.equal(snapshot(f),before);assert.equal(f.bucketReads.length,0);
});
test('ill-formed Unicode rename cannot create a subsequent download 500',async t=>{
 const f=setup(t);f.document('file',f.alice.id);await data(await patch(f.alice,'file',{name:'bad\ud800.txt'}),400);assert.equal((await download(f.alice,'file')).status,200);assert.equal(f.get('SELECT name FROM documents').name,'file.txt');
});
test('legacy malformed download names are safely encoded without header injection',async t=>{
 const f=setup(t);f.document('file',f.alice.id,{name:'legacy\ud800.txt'});const response=await download(f.alice,'file');assert.equal(response.status,200);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.match(response.headers.get('Content-Disposition'),/^attachment; filename="download.txt";/);
});

for(const revoke of ['role','active','identity'])test(`profile private response is withheld after mid-read ${revoke} revocation`,async t=>{
 const f=setup(t),hr=f.actors.hr_manager;profile(f,f.alice);const prepare=f.env.DB.prepare;let fired=false;f.env.DB.prepare=sql=>{const statement=prepare(sql);if(/^SELECT \* FROM emergency_contacts/.test(sql)){const all=statement.all;statement.all=async()=>{const result=await all();fired=true;f.run(revoke==='role'?"UPDATE employees SET role='employee' WHERE id=?":revoke==='active'?'UPDATE employees SET active=0 WHERE id=?':'UPDATE employees SET user_id=NULL WHERE id=?',hr.id);return result}}return statement};const result=await data(await getProfile(hr,f.alice.id),403);assert.ok(fired);assert.ok(!JSON.stringify(result).includes('Synthetic private biography'));
});
test('public profile response is withheld if its subject leaves the roster during the read',async t=>{
 const f=setup(t);profile(f,f.alice);const prepare=f.env.DB.prepare;let fired=false;f.env.DB.prepare=sql=>{const statement=prepare(sql);if(/^SELECT CASE WHEN work_phone_public/.test(sql)){const first=statement.first;statement.first=async()=>{const result=await first();fired=true;f.run("UPDATE employee_profiles SET employment_status='Terminated' WHERE employee_id=?",f.alice.id);return result}}return statement};await data(await getProfile(f.actors.employee,f.alice.id),404);assert.ok(fired);
});
for(const competing of ['deactivate','demote','cycle'])test(`profile manager assignment rejects a concurrent ${competing} change`,async t=>{
 const f=setup(t),manager=f.actors.manager;const verify=beforeWrite(f,/^UPDATE employees SET/,()=>{if(competing==='cycle')f.run('UPDATE employees SET manager_id=? WHERE id=?',f.alice.id,manager.id);else f.run(competing==='deactivate'?'UPDATE employees SET active=0 WHERE id=?':"UPDATE employees SET role='employee' WHERE id=?",manager.id)});await data(await postProfile(f.actors.admin,f.alice.id,job({manager_id:manager.id,title:'Changed title',division:'Changed division'})),409);verify();assert.equal(f.get('SELECT manager_id FROM employees WHERE id=?',f.alice.id).manager_id,null);assert.equal(f.get('SELECT title FROM employees WHERE id=?',f.alice.id).title,'Tester');assert.equal(f.get('SELECT COUNT(*) n FROM employee_profiles').n,0);assert.equal(f.get('SELECT COUNT(*) n FROM employment_history').n,0);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);
});
test('HR unchanged manager field cannot reverse a concurrent administrator transfer',async t=>{
 const f=setup(t),manager=f.actors.manager;const verify=beforeWrite(f,/^UPDATE employees SET/,()=>f.run('UPDATE employees SET manager_id=? WHERE id=?',manager.id,f.alice.id));await data(await postProfile(f.actors.hr_manager,f.alice.id,job({manager_id:null,title:'Changed title'})),409);verify();assert.equal(f.get('SELECT manager_id FROM employees WHERE id=?',f.alice.id).manager_id,manager.id);assert.equal(f.get('SELECT title FROM employees WHERE id=?',f.alice.id).title,'Tester');assert.equal(f.get('SELECT COUNT(*) n FROM employment_history').n,0);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);
});

for(const role of roles)test(`${role}: authorized profile photo projection exposes presence and version only`,async t=>{
 const f=setup(t);f.run('INSERT INTO employee_photos (employee_id,object_key,mime,size,sha256,source_id,imported_at) VALUES (?,?,?,?,?,?,?)',f.alice.id,'private-photo-key','image/png',67,'synthetic-version','synthetic-source-id','2026-01-01');const result=await data(await getProfile(f.actors[role],f.alice.id));assert.equal(result.profile.has_photo,true);assert.equal(result.profile.photo_version,'synthetic-version');assert.ok(!JSON.stringify(result).includes('private-photo-key'));assert.ok(!JSON.stringify(result).includes('synthetic-source-id'));
});
test('profiles without photos report absence without changing storage or creating records',async t=>{
 const f=setup(t);const result=await data(await getProfile(f.alice,f.alice.id));assert.equal(result.profile.has_photo,false);assert.equal(result.profile.photo_version,null);assert.equal(f.storage.size,0);assert.equal(f.get('SELECT COUNT(*) n FROM employee_photos').n,0);
});
test('hidden former profile is rejected before any photo metadata lookup',async t=>{
 const f=setup(t);profile(f,f.alice,'Terminated');const prepare=f.env.DB.prepare;let reads=0;f.env.DB.prepare=sql=>{if(/FROM employee_photos/.test(sql))reads++;return prepare(sql)};await data(await getProfile(f.actors.employee,f.alice.id),404);assert.equal(reads,0);
});
