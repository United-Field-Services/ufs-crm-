// All people, histories, photos and identities in this suite are synthetic SQLite fixtures.
import {beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,asUser,origin} from './harness.mjs';
const {GET}=await import('../app/api/headcount-roster/route.ts');
const {getHeadcountSnapshot}=await import('../lib/hr-report.ts');
const QA='qa-bots-v1',stamp='2026-10-11T00:00:00Z';
let f,hr,nextSource;
beforeEach(()=>{f=fixture();hr=f.employee('reader',{role:'hr_manager'});nextSource=100;});
afterEach(()=>f.close());
const request=(actor=hr,query='month=2026-09')=>asUser(actor,()=>GET(new Request(`${origin}/api/headcount-roster?${query}`)));
async function result(month='2026-09',actor=hr){const r=await request(actor,`month=${month}`);assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get('cache-control'),'no-store');return r.json();}
function person(id,overrides={}){
 const {source_status='Full-Time',...employee}=overrides;
 const row=f.employee(id,{active:0,user_id:null,title:'CURRENT_ONLY_TITLE',department:'CURRENT_ONLY_DEPARTMENT',hire_date:'2020-01-01',...employee});
 const sourceId=`/people/${nextSource++}`;
 f.run('INSERT INTO source_employee_links (source_id,employee_id,source_email,source_status,imported_at) VALUES (?,?,?,?,?)',sourceId,id,`${id}@example.test`,source_status,stamp);
 return {...row,sourceId};
}
function history(employee,kind,date,order,values={},overrides={}){
 const row={id:'talenthr-history:'+employee.sourceId.slice(1).replaceAll('/',':')+':'+kind+':'+order,employee_id:employee.id,effective_date:date,reason:'Synthetic imported source history',snapshot:JSON.stringify({source_kind:kind,source_record:employee.sourceId,source_order:order,...values}),created_by:hr.id,created_at:stamp,...overrides};
 f.run(`INSERT INTO employment_history (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`,...Object.values(row));return row;
}
const status=(employee,date,order=0,category='Full-Time',overrides={})=>history(employee,'status',date,order,category==='Terminated'?{employment_status:'Terminated',exit_date:date}:{employment:category,source_employment_category:category},overrides);
const job=(employee,date,order=0,values={},overrides={})=>history(employee,'job',date,order,{title:'Historical title',department:'Historical department',division:'Historical division',location:'Historical location',work_arrangement:'Remote',...values},overrides);
function photo(employee,overrides={}){const row={employee_id:employee.id,object_key:`photos/${employee.id}`,mime:'image/png',size:12,sha256:'a'.repeat(64),source_id:employee.sourceId||'synthetic',imported_at:stamp,...overrides};f.run(`INSERT INTO employee_photos (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`,...Object.values(row));}

