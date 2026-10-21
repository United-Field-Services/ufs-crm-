import {beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,asUser,jsonRequest} from './harness.mjs';
const {handleFormerImport}=await import('../lib/former-import-handler.ts');
const importer=await import('../lib/former-import.ts');
const {POST:closedPOST}=await import('../app/api/import-former/route.ts');
let f,owner,employee;
beforeEach(()=>{
 f=fixture();owner=f.employee('owner',{role:'admin',user_id:'verified-owner',annual_allowance:19,manager_id:'existing-approver'});employee=f.employee('employee');
 f.run('INSERT INTO source_employee_links (source_id,employee_id,source_email,directory_phone,manager_name,source_status,source_employment_type,review_flag,imported_at) VALUES (?,?,?,?,?,?,?,?,?)','/my-profile',owner.id,owner.email,'555-0100','','Full-Time','Remote','','before');
 f.run('INSERT INTO employee_profiles (employee_id,personal_email,birth_date,division,employment_status,updated_at) VALUES (?,?,?,?,?,?)',owner.id,'private@example.test','1980-01-01','Old division','Active','before');
});
afterEach(()=>f.close());
const entry=(n)=>({sourceId:`/people/${n}`,name:`Former Person ${n}`,email:`former${n}@example.test`,phone:'555-0101',title:'Coordinator',department:'Operations',division:'West',location:'California',employmentStatus:'Terminated',employmentCategory:'Full-Time',employmentType:'Remote',hireDate:'2020-01-01',exitDate:'2025-02-01',managerSourceId:'/my-profile',managerName:'Owner',history:[
 {kind:'status',sourceOrder:0,effectiveDate:'2025-02-01',status:'Terminated'},
 {kind:'status',sourceOrder:1,effectiveDate:'2020-01-01',status:'Full-Time'},
 {kind:'manager',sourceOrder:0,effectiveDate:'2020-01-01',managerName:'Owner',managerSourceId:'/my-profile'},
 {kind:'job',sourceOrder:0,effectiveDate:'2023-01-01',title:'Coordinator',employmentType:'Remote',location:'California',division:'West',department:'Operations'},
 {kind:'job',sourceOrder:1,effectiveDate:'2023-01-01',title:'Assistant',employmentType:'Remote',location:'',division:'West',department:'Operations'}
]});
const payload=()=>({schemaVersion:1,sourceOrigin:'https://unitedffs.talenthr.io',extractedAt:'2026-10-11T21:00:00Z',employees:[entry(71),entry(72)]});
const digest=p=>importer.formerDigest(importer.validateFormerImport(p));
const request=async(who,body,headers,pinned)=>asUser(who,()=>handleFormerImport(jsonRequest(body,headers),pinned));
async function preview(p=payload(),who=owner,pinned){const r=await request(who,{action:'preview',payload:p},undefined,pinned??await digest(p));assert.equal(r.status,200,await r.clone().text());return r.json();}
async function apply(p=payload(),who=owner){const pin=await digest(p),v=await preview(p,who,pin);return request(who,{action:'apply',payload:p,expectedDigest:v.digest},undefined,pin);}

