import {beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,asUser,jsonRequest,uploadRequest,fileContext,fileRequest,origin} from './harness.mjs';

const files=await import('../app/api/files/route.ts');
const file=await import('../app/api/files/[id]/route.ts');
const state=await import('../app/api/state/route.ts');
const ops=await import('../app/api/operations/route.ts');
const actions=await import('../app/api/action/route.ts');
let f,admin,hr,manager,otherManager,alice,bob;
beforeEach(()=>{f=fixture();admin=f.employee('owner',{role:'admin'});hr=f.employee('hr',{role:'hr_manager'});manager=f.employee('manager',{role:'manager'});otherManager=f.employee('other-manager',{role:'manager'});alice=f.employee('alice',{manager_id:manager.id});bob=f.employee('bob',{manager_id:otherManager.id})});
afterEach(()=>f.close());
const upload=(actor,fields={})=>asUser(actor,()=>files.POST(uploadRequest('synthetic.txt','Synthetic test content',fields)));
const download=(actor,id)=>asUser(actor,()=>file.GET(fileRequest(id),fileContext(id)));
const archive=(actor,id)=>asUser(actor,()=>file.DELETE(fileRequest(id,'DELETE'),fileContext(id)));
const patch=(actor,id,body={},headers={})=>asUser(actor,()=>file.PATCH(new Request(`${origin}/api/files/${id}`,{method:'PATCH',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify({name:'renamed.txt',folder:'Policies',expiryDate:'2027-12-31',pinned:false,...body})}),fileContext(id)));
const operation=(actor,body)=>asUser(actor,()=>ops.POST(jsonRequest(body)));
const action=(actor,body)=>asUser(actor,()=>actions.POST(jsonRequest(body)));
const access=(employee,changes={})=>({action:'updateAccess',employeeId:employee.id,role:employee.role,active:!!employee.active,managerId:employee.manager_id,...changes});
const time=(changes={})=>({action:'saveTime',date:'2026-01-05',minutes:480,project:'Synthetic project',notes:'Synthetic original summary',...changes});
async function body(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json()}
const directory=async actor=>body(await asUser(actor,()=>state.GET()));
const operations=async actor=>body(await asUser(actor,()=>ops.GET()));

function pauseStatement(pattern){
 // Pause dispatch before entering D1's serialized transaction, allowing the
 // competing transaction to commit before the guarded write is evaluated.
 const batch=f.env.DB.batch;let reach,release;const reached=new Promise(resolve=>{reach=resolve});const released=new Promise(resolve=>{release=resolve});
 f.env.DB.batch=async statements=>{if(statements.some(statement=>pattern.test(statement.sql))){reach();await released}return batch(statements)};
 return {reached,release};
}

