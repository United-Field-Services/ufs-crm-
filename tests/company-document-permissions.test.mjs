// Synthetic in-memory route regressions only. No live identities or storage.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,asUser,fileContext,fileRequest,origin} from './harness.mjs';

const file=await import('../app/api/files/[id]/route.ts');
const scopes=['live','qa-bots-v1'];
const employeeRoles=['employee','manager','hiring_manager'];
const hrRoles=['hr_manager','admin'];
const scopedTables=['employees','leave_requests','documents','events','audit','tasks','entitlements','employee_profiles','emergency_contacts','employee_identifiers','compensation_records','employment_history','education_records','benefit_enrollments','workflow_templates','workflow_runs','assets','asset_history','announcements','announcement_reads','time_entries','document_acknowledgements','employee_photos'];
const metadata={name:'renamed.txt',folder:'Changed folder',expiryDate:'2027-12-31',pinned:false};

function setup(t){
 const f=fixture();t.after(()=>f.close());f.actors={};
 for(const scope of scopes){
  f.actors[scope]=Object.fromEntries([...employeeRoles,...hrRoles].map(role=>[role,f.employee(`${scope}-${role}`,{role,data_scope:scope})]));
  f.document(`${scope}-company-sentinel`,f.actors[scope].employee.id,{visibility:'company',pinned:1});
 }
 return f;
}
function snapshot(f,scope){
 return JSON.stringify(Object.fromEntries(scopedTables.map(table=>[table,f.rows(`SELECT * FROM ${table}${scope?' WHERE data_scope=?':''} ORDER BY rowid`,...(scope?[scope]:[]))])));
}
const mutate=(actor,id,method,body=metadata)=>asUser(actor,()=>method==='PATCH'
 ?file.PATCH(new Request(`${origin}/api/files/${id}`,{method,headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}),fileContext(id))
 :file.DELETE(fileRequest(id,method),fileContext(id)));
async function expect(response,status){assert.equal(response.status,status,await response.clone().text());return response.json()}
function storageSnapshot(f){return Array.from(f.storage,([key,value])=>[key,Array.from(value)])}
function beforeMutation(f,change){
 // The competing change commits before the atomic D1 batch starts.
 const batch=f.env.DB.batch;let fired=false;
 f.env.DB.batch=statements=>{if(!fired&&statements.some(statement=>/^UPDATE documents SET/.test(statement.sql))){fired=true;change()}return batch(statements)};
 return ()=>assert.ok(fired,'The mutation boundary was exercised');
}

for(const scope of scopes)for(const role of employeeRoles)for(const method of ['PATCH','DELETE'])test(`${scope} ${role} company owner cannot ${method} company metadata`,async t=>{
 const f=setup(t),actor=f.actors[scope][role],doc=f.document('owned-company',actor.id,{visibility:'company',pinned:1,folder:'Published policies'});
 const before=snapshot(f),stored=storageSnapshot(f);
 // Company readership is retained even when that reader owns the company file.
 const download=await asUser(actor,()=>file.GET(fileRequest(doc.id),fileContext(doc.id)));assert.equal(download.status,200);
 await expect(await mutate(actor,doc.id,method),404);
 assert.equal(snapshot(f),before);assert.deepEqual(storageSnapshot(f),stored);
 assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);
});

for(const scope of scopes)for(const role of employeeRoles)for(const method of ['PATCH','DELETE'])test(`${scope} ${role} personal owner retains ${method} access`,async t=>{
 const f=setup(t),actor=f.actors[scope][role],doc=f.document('owned-personal',actor.id),before=f.get('SELECT * FROM documents WHERE id=?',doc.id);
 const otherScope=scopes.find(value=>value!==scope),otherBefore=snapshot(f,otherScope),stored=storageSnapshot(f);
 await expect(await mutate(actor,doc.id,method),200);
 const after=f.get('SELECT * FROM documents WHERE id=?',doc.id);
 assert.deepEqual({...after},{...before,...(method==='PATCH'?{name:metadata.name,folder:metadata.folder,expiry_date:metadata.expiryDate}:{archived:1})});
 const audit=f.rows('SELECT actor_id,action,target_id,data_scope FROM audit');
 assert.deepEqual(audit.map(row=>({...row})),[{actor_id:actor.id,action:method==='PATCH'?'Updated document metadata':'Archived document',target_id:doc.id,data_scope:scope}]);
 assert.equal(snapshot(f,otherScope),otherBefore);assert.deepEqual(storageSnapshot(f),stored);assert.equal(f.bucketReads.length,0);
});

