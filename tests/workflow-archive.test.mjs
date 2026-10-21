// Synthetic in-memory route tests only. No provider calls or live records.
import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,asUser,jsonRequest,origin} from './harness.mjs';
const api=await import('../app/api/operations/route.ts');
const scopes=['live','qa-bots-v1'];
const roles=['admin','hr_manager','manager','hiring_manager','employee'];
let f,users;
beforeEach(()=>{
 f=fixture();users=Object.fromEntries(scopes.map((scope,index)=>[scope,Object.fromEntries(roles.map(role=>[role,f.employee(`archive-${index}-${role}`,{role,data_scope:scope})]))]));
});
afterEach(()=>f.close());
const act=(who,body)=>asUser(who,()=>api.POST(jsonRequest(body)));
const state=(who,section)=>asUser(who,()=>api.GET(section===undefined?undefined:new Request(`${origin}/api/operations?section=${section}`)));
const create=async(who)=>{
 const r=await act(who,{action:'saveTemplate',name:'Synthetic reversible checklist',kind:'Onboarding',steps:[{title:'Synthetic step',assignee:'employee',offset:0}]});
 assert.equal(r.status,200);return (await r.json()).id;
};
const rows=table=>f.rows(`SELECT * FROM ${table} ORDER BY id`);
const snapshot=()=>JSON.stringify(Object.fromEntries(['workflow_templates','workflow_runs','tasks','audit'].map(t=>[t,rows(t)])));
function disableFixtureScopeTriggers(){for(const {name}of f.rows("SELECT name FROM sqlite_master WHERE type='trigger' AND sql LIKE '%data_scope%'"))f.run(`DROP TRIGGER "${name.replaceAll('"','""')}"`)}
async function atWrite(start,change){
 const prepare=f.env.DB.prepare;let hit=false;
 f.env.DB.prepare=sql=>{const statement=prepare(sql);if(/^UPDATE workflow_templates/.test(sql)){const run=statement.run;statement.run=async()=>{if(!hit){hit=true;await change()}return run()}}return statement};
 try{const result=await start();assert.ok(hit);return result}finally{f.env.DB.prepare=prepare}
}
for(const scope of scopes){
 test(`${scope}: archive and restore preserve complete existing runs/tasks and control new application`,async()=>{
  const u=users[scope],id=await create(u.hr_manager);
  assert.equal((await act(u.hr_manager,{action:'applyTemplate',templateId:id,employeeId:u.employee.id,startDate:'2026-01-05'})).status,200);
  const runs=rows('workflow_runs'),tasks=rows('tasks');
  const archived=await act(u.hr_manager,{action:'archiveTemplate',id});assert.equal(archived.status,200);assert.match((await archived.json()).message,/unchanged/);
  assert.equal(f.get('SELECT active FROM workflow_templates WHERE id=?',id).active,0);
  assert.deepEqual(rows('workflow_runs'),runs);assert.deepEqual(rows('tasks'),tasks);
  const data=await(await state(u.hr_manager,'workflows')).json();
  assert.deepEqual(data.templates,[]);assert.deepEqual(data.archivedTemplates.map(t=>t.id),[id]);assert.equal(data.workflows.length,1);
  const own=await(await state(u.employee,'workflows')).json();assert.equal(own.workflows.length,1);assert.deepEqual(own.templates,[]);assert.deepEqual(own.archivedTemplates,[]);
  for(const body of [{action:'applyTemplate',templateId:id,employeeId:u.employee.id,startDate:'2026-01-05'},{action:'saveTemplate',id,name:'Changed',kind:'Onboarding',steps:[{title:'Changed',assignee:'employee',offset:0}]},{action:'deleteTemplate',id}])assert.ok((await act(u.hr_manager,body)).status>=400);
  assert.deepEqual(rows('workflow_runs'),runs);assert.deepEqual(rows('tasks'),tasks);
  assert.equal((await act(u.admin,{action:'restoreTemplate',id})).status,200);
  assert.equal(f.get('SELECT active FROM workflow_templates WHERE id=?',id).active,1);
  assert.deepEqual(rows('workflow_runs'),runs);assert.deepEqual(rows('tasks'),tasks);
  const restored=await(await state(u.hr_manager,'workflows')).json();assert.deepEqual(restored.templates.map(t=>t.id),[id]);assert.deepEqual(restored.archivedTemplates,[]);
  assert.equal((await act(u.hr_manager,{action:'applyTemplate',templateId:id,employeeId:u.employee.id,startDate:'2026-01-06'})).status,200);
  assert.equal(rows('workflow_runs').length,2);assert.equal(rows('tasks').length,2);
 });
 test(`${scope}: archive/restore reject wrong state, foreign scope, and non-HR roles without audit`,async()=>{
  const u=users[scope],id=await create(u.hr_manager),other=users[scopes.find(s=>s!==scope)],foreign=await create(other.hr_manager);
  await act(other.hr_manager,{action:'archiveTemplate',id:foreign});
  for(const action of ['archiveTemplate','restoreTemplate'])for(const role of ['manager','hiring_manager','employee']){
   const before=snapshot();assert.equal((await act(u[role],{action,id})).status,403);assert.equal(snapshot(),before);
  }
  for(const action of ['archiveTemplate','restoreTemplate']){const before=snapshot();assert.equal((await act(u.hr_manager,{action,id:foreign})).status,404);assert.equal(snapshot(),before)}
  for(const [action,setup]of [['restoreTemplate',false],['archiveTemplate',true]]){
   if(setup)assert.equal((await act(u.hr_manager,{action:'archiveTemplate',id})).status,200);
   const before=snapshot();assert.equal((await act(u.hr_manager,{action,id})).status,404);assert.equal(snapshot(),before);
  }
 });
}
for(const action of ['archiveTemplate','restoreTemplate'])for(const change of ['demotion','deactivation','actor scope','template scope','author scope'])test(`${action}: ${change} at write fails closed`,async()=>{
 const u=users['qa-bots-v1'],id=await create(u.admin);
 if(action==='restoreTemplate')await act(u.admin,{action:'archiveTemplate',id});
 disableFixtureScopeTriggers();f.run('DELETE FROM audit');let changed;
 const response=await atWrite(()=>act(u.hr_manager,{action,id}),()=>{
  if(change==='demotion')f.run("UPDATE employees SET role='employee' WHERE id=?",u.hr_manager.id);
  if(change==='deactivation')f.run('UPDATE employees SET active=0 WHERE id=?',u.hr_manager.id);
  if(change==='actor scope')f.run("UPDATE employees SET data_scope='live' WHERE id=?",u.hr_manager.id);
  if(change==='template scope')f.run("UPDATE workflow_templates SET data_scope='live' WHERE id=?",id);
  if(change==='author scope')f.run("UPDATE employees SET data_scope='live' WHERE id=?",u.admin.id);
  changed=snapshot();
 });
 assert.equal(response.status,404);assert.equal(snapshot(),changed);assert.equal(rows('audit').length,0);
});
for(const action of ['archiveTemplate','restoreTemplate'])test(`${action}: failed audit rolls back availability`,async()=>{
 const actor=users.live.hr_manager,id=await create(actor);if(action==='restoreTemplate')await act(actor,{action:'archiveTemplate',id});
 f.run('DELETE FROM audit');f.run("CREATE TRIGGER archive_audit_failure BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END");
 const before=snapshot();assert.equal((await act(actor,{action,id})).status,500);assert.equal(snapshot(),before);
});
for(const [section,expected,forbidden]of [
 ['workflows',/workflow_templates|workflow_runs/,/FROM assets|FROM announcements|FROM time_entries|FROM document_acknowledgements/],
 ['assets',/FROM assets/,/FROM workflow_templates|FROM workflow_runs|FROM announcements|FROM time_entries|FROM document_acknowledgements/],
 ['news',/FROM announcements/,/FROM workflow_templates|FROM workflow_runs|FROM assets|FROM time_entries|FROM document_acknowledgements/],
 ['time',/FROM time_entries/,/FROM workflow_templates|FROM workflow_runs|FROM assets|FROM announcements|FROM document_acknowledgements/],
])test(`${section}: section read avoids all unrelated operational queries`,async()=>{
 const prepare=f.env.DB.prepare,queries=[];f.env.DB.prepare=sql=>{queries.push(sql);return prepare(sql)};
 try{assert.equal((await state(users.live.hr_manager,section)).status,200);assert.ok(queries.some(sql=>expected.test(sql)));assert.ok(queries.every(sql=>!forbidden.test(sql)))}finally{f.env.DB.prepare=prepare}
});
for(const [section,pattern]of [['workflows',/FROM workflow_runs/],['assets',/FROM assets/],['news',/FROM announcements/],['time',/FROM time_entries/]])test(`${section}: access recheck withholds a section response after role revocation`,async()=>{
 const actor=users.live.hr_manager,prepare=f.env.DB.prepare;let hit=false;
 f.env.DB.prepare=sql=>{const statement=prepare(sql);if(pattern.test(sql)){const all=statement.all;statement.all=async()=>{const result=await all();if(!hit){hit=true;f.run("UPDATE employees SET role='employee' WHERE id=?",actor.id)}return result}}return statement};
 try{const response=await state(actor,section);assert.ok(hit);assert.equal(response.status,403);assert.equal('templates'in await response.json(),false)}finally{f.env.DB.prepare=prepare}
});
test('unknown section is rejected and cannot request a different data scope',async()=>{
 assert.equal((await state(users.live.hr_manager,'other')).status,400);
 assert.equal((await state(null,'workflows')).status,401);
 const id=await create(users['qa-bots-v1'].hr_manager);await act(users['qa-bots-v1'].hr_manager,{action:'archiveTemplate',id});
 const data=await(await state(users.live.hr_manager,'workflows&data_scope=qa-bots-v1')).json();assert.deepEqual(data.archivedTemplates,[]);
});
for(const role of ['admin','hr_manager'])test(`${role}: news acknowledgement applies only to the current HR reader`,async()=>{
 const actor=users.live[role],employee=users.live.employee;
 const r=await act(users.live.hr_manager,{action:'saveAnnouncement',title:'Synthetic company news',body:'Synthetic message',status:'published'});const {id}=await r.json();
 assert.equal((await act(actor,{action:'readAnnouncement',id,employeeId:employee.id})).status,200);
 assert.equal((await act(actor,{action:'readAnnouncement',id})).status,200);
 assert.equal(rows('announcement_reads').length,1);assert.equal(rows('announcement_reads')[0].employee_id,actor.id);
 const own=await(await state(actor,'news')).json(),other=await(await state(employee,'news')).json();
 assert.ok(own.announcements[0].read_at);assert.equal(own.announcements[0].read_count,1);assert.equal(other.announcements[0].read_at,null);assert.equal('read_count'in other.announcements[0],false);
});

test('archived template with a corrupt foreign-scope author is neither visible nor restorable',async()=>{
 const u=users['qa-bots-v1'],id=await create(u.admin);await act(u.hr_manager,{action:'archiveTemplate',id});
 disableFixtureScopeTriggers();f.run('UPDATE workflow_templates SET created_by=? WHERE id=?',users.live.admin.id,id);
 const before=snapshot(),data=await(await state(u.hr_manager,'workflows')).json();assert.deepEqual(data.archivedTemplates,[]);
 assert.equal((await act(u.hr_manager,{action:'restoreTemplate',id})).status,404);assert.equal(snapshot(),before);
});
