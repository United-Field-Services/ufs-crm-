import {beforeEach,afterEach,test} from 'node:test';import assert from 'node:assert/strict';
import {fixture,asUser,jsonRequest} from './harness.mjs';
const {handleCurrentHistoryImport}=await import('../lib/current-history-import-handler.ts');
const importer=await import('../lib/current-history-import.ts');const {POST}=await import('../app/api/import-current-history/route.ts');
let f,owner,other;
beforeEach(()=>{f=fixture();owner=f.employee('owner',{role:'admin',annual_allowance:42});other=f.employee('other');for(const [id,source] of [[owner.id,'/my-profile'],[other.id,'/people/2']]){f.run('INSERT INTO source_employee_links (source_id,employee_id,source_email,directory_phone,manager_name,source_status,source_employment_type,review_flag,imported_at) VALUES (?,?,?,?,?,?,?,?,?)',source,id,id+'@example.test','','','Full-Time','','','before');f.run('INSERT INTO employee_profiles (employee_id,division,employment_status,personal_email,updated_at) VALUES (?,?,?,?,?)',id,'Present','Active','private@example.test','before');}});
afterEach(()=>f.close());
const payload=()=>({schemaVersion:1,sourceOrigin:'https://unitedffs.talenthr.io',extractedAt:'2026-10-11T21:00:00Z',employees:[{sourceId:'/my-profile',history:[{kind:'status',effectiveDate:'2020-01-01',sourceOrder:0,status:'Full-Time'},{kind:'job',effectiveDate:'2020-01-01',sourceOrder:0,title:'Historical title',department:'Historical department',division:'Historical division',location:'Historical work location',employmentType:'Remote'}]},{sourceId:'/people/2',history:[{kind:'status',effectiveDate:'2022-01-01',sourceOrder:0,status:'Part-Time'},{kind:'manager',effectiveDate:'2022-01-01',sourceOrder:0,managerName:'Owner',managerSourceId:'/my-profile'}]}]});
const digest=p=>importer.currentHistoryDigest(importer.validateCurrentHistoryImport(p));
const request=(body,pin,who=owner,headers)=>asUser(who,()=>handleCurrentHistoryImport(jsonRequest(body,headers),pin));
async function apply(p=payload(),who=owner){const pin=await digest(p);return request({action:'apply',payload:p,expectedDigest:pin},pin,who);}
test('completed current-history route is unconditionally closed with HTTP410',async()=>{const r=await asUser(null,()=>POST(jsonRequest({action:'preview',payload:payload()})));assert.equal(r.status,410);});
test('current history preview is read-only, then append preserves all current profile/link/account values',async()=>{
 const original={employees:f.rows('SELECT * FROM employees'),profiles:f.rows('SELECT * FROM employee_profiles'),links:f.rows('SELECT * FROM source_employee_links')};const p=payload(),pin=await digest(p);
 const preview=await request({action:'preview',payload:p},pin);assert.equal(preview.status,200);assert.equal((await preview.json()).counts.historyRows,4);assert.equal(f.get('SELECT COUNT(*) n FROM employment_history').n,0);
 const r=await apply(p);assert.equal(r.status,200,await r.clone().text());assert.equal(f.get('SELECT COUNT(*) n FROM employment_history').n,4);
 assert.deepEqual(f.rows('SELECT * FROM employees'),original.employees);assert.deepEqual(f.rows('SELECT * FROM employee_profiles'),original.profiles);assert.deepEqual(f.rows('SELECT * FROM source_employee_links'),original.links);
 const job=f.rows('SELECT snapshot FROM employment_history').map(r=>JSON.parse(r.snapshot)).find(s=>s.source_kind==='job');assert.equal(job.title,'Historical title');assert.equal(f.get('SELECT title FROM employees WHERE id=?',owner.id).title,owner.title);
});
test('current history uses its own immutable ledger and exact replay',async()=>{
 const p=payload();assert.equal((await apply(p)).status,200);const r=await (await apply(p)).json();assert.equal(r.replayed,true);assert.equal(f.get('SELECT id FROM migration_batches').id,'talenthr-current-history-v1');assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,1);
 p.employees[0].history[1].title='Changed';assert.equal((await apply(p)).status,409);
});
test('unknown and sensitive fields cannot enter sparse current history',async()=>{
 const pin=await digest(payload());for(const patch of [p=>p.employees[0].name='unexpected',p=>p.employees[0].history[0].reason='private',p=>p.employees[0].history[0].ssn='private',p=>p.employees[0].history[1].compensation=100,p=>p.employees[1].history[1].manager_id='owner',p=>p.extra='unexpected']){const p=payload();patch(p);assert.equal((await request({action:'preview',payload:p},pin)).status,400);}assert.equal(f.get('SELECT COUNT(*) n FROM migration_batches').n,0);
});
test('source row identity date and current employment evidence are mandatory',async()=>{
 const pin=await digest(payload());for(const patch of [p=>p.employees[0].sourceId='/unknown',p=>p.employees[1].sourceId='/my-profile',p=>p.employees[0].history[0].status='Terminated',p=>p.employees[0].history[0].effectiveDate='2027-01-01',p=>p.employees[0].history.push(p.employees[0].history[0]),p=>p.employees[1].history[1].managerSourceId='/people/2']){const p=payload();patch(p);assert.equal((await request({action:'preview',payload:p},pin)).status,400);}
});
test('missing former or unresolved source targets fail without creating profiles',async()=>{
 let p=payload();p.employees[0].sourceId='/people/999';assert.equal((await apply(p)).status,409);
 p=payload();p.employees[1].history[1].managerSourceId='/people/999';assert.equal((await apply(p)).status,409);
 f.run('UPDATE employee_profiles SET employment_status=? WHERE employee_id=?','Terminated',other.id);assert.equal((await apply()).status,409);assert.equal(f.get('SELECT COUNT(*) n FROM employees').n,2);
});
test('pre-existing source history is not overwritten or duplicated',async()=>{
 f.run('INSERT INTO employment_history (id,employee_id,effective_date,reason,snapshot,created_by,created_at) VALUES (?,?,?,?,?,?,?)','talenthr-history:my-profile:status:0',owner.id,'2000-01-01','Unchanged','{}',owner.id,'before');
 assert.equal((await apply()).status,409);assert.equal(f.get('SELECT reason FROM employment_history').reason,'Unchanged');assert.equal(f.get('SELECT COUNT(*) n FROM migration_batches').n,0);
});
test('fixed endpoint pin and supplied reviewed digest both reject changed data',async()=>{
 const p=payload(),pin=await digest(p);p.employees[0].history[1].title='Changed';assert.equal((await request({action:'preview',payload:p},pin)).status,409);
 assert.equal((await request({action:'apply',payload:p,expectedDigest:pin},await digest(p))).status,409);assert.equal((await request({action:'preview',payload:payload()},'')).status,410);
});
test('authorization cannot fall back to service mode for present visitor identities',async()=>{
 const p=payload(),pin=await digest(p);for(const role of ['employee','manager','hr_manager','hiring_manager']){f.run('UPDATE employees SET role=? WHERE id=?',role,other.id);assert.equal((await request({action:'preview',payload:p},pin,other)).status,403);}
 f.run('UPDATE employees SET active=0 WHERE id=?',owner.id);assert.equal((await request({action:'preview',payload:p},pin,owner)).status,403);
 for(const key of ['oai-authenticated-user-id','oai-authenticated-user-email']){const r=await globalThis.__ufsSecurityTest.context.run(new Headers({[key]:'partial'}),()=>handleCurrentHistoryImport(jsonRequest({action:'preview',payload:p}),pin));assert.equal(r.status,401);}
});
test('CSRF and oversized bodies fail; documented private service path remains scoped',async()=>{
 const p=payload(),pin=await digest(p);assert.equal((await request({action:'preview',payload:p},pin,owner,{Origin:'https://evil.test'})).status,403);assert.equal((await request({action:'preview',payload:p},pin,null,{'Sec-Fetch-Site':'cross-site'})).status,403);assert.equal((await request({action:'preview',payload:{huge:'x'.repeat(256001)}},pin)).status,413);
 assert.equal((await apply(p,null)).status,200);assert.equal(f.get('SELECT actor_id FROM audit').actor_id,'site-owner-service');
});
test('transaction failure rolls back the entire history batch and ledger',async()=>{
 f.run("CREATE TRIGGER reject_current_history BEFORE INSERT ON employment_history WHEN NEW.employee_id='other' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");const r=await apply();assert.equal(r.status,409);assert.equal(f.get('SELECT COUNT(*) n FROM employment_history').n,0);assert.equal(f.get('SELECT COUNT(*) n FROM migration_batches').n,0);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);
});
test('concurrent matching history imports append each dated row exactly once',async()=>{
 const p=payload();const responses=await Promise.all([apply(p),apply(p)]);assert.ok(responses.every(r=>r.status===200));const results=await Promise.all(responses.map(r=>r.json()));assert.equal(results.filter(r=>!r.replayed).length,1);assert.equal(f.get('SELECT COUNT(*) n FROM employment_history').n,4);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,1);
});
