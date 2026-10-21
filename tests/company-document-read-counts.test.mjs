// Synthetic in-memory routes only. No live database, storage, or identities.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,asUser,jsonRequest} from './harness.mjs';

const state=await import('../app/api/state/route.ts');
const operations=await import('../app/api/operations/route.ts');
const scopes=['live','qa-bots-v1'];
const roles=['employee','manager','hiring_manager','hr_manager','admin'];
const stamp='2026-10-12T12:00:00Z';
const scopedTables=['employees','leave_requests','documents','events','audit','tasks','entitlements','employee_profiles','emergency_contacts','employee_identifiers','compensation_records','employment_history','education_records','benefit_enrollments','workflow_templates','workflow_runs','assets','asset_history','announcements','announcement_reads','time_entries','document_acknowledgements','employee_photos'];

function setup(t){
 const f=fixture();t.after(()=>f.close());f.actors={};
 for(const scope of scopes){
  f.actors[scope]=Object.fromEntries(roles.map(role=>[role,f.employee(`${scope}-${role}`,{role,data_scope:scope})]));
  f.document(`${scope}-company`,f.actors[scope].employee.id,{visibility:'company'});
  f.document(`${scope}-unread`,f.actors[scope].hr_manager.id,{visibility:'company'});
 }
 return f;
}
async function ok(response){assert.equal(response.status,200,await response.clone().text());return response.json()}
const read=actor=>asUser(actor,()=>state.GET());
const acknowledge=(actor,id)=>asUser(actor,()=>operations.POST(jsonRequest({action:'acknowledgeDocument',id})));
function insertAck(f,id,documentId,employeeId,scope){
 f.run('INSERT INTO document_acknowledgements(id,document_id,employee_id,acknowledged_at,data_scope) VALUES(?,?,?,?,?)',id,documentId,employeeId,stamp,scope);
}
function counts(data){return Object.fromEntries(data.documents.filter(d=>d.visibility==='company').map(d=>[d.id,d.read_count]))}
function snapshot(f){return JSON.stringify(Object.fromEntries(scopedTables.map(table=>[table,f.rows(`SELECT * FROM ${table} ORDER BY rowid`)])))}

for(const scope of scopes)for(const role of ['hr_manager','admin'])test(`${scope} ${role}: company files expose zero and distinct acknowledgement counts without reader identities`,async t=>{
 const f=setup(t),actors=f.actors[scope],actor=actors[role],id=`${scope}-company`;
 await ok(await acknowledge(actors.employee,id));
 await ok(await acknowledge(actors.manager,id));
 await ok(await acknowledge(actors.employee,id));
 // A legacy duplicate row must not make one reader count twice.
 insertAck(f,'duplicate-reader',id,actors.employee.id,scope);
 const data=await ok(await read(actor));
 assert.deepEqual(counts(data),{[id]:2,[`${scope}-unread`]:0});
 assert.deepEqual(data.acknowledgements,[]);
 const company=data.documents.find(d=>d.id===id);
 assert.deepEqual(Object.keys(company).sort(),['id','owner_id','name','category','visibility','mime','size','uploaded_at','folder','expiry_date','pinned','owner_name','demo','read_count'].sort());
 await ok(await acknowledge(actor,id));
 const updated=await ok(await read(actor));
 assert.equal(counts(updated)[id],3);
 assert.equal(updated.acknowledgements.length,1);
 assert.deepEqual(Object.keys(updated.acknowledgements[0]).sort(),['acknowledged_at','document_id']);
 assert.equal(updated.acknowledgements[0].document_id,id);
 // Warmed admin state may seed existing demo fixtures once; subsequent reads do not mutate any scope.
 const before=snapshot(f);await ok(await read(actor));assert.equal(snapshot(f),before);
});