for(const scope of scopes)for(const role of employeeRoles)for(const method of ['PATCH','DELETE'])test(`${scope} ${role} cannot ${method} another personal document`,async t=>{
 const f=setup(t),actor=f.actors[scope][role],owner=f.employee('other-owner',{data_scope:scope}),doc=f.document('other-personal',owner.id),before=snapshot(f),stored=storageSnapshot(f);
 await expect(await mutate(actor,doc.id,method),404);assert.equal(snapshot(f),before);assert.deepEqual(storageSnapshot(f),stored);assert.equal(f.bucketReads.length,0);
});

for(const scope of scopes)for(const role of hrRoles)for(const visibility of ['personal','company','hr'])for(const method of ['PATCH','DELETE'])test(`${scope} ${role} retains scoped ${visibility} ${method} access`,async t=>{
 const f=setup(t),actor=f.actors[scope][role],doc=f.document('managed',f.actors[scope].employee.id,{visibility,pinned:visibility==='company'?1:0}),before=f.get('SELECT * FROM documents WHERE id=?',doc.id);
 const otherScope=scopes.find(value=>value!==scope),otherBefore=snapshot(f,otherScope),stored=storageSnapshot(f);
 await expect(await mutate(actor,doc.id,method),200);
 const after=f.get('SELECT * FROM documents WHERE id=?',doc.id);
 assert.deepEqual({...after},{...before,...(method==='PATCH'?{name:metadata.name,folder:metadata.folder,expiry_date:metadata.expiryDate,pinned:0}:{archived:1})});
 const audit=f.rows('SELECT actor_id,action,target_id,data_scope FROM audit');
 assert.deepEqual(audit.map(row=>({...row})),[{actor_id:actor.id,action:method==='PATCH'?'Updated document metadata':'Archived document',target_id:doc.id,data_scope:scope}]);
 assert.equal(snapshot(f,otherScope),otherBefore);assert.deepEqual(storageSnapshot(f),stored);assert.equal(f.bucketReads.length,0);
});

for(const scope of scopes)for(const role of hrRoles)for(const visibility of ['personal','company','hr'])for(const method of ['PATCH','DELETE'])test(`${scope} ${role} cannot ${method} cross-scope ${visibility} documents`,async t=>{
 const f=setup(t),actor=f.actors[scope][role],otherScope=scopes.find(value=>value!==scope),doc=f.document('foreign',f.actors[otherScope].employee.id,{visibility}),before=snapshot(f),stored=storageSnapshot(f);
 await expect(await mutate(actor,doc.id,method),404);assert.equal(snapshot(f),before);assert.deepEqual(storageSnapshot(f),stored);assert.equal(f.bucketReads.length,0);
});

for(const scope of scopes)for(const role of employeeRoles)for(const method of ['PATCH','DELETE'])test(`${scope} ${role} cannot ${method} a personal file promoted to company before commit`,async t=>{
 const f=setup(t),actor=f.actors[scope][role],doc=f.document('promoted',actor.id),before=f.get('SELECT * FROM documents WHERE id=?',doc.id),stored=storageSnapshot(f);
 const verify=beforeMutation(f,()=>f.run("UPDATE documents SET visibility='company',pinned=1 WHERE id=?",doc.id));
 await expect(await mutate(actor,doc.id,method),404);verify();
 assert.deepEqual({...f.get('SELECT * FROM documents WHERE id=?',doc.id)},{...before,visibility:'company',pinned:1});
 assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);assert.deepEqual(storageSnapshot(f),stored);assert.equal(f.bucketReads.length,0);
});

for(const scope of scopes)for(const role of hrRoles)for(const method of ['PATCH','DELETE'])test(`${scope} demoted ${role} cannot retain company-owner ${method} access`,async t=>{
 const f=setup(t),actor=f.actors[scope][role],doc=f.document('formerly-managed',actor.id,{visibility:'company',pinned:1}),before=f.get('SELECT * FROM documents WHERE id=?',doc.id),stored=storageSnapshot(f);
 const verify=beforeMutation(f,()=>f.run("UPDATE employees SET role='employee' WHERE id=?",actor.id));
 await expect(await mutate(actor,doc.id,method,{...metadata,pinned:undefined}),404);verify();
 assert.deepEqual(f.get('SELECT * FROM documents WHERE id=?',doc.id),before);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);assert.deepEqual(storageSnapshot(f),stored);assert.equal(f.bucketReads.length,0);
});