test('the completed former importer is unconditionally closed with HTTP410',async()=>{
 const r=await asUser(null,()=>closedPOST(jsonRequest({action:'preview',payload:payload()})));
 assert.equal(r.status,410);
});
test('preview preserves database and existing current records',async()=>{
 const before=f.get('SELECT * FROM employees WHERE id=?',owner.id),p=await preview();
 assert.equal(p.counts.employees,2);assert.equal(p.counts.historyRows,10);assert.equal(p.counts.disabledAccess,2);
 assert.equal(f.get('SELECT COUNT(*) n FROM migration_batches').n,0);assert.equal(f.get('SELECT COUNT(*) n FROM employment_history').n,0);
 assert.deepEqual(f.get('SELECT * FROM employees WHERE id=?',owner.id),before);
});
test('all new former profiles are disabled ordinary members with explicit lifecycle and exit dates',async()=>{
 const before=f.get('SELECT * FROM employees WHERE id=?',owner.id),profile=f.get('SELECT * FROM employee_profiles WHERE employee_id=?',owner.id),link=f.get('SELECT * FROM source_employee_links WHERE employee_id=?',owner.id);
 f.leave('preserve-request',owner.id,{status:'approved'});
 const r=await apply();assert.equal(r.status,200,await r.clone().text());
 for(const id of ['talenthr:people:71','talenthr:people:72']){
  const e=f.get('SELECT * FROM employees WHERE id=?',id),p=f.get('SELECT * FROM employee_profiles WHERE employee_id=?',id),s=f.get('SELECT * FROM source_employee_links WHERE employee_id=?',id);
  assert.equal(e.active,0);assert.equal(e.user_id,null);assert.equal(e.manager_id,null);assert.equal(e.role,'employee');assert.equal(e.demo,0);assert.equal(e.employment,'Full-Time');
  assert.equal(p.employment_status,'Terminated');assert.equal(p.exit_date,'2025-02-01');assert.equal(p.exit_reason,'');assert.equal(p.personal_email,'');assert.equal(s.source_status,'Terminated');assert.equal(s.manager_source_id,'/my-profile');
 }
 assert.deepEqual(f.get('SELECT * FROM employees WHERE id=?',owner.id),before);assert.deepEqual(f.get('SELECT * FROM employee_profiles WHERE employee_id=?',owner.id),profile);assert.deepEqual(f.get('SELECT * FROM source_employee_links WHERE employee_id=?',owner.id),link);
 assert.equal(f.get('SELECT status FROM leave_requests').status,'approved');assert.equal(f.get('SELECT COUNT(*) n FROM employees').n,4);assert.equal(f.get('SELECT COUNT(*) n FROM source_employee_links').n,3);
});
test('dated source histories remain sparse, preserve same-day rows, and never grant approval metadata',async()=>{
 assert.equal((await apply()).status,200);const rows=f.rows('SELECT * FROM employment_history WHERE employee_id=? ORDER BY id','talenthr:people:71');assert.equal(rows.length,5);
 const jobRows=rows.filter(r=>JSON.parse(r.snapshot).source_kind==='job');assert.equal(jobRows.length,2);assert.equal(jobRows[0].effective_date,jobRows[1].effective_date);assert.notEqual(jobRows[0].id,jobRows[1].id);
 const manager=JSON.parse(rows.find(r=>JSON.parse(r.snapshot).source_kind==='manager').snapshot);assert.equal(manager.source_manager_name,'Owner');assert.equal(manager.source_manager_id,'/my-profile');assert.equal(manager.manager_id,undefined);assert.equal(manager.title,undefined);
 const status=rows.map(r=>JSON.parse(r.snapshot)).find(s=>s.source_employment_category);assert.equal(status.source_employment_category,'Full-Time');assert.equal(status.employment,'Full-Time');assert.equal(status.employment_status,undefined);
});
test('fixed pin and reviewed digest both bind the exact snapshot',async()=>{
 const p=payload(),pin=await digest(p),v=await preview(p);p.employees[0].title='Changed';
 assert.equal((await request(owner,{action:'preview',payload:p},undefined,pin)).status,409);
 assert.equal((await request(owner,{action:'apply',payload:p,expectedDigest:v.digest},undefined,await digest(p))).status,409);
 assert.equal((await request(owner,{action:'preview',payload:payload()},undefined,'')).status,410);assert.equal(f.get('SELECT COUNT(*) n FROM migration_batches').n,0);
});
test('former transfer is once-only and exact replay performs no writes',async()=>{
 const p=payload(),r=await apply(p),first=await r.json();const again=await (await apply(p)).json();assert.equal(again.replayed,true);assert.equal(again.importedAt,first.importedAt);assert.deepEqual(again.counts,first.counts);
 assert.equal(f.get('SELECT COUNT(*) n FROM employment_history').n,10);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,1);assert.equal(f.get('SELECT COUNT(*) n FROM migration_batches').n,1);
 p.employees[0].title='Different';assert.equal((await request(owner,{action:'preview',payload:p},undefined,await digest(p))).status,409);
});
test('unknown fields and sensitive nested history fields are rejected rather than ignored',async()=>{
 const pin=await digest(payload());
 for(const key of ['role','active','user_id','manager_id','personalEmail','ssn','compensation','exitReason','medical','annualAllowance']){const p=payload();p.employees[0][key]='unapproved';assert.equal((await request(owner,{action:'preview',payload:p},undefined,pin)).status,400);}
 for(const patch of [p=>p.extra='bad',p=>p.employees[0].history[0].reason='bad',p=>p.employees[0].history[1].ssn='bad',p=>p.employees[0].history[2].title='Wrong kind',p=>p.employees[0].history[3].status='Terminated']){const p=payload();patch(p);assert.equal((await request(owner,{action:'preview',payload:p},undefined,pin)).status,400);}
 assert.equal(f.get('SELECT COUNT(*) n FROM migration_batches').n,0);
});
test('duplicates, lifecycle ambiguity, inconsistent departure and malformed history block the whole payload',async()=>{
 const pin=await digest(payload());
 for(const patch of [p=>p.employees[1].email=p.employees[0].email,p=>p.employees[1].sourceId=p.employees[0].sourceId,p=>p.employees[0].sourceId='/my-profile',p=>p.employees[0].employmentStatus='Active',p=>p.employees[0].exitDate='2019-01-01',p=>p.employees[0].exitDate='2027-01-01',p=>p.employees[0].exitDate='2025-02-02',p=>p.employees[0].history[0].status='Full-Time',p=>p.employees[0].employmentCategory='Part-Time',p=>p.employees[0].history.push(p.employees[0].history[0]),p=>p.employees[0].history[0].sourceOrder=-1,p=>p.employees[0].managerSourceId='/people/71',p=>p.employees[0].history[2].managerSourceId='/people/71']){const p=payload();patch(p);assert.equal((await request(owner,{action:'preview',payload:p},undefined,pin)).status,400);}
});
test('existing source mappings or case-insensitive email conflicts never overwrite records',async()=>{
 for(const patch of [p=>p.employees[0].email=owner.email.toUpperCase(),p=>p.employees[0].email=employee.email]){const p=payload();patch(p);assert.equal((await request(owner,{action:'preview',payload:p},undefined,await digest(p))).status,409);}
 f.run('INSERT INTO source_employee_links (source_id,employee_id,source_email,directory_phone,manager_name,source_status,source_employment_type,review_flag,imported_at) VALUES (?,?,?,?,?,?,?,?,?)','/people/71',employee.id,employee.email,'','','Full-Time','','','before');
 assert.equal((await request(owner,{action:'preview',payload:payload()},undefined,await digest(payload()))).status,409);assert.equal(f.get('SELECT COUNT(*) n FROM migration_batches').n,0);
});
test('manager provenance supports current and former source links but rejects unknown IDs and cycles',async()=>{
 const p=payload();p.employees[1].managerSourceId='/people/71';p.employees[1].managerName='Former Person 71';assert.equal((await apply(p)).status,200);assert.equal(f.get('SELECT manager_id FROM employees WHERE id=?','talenthr:people:72').manager_id,null);
});
test('unknown and cyclic manager metadata is rejected before writes',async()=>{
 for(const patch of [p=>p.employees[0].managerSourceId='/people/999',p=>p.employees[0].history[2].managerSourceId='/people/999',p=>{p.employees[0].managerSourceId='/people/72';p.employees[1].managerSourceId='/people/71';}]){const p=payload();patch(p);assert.equal((await request(owner,{action:'preview',payload:p},undefined,await digest(p))).status,400);}
 assert.equal(f.get('SELECT COUNT(*) n FROM migration_batches').n,0);
});
test('signed-in non-admin, unknown and inactive callers cannot use service fallback',async()=>{
 const p=payload(),pin=await digest(p);
 for(const role of ['employee','manager','hr_manager','hiring_manager']){f.run('UPDATE employees SET role=? WHERE id=?',role,employee.id);assert.equal((await request(employee,{action:'preview',payload:p},undefined,pin)).status,403);}
 assert.equal((await request({userId:'unknown',email:'unknown@example.test'},{action:'preview',payload:p},undefined,pin)).status,403);
 f.run('UPDATE employees SET active=0 WHERE id=?',owner.id);assert.equal((await request(owner,{action:'preview',payload:p},undefined,pin)).status,403);
});
test('partial identity, visitor CSRF, and cross-site service calls fail closed',async()=>{
 const p=payload(),pin=await digest(p);
 for(const key of ['oai-authenticated-user-id','oai-authenticated-user-email']){const r=await globalThis.__ufsSecurityTest.context.run(new Headers({[key]:'partial'}),()=>handleFormerImport(jsonRequest({action:'preview',payload:p}),pin));assert.equal(r.status,401);}
 assert.equal((await request(owner,{action:'preview',payload:p},{Origin:'https://evil.test'},pin)).status,403);
 assert.equal((await request(null,{action:'preview',payload:p},{'Sec-Fetch-Site':'cross-site'},pin)).status,403);
});
test('only the approved private-Site service path uses the service actor',async()=>{
 assert.equal((await apply(payload(),null)).status,200);assert.equal(f.get('SELECT actor_id FROM audit').actor_id,'site-owner-service');
});
test('atomic batch failure leaves the existing roster and all new tables unchanged',async()=>{
 f.run("CREATE TRIGGER reject_history BEFORE INSERT ON employment_history WHEN NEW.employee_id='talenthr:people:72' BEGIN SELECT RAISE(ABORT,'synthetic conflict'); END");
 const r=await apply();assert.equal(r.status,409);assert.equal(f.get('SELECT COUNT(*) n FROM employees').n,2);assert.equal(f.get('SELECT COUNT(*) n FROM source_employee_links').n,1);assert.equal(f.get('SELECT COUNT(*) n FROM employment_history').n,0);assert.equal(f.get('SELECT COUNT(*) n FROM migration_batches').n,0);
});
test('concurrent identical import creates one ledger, one audit, and no duplicates',async()=>{
 const p=payload(),pin=await digest(p);const results=await Promise.all([request(owner,{action:'apply',payload:p,expectedDigest:pin},undefined,pin),request(owner,{action:'apply',payload:p,expectedDigest:pin},undefined,pin)]);
 assert.ok(results.every(r=>r.status===200));const values=await Promise.all(results.map(r=>r.json()));assert.equal(values.filter(r=>!r.replayed).length,1);assert.equal(f.get('SELECT COUNT(*) n FROM employment_history').n,10);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,1);
});
test('concurrent different approved snapshots never mix into a partial transfer',async()=>{
 const p=payload(),q=payload();q.employees[0].title='Alternate';const a=await digest(p),b=await digest(q);
 const results=await Promise.all([request(owner,{action:'apply',payload:p,expectedDigest:a},undefined,a),request(owner,{action:'apply',payload:q,expectedDigest:b},undefined,b)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.get('SELECT COUNT(*) n FROM employees').n,4);assert.equal(f.get('SELECT COUNT(*) n FROM employment_history').n,10);
});
test('streamed request body limit and request envelope allowlist are enforced',async()=>{
 const pin=await digest(payload());assert.equal((await request(owner,{action:'preview',payload:{huge:'x'.repeat(256001)}},undefined,pin)).status,413);
 assert.equal((await request(owner,{action:'preview',payload:payload(),extra:true},undefined,pin)).status,400);
});
test('former profile can never bind a real sign-in through imported email',async()=>{
 assert.equal((await apply()).status,200);const {currentEmployee}=await import('../lib/server.ts');
 await assert.rejects(()=>asUser({userId:'new-verified-user',email:'former71@example.test'},()=>currentEmployee()),/review access/);
 assert.equal(f.get('SELECT user_id FROM employees WHERE id=?','talenthr:people:71').user_id,null);
});