test('HR uploads private files for active employees with target-owned storage and metadata',async()=>{
 const {id}=await body(await upload(hr,{employeeId:alice.id,folder:'Employee contracts',expiryDate:'2027-12-31',category:'Contract'}));
 const d=f.get('SELECT * FROM documents WHERE id=?',id);assert.equal(d.owner_id,alice.id);assert.equal(d.folder,'Employee contracts');assert.equal(d.expiry_date,'2027-12-31');assert.equal(d.visibility,'personal');assert.match(d.object_key,/^documents\/alice\//);assert.ok(f.storage.has(d.object_key));
 assert.equal((await download(alice,id)).status,200);assert.equal((await download(hr,id)).status,200);assert.equal((await download(manager,id)).status,404);assert.equal((await download(bob,id)).status,404);
 assert.deepEqual((await directory(alice)).documents.map(d=>d.id),[id]);assert.deepEqual((await directory(bob)).documents,[]);assert.equal(f.get('SELECT actor_id FROM audit WHERE target_id=?',id).actor_id,hr.id);
});
test('non-HR forged upload owner fields cannot put a document in another employee account',async()=>{
 for(const actor of [alice,manager]){const {id}=await body(await upload(actor,{employeeId:bob.id,owner_id:bob.id,user_id:bob.user_id}));const d=f.get('SELECT * FROM documents WHERE id=?',id);assert.equal(d.owner_id,actor.id);assert.ok(d.object_key.startsWith(`documents/${actor.id}/`));assert.equal((await download(bob,id)).status,404)}
});
test('HR target uploads reject missing and inactive employees before writing storage',async()=>{
 f.run('UPDATE employees SET active=0 WHERE id=?',bob.id);for(const employeeId of [bob.id,'missing',"alice' OR 1=1 --"])await body(await upload(hr,{employeeId}),404);assert.equal(f.storage.size,0);assert.equal(f.get('SELECT COUNT(*) n FROM documents').n,0);
});
test('upload metadata validation rejects invalid folder and expiry without object writes',async()=>{
 for(const fields of [{folder:'x'.repeat(101)},{folder:'   '},{expiryDate:'2027-02-30'},{expiryDate:'not-a-date'},{category:'Payroll vault'}])await body(await upload(hr,{employeeId:alice.id,...fields}),400);assert.equal(f.storage.size,0);
});
test('upload company publication and pinning depend on current HR role',async()=>{
 await body(await upload(alice,{visibility:'company',pinned:'on'}),403);
 const privateId=(await body(await upload(alice,{pinned:'on'}))).id;assert.equal(f.get('SELECT pinned FROM documents WHERE id=?',privateId).pinned,0);
 const hrPrivate=(await body(await upload(hr,{pinned:'on'}))).id;assert.equal(f.get('SELECT pinned FROM documents WHERE id=?',hrPrivate).pinned,0);
 const id=(await body(await upload(hr,{employeeId:alice.id,visibility:'company',pinned:'on'}))).id;assert.equal(f.get('SELECT pinned FROM documents WHERE id=?',id).pinned,1);assert.equal((await download(bob,id)).status,200);
});
test('HR target upload quota is charged to the target employee and atomic across requests',async()=>{
 for(let i=0;i<99;i++)f.document(`file-${i}`,alice.id);
 const results=await Promise.all([upload(hr,{employeeId:alice.id}),upload(admin,{employeeId:alice.id})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(f.get('SELECT COUNT(*) n FROM documents WHERE owner_id=?',alice.id).n,100);assert.equal(f.storage.size,100);
 assert.equal((await upload(hr,{employeeId:bob.id})).status,200);
});
test('owner and HR can edit file metadata without changing ownership, visibility, bytes or key',async()=>{
 f.document('private',alice.id);const before=f.get('SELECT * FROM documents');const bytes=f.storage.get(before.object_key);
 await body(await patch(alice,'private',{visibility:'company',owner_id:bob.id,object_key:'evil',archived:1}));
 const saved=f.get('SELECT * FROM documents');assert.equal(saved.name,'renamed.txt');assert.equal(saved.folder,'Policies');assert.equal(saved.expiry_date,'2027-12-31');for(const key of ['owner_id','visibility','object_key','mime','size','archived'])assert.equal(saved[key],before[key]);assert.deepEqual(f.storage.get(saved.object_key),bytes);
 await body(await patch(hr,'private',{name:'hr-updated.txt',folder:'HR folder',expiryDate:''}));assert.equal(f.get('SELECT expiry_date FROM documents').expiry_date,null);
});
test('linked manager may read but may not rename or archive another employee file',async()=>{
 f.document('linked',alice.id);f.leave('linked-leave',alice.id,{attachment_id:'linked'});assert.equal((await download(manager,'linked')).status,200);
 for(const actor of [manager,bob]){await body(await patch(actor,'linked'),404);await body(await archive(actor,'linked'),404)}assert.equal(f.get('SELECT name FROM documents').name,'linked.txt');
});
test('company readership and read acknowledgement do not grant metadata permissions',async()=>{
 f.document('policy',hr.id,{visibility:'company',pinned:1});await body(await operation(alice,{action:'acknowledgeDocument',id:'policy'}));assert.equal((await download(alice,'policy')).status,200);await body(await patch(alice,'policy'),404);await body(await archive(alice,'policy'),404);
});
test('only HR can pin company documents and private files cannot be pinned',async()=>{
 f.document('private',alice.id);f.document('company',alice.id,{visibility:'company'});
 await body(await patch(alice,'private',{pinned:true}),403);await body(await patch(hr,'private',{pinned:true}),403);await body(await patch(alice,'company',{pinned:true}),404);await body(await patch(hr,'company',{pinned:true}));assert.equal(f.get('SELECT pinned FROM documents WHERE id=?','company').pinned,1);
});
test('file PATCH preserves extension and rejects control characters and invalid dates',async()=>{
 f.document('file',alice.id);for(const changes of [{name:'script.html'},{name:'missing-extension'},{name:'bad\nname.txt'},{name:'bad\u0000name.txt'},{name:''},{name:'x'.repeat(181)+'.txt'},{expiryDate:'2026-02-30'},{folder:'x'.repeat(101)}])await body(await patch(alice,'file',changes),400);assert.equal(f.get('SELECT name FROM documents').name,'file.txt');
});
test('file PATCH checks same origin and streamed JSON size and requires an object',async()=>{
 f.document('file',alice.id);for(const headers of [{Origin:'https://evil.example.test'},{Origin:''},{'sec-fetch-site':'cross-site'}])await body(await patch(alice,'file',{},headers),403);
 await body(await patch(alice,'file',{name:'x'.repeat(21000)}),413);
 for(const raw of ['[]','null','not-json']){const req=new Request(`${origin}/api/files/file`,{method:'PATCH',headers:{Origin:origin,'Content-Type':'application/json'},body:raw});await body(await asUser(alice,()=>file.PATCH(req,fileContext('file'))),400)}assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);
});
test('file archive removes listing, download, future acknowledgement and metadata editing but retains bytes',async()=>{
 const doc=f.document('policy',alice.id,{visibility:'company'});await body(await operation(bob,{action:'acknowledgeDocument',id:doc.id}));await body(await archive(hr,doc.id));assert.equal(f.get('SELECT archived FROM documents').archived,1);assert.ok(f.storage.has(doc.object_key));
 for(const actor of [alice,bob,hr,admin]){assert.ok(!(await directory(actor)).documents.some(d=>d.id===doc.id));assert.equal((await download(actor,doc.id)).status,404);await body(await patch(actor,doc.id),404);await body(await operation(actor,{action:'acknowledgeDocument',id:doc.id}),404)}assert.equal(f.get('SELECT COUNT(*) n FROM document_acknowledgements').n,1);
});
test('read acknowledgements are idempotent and scoped to authenticated identity across both state APIs',async()=>{
 f.document('policy',hr.id,{visibility:'company'});await body(await operation(alice,{action:'acknowledgeDocument',id:'policy',employeeId:bob.id,employee_id:bob.id,acknowledgedAt:'2000-01-01'}));const original=f.get('SELECT * FROM document_acknowledgements');await body(await operation(alice,{action:'acknowledgeDocument',id:'policy'}));assert.equal(f.get('SELECT COUNT(*) n FROM document_acknowledgements').n,1);assert.equal(original.employee_id,alice.id);assert.equal(f.get('SELECT acknowledged_at FROM document_acknowledgements').acknowledged_at,original.acknowledged_at);
 assert.equal((await directory(alice)).acknowledgements.length,1);assert.equal((await directory(bob)).acknowledgements.length,0);assert.equal((await operations(bob)).acknowledgements.length,0);assert.equal((await operations(manager)).acknowledgements.length,0);assert.equal((await operations(hr)).acknowledgements.length,1);
});
test('directory exposes only deliberate public profile columns and opt-in work phone, for every role',async()=>{
 const columns=f.rows('PRAGMA table_info(employee_profiles)');const publicColumns=new Set(['employee_id','division','work_arrangement','work_phone']);const values=Object.fromEntries(columns.map(c=>[c.name,c.name==='employee_id'?alice.id:c.name==='work_phone_public'?0:c.name==='hours_per_day'?7.25:(c.name==='data_scope'?'live':`SYNTHETIC_PRIVATE_${c.name}`)]));values.division='Synthetic public division';values.work_arrangement='Synthetic public arrangement';
 f.run(`INSERT INTO employee_profiles (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(()=>'?').join(',')})`,...Object.values(values));
 for(const actor of [alice,bob,manager,hr,admin]){const data=await directory(actor);const p=data.people.find(p=>p.id===alice.id);assert.equal(p.division,values.division);assert.equal(p.work_arrangement,values.work_arrangement);assert.equal(p.work_phone,'');for(const c of columns.filter(c=>!publicColumns.has(c.name)))assert.ok(!(c.name in p),`Leaked ${c.name} to ${actor.id}`);assert.ok(!JSON.stringify(data).includes('SYNTHETIC_PRIVATE_'),`Private profile leaked in state to ${actor.id}`)}
 f.run('UPDATE employee_profiles SET work_phone_public=1 WHERE employee_id=?',alice.id);assert.equal((await directory(bob)).people.find(p=>p.id===alice.id).work_phone,values.work_phone);f.run('UPDATE employee_profiles SET work_phone_public=0 WHERE employee_id=?',alice.id);assert.equal((await directory(bob)).people.find(p=>p.id===alice.id).work_phone,'');
});
test('HR demotion immediately removes private file management and extra operations visibility',async()=>{
 f.document('private',bob.id);await body(await patch(hr,'private'));assert.equal((await download(hr,'private')).status,200);await body(await action(admin,access(hr,{role:'employee'})));assert.equal((await download(hr,'private')).status,404);await body(await patch(hr,'private'),404);await body(await archive(hr,'private'),404);await body(await upload(hr,{visibility:'company'}),403);const uploaded=await body(await upload(hr,{employeeId:bob.id}));assert.equal(f.get('SELECT owner_id FROM documents WHERE id=?',uploaded.id).owner_id,hr.id);assert.deepEqual((await operations(hr)).templates,[]);
});
test('inactive accounts lose file PATCH and every expanded operation regardless of ownership',async()=>{
 f.document('owned',alice.id);await body(await action(admin,access(alice,{active:false})));for(const response of [await patch(alice,'owned'),await upload(alice),await archive(alice,'owned'),await operation(alice,time()),await asUser(alice,()=>ops.GET())])await body(response,403);assert.equal(f.get('SELECT name FROM documents').name,'owned.txt');
});
test('anonymous file metadata requests cannot disclose existence',async()=>{f.document('file',alice.id);await body(await patch(null,'file'),401);await body(await patch(null,'missing'),401)});

test('cancelled newly edited time drafts are never disclosed to a former reviewer',async()=>{
 const {id}=await body(await operation(alice,time()));await body(await operation(alice,{action:'submitTime',id}));await body(await operation(manager,{action:'reviewTime',id,status:'rejected',note:'Please amend'}));await body(await operation(alice,time({id,notes:'Private changed draft never submitted',minutes:120})));assert.equal((await operations(manager)).timeEntries.length,0);await body(await operation(alice,{action:'deleteTime',id}));assert.equal((await operations(manager)).timeEntries.length,0);const saved=f.get('SELECT * FROM time_entries WHERE id=?',id);assert.equal(saved.required_manager_id,null);assert.equal(saved.reviewed_by,null);assert.equal(saved.status,'cancelled');assert.equal((await operations(alice)).timeEntries[0].notes,'Private changed draft never submitted');
});
test('concurrent managers cannot review the same submitted time entry twice',async()=>{
 const {id}=await body(await operation(alice,time()));await body(await operation(alice,{action:'submitTime',id}));const results=await Promise.all([operation(manager,{action:'reviewTime',id,status:'approved'}),operation(manager,{action:'reviewTime',id,status:'rejected'})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,403]);assert.equal(f.get("SELECT COUNT(*) n FROM audit WHERE action IN ('Approved time entry','Returned time entry')").n,1);
});
test('time review cannot commit after manager transfer while it is in flight',async()=>{
 const {id}=await body(await operation(alice,time()));await body(await operation(alice,{action:'submitTime',id}));const gate=pauseStatement(/^UPDATE time_entries SET status=\?,review_note=/);const pending=operation(manager,{action:'reviewTime',id,status:'approved'});await gate.reached;try{await body(await action(admin,access(alice,{managerId:otherManager.id})))}finally{gate.release()}await body(await pending,403);assert.equal(f.get('SELECT status FROM time_entries').status,'submitted');await body(await operation(otherManager,{action:'reviewTime',id,status:'approved'}));
});
test('time review cannot commit after reviewer deactivation while it is in flight',async()=>{
 const {id}=await body(await operation(alice,time()));await body(await operation(alice,{action:'submitTime',id}));const gate=pauseStatement(/^UPDATE time_entries SET status=\?,review_note=/);const pending=operation(manager,{action:'reviewTime',id,status:'approved'});await gate.reached;try{await body(await action(admin,access(manager,{active:false})))}finally{gate.release()}await body(await pending,403);assert.equal(f.get('SELECT status FROM time_entries').status,'submitted');
});
test('concurrent time edits cannot write into an entry after submission',async()=>{
 const {id}=await body(await operation(alice,time()));const gate=pauseStatement(/^INSERT INTO time_entries/);const pending=operation(alice,time({id,minutes:120,notes:'Racing draft'}));await gate.reached;try{await body(await operation(alice,{action:'submitTime',id}))}finally{gate.release()}await body(await pending,409);assert.equal(f.get('SELECT status FROM time_entries').status,'submitted');assert.equal(f.get('SELECT minutes FROM time_entries').minutes,480);
});
test('in-flight time submission snapshots the current manager after a transfer',async()=>{
 const {id}=await body(await operation(alice,time()));const gate=pauseStatement(/^UPDATE time_entries SET status='submitted'/);const pending=operation(alice,{action:'submitTime',id});await gate.reached;try{await body(await action(admin,access(alice,{managerId:otherManager.id})))}finally{gate.release()}await body(await pending);assert.equal(f.get('SELECT required_manager_id FROM time_entries').required_manager_id,otherManager.id);
});
test('workflow tasks remain visible and mutable only to their specific assignees and HR',async()=>{
 const {id}=await body(await operation(hr,{action:'saveTemplate',name:'Synthetic checklist',kind:'Offboarding',steps:[{title:'Employee step',assignee:'employee',offset:0},{title:'Manager step',assignee:'manager',offset:1},{title:'HR step',assignee:'hr',offset:2}]}));await body(await operation(hr,{action:'applyTemplate',templateId:id,employeeId:alice.id,startDate:'2026-01-05'}));const tasks=f.rows('SELECT * FROM tasks');
 for(const actor of [alice,manager,bob]){const listed=(await directory(actor)).tasks;assert.ok(listed.every(t=>t.assignee_id===actor.id));for(const task of tasks)await body(await action(actor,{action:'toggleTask',id:task.id,status:'completed'}),task.assignee_id===actor.id?200:403)}assert.equal((await operations(bob)).workflows.length,0);assert.equal((await operations(manager)).workflows.length,1);assert.equal((await operations(alice)).workflows[0].completed,2);
});
test('concurrent asset assignment commits once and exposes ownership only to the winner',async()=>{
 const {id}=await body(await operation(hr,{action:'saveAsset',name:'Synthetic laptop',tag:'SYNTHETIC-RACE-1',category:'Laptop'}));const results=await Promise.all([operation(hr,{action:'assignAsset',id,employeeId:alice.id}),operation(admin,{action:'assignAsset',id,employeeId:bob.id})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const asset=f.get('SELECT * FROM assets');assert.equal(f.get('SELECT COUNT(*) n FROM asset_history').n,1);for(const actor of [alice,bob,manager])assert.equal((await operations(actor)).assets.length,actor.id===asset.assigned_to?1:0);for(const actor of [alice,bob,manager])await body(await operation(actor,{action:'returnAsset',id}),403);assert.equal(f.get('SELECT assigned_to FROM assets').assigned_to,asset.assigned_to);
});
test('saving asset details cannot overwrite assignment from forged payload fields',async()=>{
 const {id}=await body(await operation(hr,{action:'saveAsset',name:'Synthetic laptop',tag:'SYNTHETIC-OWNERSHIP-1',category:'Laptop',assigned_to:bob.id,status:'assigned'}));assert.equal(f.get('SELECT assigned_to FROM assets').assigned_to,null);await body(await operation(hr,{action:'assignAsset',id,employeeId:alice.id}));await body(await operation(hr,{action:'saveAsset',id,name:'Renamed synthetic laptop',tag:'SYNTHETIC-OWNERSHIP-1',category:'Laptop',assigned_to:bob.id,status:'available'}));assert.equal(f.get('SELECT assigned_to FROM assets').assigned_to,alice.id);assert.equal(f.get('SELECT status FROM assets').status,'assigned');
});
test('employee owners cannot edit company metadata and omitted HR pin fields stay unchanged',async()=>{
 f.document('pinned-policy',alice.id,{visibility:'company',pinned:1});
 const before=f.get('SELECT * FROM documents WHERE id=?','pinned-policy');
 await body(await patch(alice,'pinned-policy',{name:'employee-renamed.txt',pinned:false}),404);assert.deepEqual(f.get('SELECT * FROM documents WHERE id=?','pinned-policy'),before);
 await body(await patch(alice,'pinned-policy',{pinned:undefined}),404);assert.deepEqual(f.get('SELECT * FROM documents WHERE id=?','pinned-policy'),before);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);
 await body(await patch(hr,'pinned-policy',{pinned:undefined}));assert.equal(f.get('SELECT pinned FROM documents WHERE id=?','pinned-policy').pinned,1);
 await body(await patch(hr,'pinned-policy',{pinned:false}));assert.equal(f.get('SELECT pinned FROM documents WHERE id=?','pinned-policy').pinned,0);
});