for(const scope of ['live',QA])for(const role of ['admin','hr_manager','manager','hiring_manager','employee'])test(`headcount roster is HR-only for ${scope} ${role}`,async()=>{
 const actor=f.employee(`actor-${scope}-${role}`,{role,data_scope:scope});
 const month=scope==='live'?'2026-09':new Date().toISOString().slice(0,7);
 const r=await request(actor,`month=${month}`);assert.equal(r.status,['admin','hr_manager'].includes(role)?200:403);
 if(r.status!==200){const text=await r.text();assert.ok(!text.includes('supportedCount'));assert.ok(!text.includes('TalentHR'));}
});
test('anonymous, unknown, disabled, demo and former sessions never receive a roster',async()=>{
 assert.equal((await request(null)).status,401);
 assert.equal((await request({user_id:'unknown',email:'unknown@example.test'})).status,403);
 for(const change of ["active=0","active=1,demo=1"]){f.run(`UPDATE employees SET ${change} WHERE id=?`,hr.id);assert.equal((await request()).status,403);}
 f.run('UPDATE employees SET demo=0 WHERE id=?',hr.id);
 f.run('INSERT INTO employee_profiles (employee_id,employment_status,updated_at) VALUES (?,?,?)',hr.id,'Terminated',stamp);
 assert.equal((await request()).status,403);
});
test('month is a single strict snapshot month and caller-controlled filters/scopes are rejected',async()=>{
 for(const query of ['', 'month=', 'month=2026-13','month=2026-9','month=2026-09-01','month=2025-09','month=2026-11','month=2026-09&month=2026-09','month=2026-09&scope=qa-bots-v1','month=2026-09&employee_id=other','month=2026-09&demo=true'])assert.equal((await request(hr,query)).status,400,query);
});
test('every advertised live month is accepted and October is capped at verification',async()=>{
 const employee=person('supported');status(employee,'2020-01-01');
 for(const point of getHeadcountSnapshot(hr).rows){const data=await result(point.month);assert.equal(data.reportedCount,point.value);assert.equal(data.label,point.label);assert.equal(data.rows[0].id,employee.id);assert.equal(data.asOf,point.month==='2026-10'?'2026-10-11':new Date(Date.UTC(Number(point.month.slice(0,4)),Number(point.month.slice(5)),0)).toISOString().slice(0,10));}
});
test('current staff, hire dates, current source flags and local edits never substitute for missing source status history',async()=>{
 const noHistory=person('current-no-history',{active:1}),future=person('first-status-after-month',{active:1}),local=person('local-only',{active:1});
 status(future,'2026-10-01');
 history(local,'status','2020-01-01',0,{employment:'Full-Time',source_employment_category:'Full-Time'},{id:'local-employment-edit'});
 f.employee('unlinked-current',{active:1,hire_date:'2000-01-01'});
 const data=await result();assert.deepEqual(data.rows,[]);assert.equal(data.reconciliation,'unavailable');assert.equal(data.reportedCount,26);assert.equal(data.supportedCount,0);assert.ok(noHistory.active);
});
test('termination and rehire are evaluated at each period without enabling the account',async()=>{
 const employee=person('lifecycle',{source_status:'Terminated'});status(employee,'2025-10-01',3);status(employee,'2026-03-01',2,'Terminated');status(employee,'2026-07-01',1,'Part-Time');status(employee,'2026-10-12',0,'Terminated');
 assert.deepEqual((await result('2025-10')).rows.map(row=>row.id),[employee.id]);
 assert.equal((await result('2026-02')).supportedCount,1);assert.equal((await result('2026-03')).supportedCount,0);assert.equal((await result('2026-06')).supportedCount,0);
 assert.equal((await result('2026-07')).rows[0].employment,'Part-Time');assert.equal((await result('2026-10')).supportedCount,1);
 assert.equal(f.get('SELECT active FROM employees WHERE id=?',employee.id).active,0);
});
test('status becoming active or terminated on month-end takes effect for that bar',async()=>{
 const joined=person('month-end-hire'),left=person('month-end-exit');status(joined,'2026-09-30');status(left,'2025-01-01',1);status(left,'2026-09-30',0,'Terminated');
 const data=await result();assert.deepEqual(data.rows.map(row=>row.id),[joined.id]);
});
test('a source status from after the snapshot cutoff cannot establish membership',async()=>{
 const employee=person('after-cutoff',{active:1});status(employee,'2026-10-12');assert.equal((await result('2026-10')).supportedCount,0);
});
test('former employees with supported history are included and demo or unlinked records are excluded',async()=>{
 const former=person('former',{source_status:'Terminated'}),demo=person('demo',{demo:1});status(former,'2020-01-01',1);status(former,'2026-09-01',0,'Terminated');status(demo,'2020-01-01');
 const unlinked=f.employee('unlinked',{active:1});status({...unlinked,sourceId:'/people/999'},'2020-01-01');
 assert.deepEqual((await result('2026-08')).rows.map(row=>row.id),[former.id]);
});
test('live data ignores scoped synthetic histories and synthetic people',async()=>{
 const live=person('live-supported');status(live,'2020-01-01');
 const qa=f.employee('qa-marker',{data_scope:QA,name:'QA_PRIVATE_MARKER'});
 history({...qa,sourceId:'/people/999'},'status','2020-01-01',0,{employment:'Full-Time',source_employment_category:'Full-Time'},{data_scope:QA,created_by:qa.id});
 const data=await result();assert.deepEqual(data.rows.map(row=>row.id),[live.id]);assert.ok(!JSON.stringify(data).includes('QA_PRIVATE_MARKER'));
});
test('matching source link provenance and canonical imported row identity are mandatory',async()=>{
 for(const [id,patch] of [['wrong-source',{source_record:'/people/999'}],['wrong-order',{source_order:50}],['unknown-status',{employment:'Active',source_employment_category:'Active'}]]){const employee=person(id);history(employee,'status','2020-01-01',0,{employment:'Full-Time',source_employment_category:'Full-Time',...patch});}
 const forged=person('forged-id');status(forged,'2020-01-01',0,'Full-Time',{id:'talenthr-history:people:999:status:0'});
 assert.equal((await result()).supportedCount,0);
});
test('conflicting same-day status rows are unknown regardless of source order',async()=>{
 for(const first of ['Full-Time','Terminated']){const employee=person(`tied-${first}`);status(employee,'2025-01-01',2);status(employee,'2026-09-01',0,first);status(employee,'2026-09-01',1,first==='Terminated'?'Full-Time':'Terminated');}
 assert.equal((await result()).supportedCount,0);
});
test('identical same-day status evidence is not double counted',async()=>{
 const employee=person('same-status');status(employee,'2026-01-01',0);status(employee,'2026-01-01',1);assert.equal((await result()).supportedCount,1);
});
test('malformed status JSON, non-object data, invalid dates and unexpected status fields fail closed',async()=>{
 for(const [id,override] of [['broken-json',{snapshot:'{'}],['array',{snapshot:'[]'}],['bad-date',{effective_date:'2026-02-30'}],['unplaced-date',{effective_date:'not-a-date'}],['unknown-field',{snapshot:JSON.stringify({source_kind:'status',source_record:'/people/104',source_order:0,employment:'Full-Time',source_employment_category:'Full-Time',private_note:'NEVER_RETURN_THIS'})}]]){const employee=person(id);status(employee,'2020-01-01',1);status(employee,'2026-09-01',0,'Full-Time',override);}
 const data=await result();assert.equal(data.supportedCount,0);assert.ok(!JSON.stringify(data).includes('NEVER_RETURN_THIS'));
});
test('corruption after the requested date does not erase earlier dated status evidence',async()=>{
 const employee=person('later-corruption');status(employee,'2020-01-01',1);status(employee,'2026-09-01',0,'Full-Time',{snapshot:'{'});
 assert.equal((await result('2026-08')).supportedCount,1);assert.equal((await result()).supportedCount,0);
});
test('an unambiguous later status restores support after a dated corrupt status',async()=>{
 const employee=person('restored-evidence');status(employee,'2020-01-01',2);status(employee,'2026-07-01',1,'Full-Time',{snapshot:'{'});status(employee,'2026-09-01',0);
 assert.equal((await result('2026-08')).supportedCount,0);assert.equal((await result()).supportedCount,1);
});
test('historical job fields come only from source snapshots and identity/photo metadata is labeled current',async()=>{
 const employee=person('historic-job');status(employee,'2020-01-01');job(employee,'2025-01-01',1);job(employee,'2026-10-01',0,{title:'Later title'});photo(employee);
 const data=await result(),row=data.rows[0];assert.equal(row.title,'Historical title');assert.equal(row.department,'Historical department');assert.equal(row.jobAsOf,'2025-01-01');assert.equal(row.jobEvidence,'historical');assert.equal(row.identityEvidence,'current_profile');assert.equal(row.has_photo,true);assert.equal(row.photo_version,'a'.repeat(64));assert.ok(!JSON.stringify(data).includes('CURRENT_ONLY'));
 assert.equal((await result('2026-10')).rows[0].title,'Later title');
});
test('missing, later, conflicting and corrupt job snapshots stay explicitly unknown',async()=>{
 for(const id of ['missing','later','conflicting','corrupt']){const employee=person(id);status(employee,'2020-01-01');if(id==='later')job(employee,'2026-10-01');if(id==='conflicting'){job(employee,'2026-01-01',0);job(employee,'2026-01-01',1,{title:'Different title'});}if(id==='corrupt')job(employee,'2026-01-01',0,{}, {snapshot:'{'});}
 const data=await result();assert.equal(data.supportedCount,4);for(const row of data.rows){assert.equal(row.title,null);assert.equal(row.department,null);assert.equal(row.jobAsOf,null);assert.equal(row.jobEvidence,'unknown');assert.equal(row.employment,'Full-Time');}
});
test('a rehire does not inherit a historical job from the previous employment stint',async()=>{
 const employee=person('rehired-job');status(employee,'2020-01-01',2);status(employee,'2026-03-01',1,'Terminated');status(employee,'2026-07-01',0);job(employee,'2020-01-01',1);
 assert.equal((await result('2026-02')).rows[0].jobEvidence,'historical');assert.equal((await result('2026-07')).rows[0].jobEvidence,'unknown');job(employee,'2026-08-01',0,{title:'Rehire title'});assert.equal((await result('2026-08')).rows[0].title,'Rehire title');
});
test('private profile data, raw history, storage keys and account identifiers are never returned',async()=>{
 const employee=person('private-data');status(employee,'2020-01-01');job(employee,'2020-01-01');photo(employee);
 f.run('INSERT INTO employee_profiles (employee_id,personal_email,bio,updated_at) VALUES (?,?,?,?)',employee.id,'PRIVATE_EMAIL@example.test','PRIVATE_BIO',stamp);
 f.run('INSERT INTO compensation_records (id,employee_id,amount,currency,frequency,effective_date,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)','private-pay',employee.id,999999,'USD','Annual','2020-01-01','PRIVATE_COMPENSATION',hr.id,stamp);
 const data=await result(),text=JSON.stringify(data);for(const field of ['email','user_id','snapshot','source_id','source_record','effective_date','created_by','object_key','reason','amount','bio'])assert.ok(!Object.hasOwn(data.rows[0],field),field);for(const secret of ['PRIVATE_EMAIL','PRIVATE_BIO','PRIVATE_COMPENSATION','photos/private-data','example.test'])assert.ok(!text.includes(secret),secret);
});
test('partial and excess counts are disclosed rather than trimmed or padded to the report',async()=>{
 const point=getHeadcountSnapshot(hr).rows.find(row=>row.month==='2026-09');
 const one=person('only-one');status(one,'2020-01-01');let data=await result();assert.equal(data.reconciliation,'partial');assert.equal(data.supportedCount,1);
 for(let i=1;i<=point.value;i++){const employee=person(`extra-${i}`);status(employee,'2020-01-01');}
 data=await result();assert.equal(data.reconciliation,'mismatch');assert.equal(data.supportedCount,point.value+1);assert.equal(data.rows.length,point.value+1);
});
test('matching counts explicitly do not certify exact source-bar membership',async()=>{
 const point=getHeadcountSnapshot(hr).rows.find(row=>row.month==='2026-09');for(let i=0;i<point.value;i++){const employee=person(`match-${i}`);status(employee,'2020-01-01');}
 const data=await result();assert.equal(data.reconciliation,'count_match');assert.equal(data.supportedCount,point.value);assert.match(data.note,/Matching counts alone do not prove exact membership/);
});
test('synthetic scope returns the exact current scoped bar roster, including same-scope demos, with explicit synthetic semantics',async()=>{
 const actor=f.employee('qa-hr',{data_scope:QA,role:'hr_manager'}),current=f.employee('qa-current',{data_scope:QA,name:'SYNTHETIC_CURRENT'}),pending=f.employee('qa-pending',{data_scope:QA,active:0});
 f.run('INSERT INTO employee_profiles (employee_id,data_scope,employment_status,updated_at) VALUES (?,?,?,?)',pending.id,QA,'Active',stamp);
 const demo=f.employee('qa-demo',{data_scope:QA,demo:1});const former=f.employee('qa-former',{data_scope:QA});f.run('INSERT INTO employee_profiles (employee_id,data_scope,employment_status,updated_at) VALUES (?,?,?,?)',former.id,QA,'Terminated',stamp);
 const live=person('live-marker',{name:'LIVE_PRIVATE_MARKER'});status(live,'2020-01-01');photo(current,{data_scope:QA,object_key:'test/qa-bots-v1/photos/current'});
 const month=new Date().toISOString().slice(0,7),data=await result(month,actor);assert.deepEqual(data.rows.map(row=>row.id).sort(),[actor.id,current.id,pending.id,demo.id].sort());assert.equal(data.semantics,'synthetic_current_roster');assert.equal(data.sourceLabel,'Synthetic test data');assert.equal(data.reportedCount,4);assert.equal(data.supportedCount,4);assert.ok(data.rows.every(row=>row.jobEvidence==='synthetic_current'));assert.match(data.note,/not a historical source roster/);assert.ok(!JSON.stringify(data).includes('LIVE_PRIVATE_MARKER'));assert.ok(!JSON.stringify(data).includes('TalentHR'));assert.equal((await request(actor,'month=2025-10')).status,400);
 const state=await import('../app/api/state/route.ts'),stateData=await (await asUser(actor,()=>state.GET())).json();assert.equal(data.reportedCount,stateData.headcountSnapshot.rows[0].value);assert.deepEqual(data.rows.map(row=>row.id).sort(),stateData.people.filter(row=>row.directory_active===1).map(row=>row.id).sort());
});
for(const change of ['role','active','user_id','employment'])test(`fresh authorization rejects ${change} revocation after roster reads`,async()=>{
 const employee=person('race-source');status(employee,'2020-01-01');const prepare=f.env.DB.prepare;let changed=false;
 f.env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.includes('h.id AS history_id')){const all=statement.all;statement.all=async()=>{const data=await all();if(!changed){changed=true;if(change==='employment')f.run('INSERT INTO employee_profiles (employee_id,employment_status,updated_at) VALUES (?,?,?)',hr.id,'Terminated',stamp);else f.run(`UPDATE employees SET ${change}=? WHERE id=?`,change==='role'?'employee':change==='active'?0:'revoked-identity',hr.id);}return data;};}return statement;};
 const r=await request();assert.equal(changed,true);assert.equal(r.status,403);assert.ok(!Object.hasOwn(await r.json(),'rows'));
});
test('a concurrent HR-to-admin role change still requires a fresh request',async()=>{
 const prepare=f.env.DB.prepare;f.env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.includes('h.id AS history_id')){const all=statement.all;statement.all=async()=>{const data=await all();f.run('UPDATE employees SET role=? WHERE id=?','admin',hr.id);return data;};}return statement;};assert.equal((await request()).status,403);
});
test('synthetic authorization is also rechecked after current scoped roster reads',async()=>{
 const actor=f.employee('qa-race',{data_scope:QA,role:'hr_manager'}),prepare=f.env.DB.prepare;
 f.env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.includes('p.division,p.work_arrangement,ph.sha256 AS photo_version')){const all=statement.all;statement.all=async()=>{const data=await all();f.run('UPDATE employees SET role=? WHERE id=?','employee',actor.id);return data;};}return statement;};assert.equal((await request(actor,`month=${new Date().toISOString().slice(0,7)}`)).status,403);
});
test('roster reads make no data or storage writes',async()=>{
 const employee=person('read-only');status(employee,'2020-01-01');job(employee,'2020-01-01');const before=JSON.stringify({employees:f.rows('SELECT * FROM employees'),history:f.rows('SELECT * FROM employment_history'),audit:f.rows('SELECT * FROM audit')});
 await result();assert.equal(JSON.stringify({employees:f.rows('SELECT * FROM employees'),history:f.rows('SELECT * FROM employment_history'),audit:f.rows('SELECT * FROM audit')}),before);assert.equal(f.storage.size,0);assert.equal(f.bucketReads.length,0);
});