for(const scope of scopes)for(const role of ['employee','manager','hiring_manager'])test(`${scope} ${role}: company readership stays self-only and aggregate fields are absent`,async t=>{
 const f=setup(t),actors=f.actors[scope],actor=actors[role],id=`${scope}-company`;
 await ok(await acknowledge(actors.hr_manager,id));
 await ok(await acknowledge(actor,id));
 f.document('own-personal',actor.id);
 f.document('private-hr',actor.id,{visibility:'hr'});
 const before=snapshot(f),data=await ok(await read(actor));
 assert.ok(data.documents.some(d=>d.id===id),'The existing company file remains accessible');
 assert.ok(data.documents.some(d=>d.id==='own-personal'),'Personal-file ownership is preserved');
 assert.ok(!data.documents.some(d=>d.id==='private-hr'),'HR-only visibility is preserved');
 assert.ok(data.documents.every(d=>!Object.hasOwn(d,'read_count')));
 assert.equal(data.acknowledgements.length,1);
 assert.equal(data.acknowledgements[0].document_id,id);
 assert.deepEqual(Object.keys(data.acknowledgements[0]).sort(),['acknowledged_at','document_id']);
 assert.equal(snapshot(f),before);
});

for(const scope of scopes)test(`${scope}: historical reads survive reader deactivation, but archived and non-company files never get aggregate counts`,async t=>{
 const f=setup(t),actors=f.actors[scope],id=`${scope}-company`;
 await ok(await acknowledge(actors.employee,id));
 f.run('UPDATE employees SET active=0 WHERE id=?',actors.employee.id);
 for(const visibility of ['personal','hr']){
  const doc=f.document(`former-company-${visibility}`,actors.hr_manager.id,{visibility});
  insertAck(f,`old-read-${visibility}`,doc.id,actors.employee.id,scope);
 }
 const archived=f.document('archived-company',actors.hr_manager.id,{visibility:'company',archived:1});
 insertAck(f,'archived-read',archived.id,actors.employee.id,scope);
 const data=await ok(await read(actors.hr_manager));
 assert.equal(counts(data)[id],1,'A genuine historical acknowledgement is still counted');
 assert.ok(!data.documents.some(d=>d.id===archived.id));
 for(const visibility of ['personal','hr'])assert.equal(data.documents.find(d=>d.id===`former-company-${visibility}`).read_count,null);
});

for(const scope of scopes)test(`${scope}: aggregate counts ignore malformed cross-scope acknowledgements, readers, and document owners`,async t=>{
 const f=setup(t),actors=f.actors[scope],foreignScope=scopes.find(s=>s!==scope),foreign=f.actors[foreignScope],id=`${scope}-company`;
 await ok(await acknowledge(actors.employee,id));
 await ok(await acknowledge(foreign.employee,`${foreignScope}-company`));
 // Only this isolated fixture disables relationship triggers to test query defense in depth.
 f.sqlite.exec('DROP TRIGGER document_acknowledgements_scope_insert; DROP TRIGGER documents_scope_update;');
 insertAck(f,'wrong-reader',id,foreign.manager.id,scope);
 insertAck(f,'wrong-ack-scope',id,foreign.hr_manager.id,foreignScope);
 insertAck(f,'foreign-document',`${foreignScope}-company`,actors.manager.id,scope);
 insertAck(f,'missing-reader',id,'nonexistent-synthetic-reader',scope);
 const wrongOwner=f.document('wrong-owner',actors.hr_manager.id,{visibility:'company'});
 insertAck(f,'wrong-owner-read',wrongOwner.id,actors.employee.id,scope);
 f.run('UPDATE documents SET owner_id=? WHERE id=?',foreign.hr_manager.id,wrongOwner.id);
 const before=snapshot(f),data=await ok(await read(actors.hr_manager));
 assert.deepEqual(counts(data),{[id]:1,[`${scope}-unread`]:0});
 assert.equal(snapshot(f),before);
 const other=await ok(await read(foreign.hr_manager));
 assert.deepEqual(counts(other),{[`${foreignScope}-company`]:1,[`${foreignScope}-unread`]:0});
});

for(const scope of scopes)test(`${scope}: HR demotion after aggregate retrieval rejects the entire state response`,async t=>{
 const f=setup(t),actor=f.actors[scope].hr_manager,prepare=f.env.DB.prepare;let fired=false;
 await ok(await acknowledge(f.actors[scope].employee,`${scope}-company`));
 f.env.DB.prepare=sql=>{
  const statement=prepare(sql);
  if(sql.includes('AS read_count')){
   const query=statement.all;statement.all=async()=>{const data=await query();fired=true;f.run('UPDATE employees SET role=? WHERE id=?','employee',actor.id);return data};
  }
  return statement;
 };
 const response=await read(actor);assert.ok(fired);assert.equal(response.status,403);assert.deepEqual(Object.keys(await response.json()),['error']);
});
