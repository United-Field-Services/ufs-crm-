// Synthetic in-memory bootstrap/rollback tests only. The helper is invoked at
// its verified-identity boundary; real provider JWT verification has separate
// tests. No provider account, credential, invitation, email or live record is used.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './harness.mjs';
const setupApi=await import('../lib/test-scope-setup.ts');
const {QA_EMPLOYEE_ID:EMP,QA_HR_ID:HR}=setupApi;
const QA='qa-bots-v1',issuer='https://ycswaipyuonxwyalkits.supabase.co/auth/v1';
const empSubject='aaaaaaaa-1111-4111-8111-111111111111',hrSubject='bbbbbbbb-2222-4222-8222-222222222222';
const empEmail='synthetic-employee@example.test',hrEmail='synthetic-hr@example.test';
const config={UFS_QA_TEST_ACCESS:'enabled',UFS_QA_BOOTSTRAP:'approved',UFS_QA_EMPLOYEE_SUB:empSubject,UFS_QA_HR_MANAGER_SUB:hrSubject,UFS_QA_EMPLOYEE_EMAIL:empEmail,UFS_QA_HR_MANAGER_EMAIL:hrEmail};
const envKeys=[...Object.keys(config),'UFS_SUPABASE_OWNER_SUB','UFS_SUPABASE_ADDITIONAL_ADMIN_SUB'];
function setup(t,{configure=true}={}){
 const f=fixture();t.after(()=>f.close());const old=Object.fromEntries(envKeys.map(k=>[k,f.env[k]]));for(const key of envKeys)delete f.env[key];if(configure)Object.assign(f.env,config);
 t.after(()=>{for(const key of envKeys)if(old[key]===undefined)delete f.env[key];else f.env[key]=old[key];});
 const previousFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Bootstrap must not invoke external services')};t.after(()=>{globalThis.fetch=previousFetch});
 f.live=f.employee('existing-live',{role:'admin'});f.employee('existing-live-employee',{manager_id:f.live.id});
 f.hr=(overrides={})=>f.employee(HR,{data_scope:QA,user_id:null,role:'hr_manager',email:hrEmail,manager_id:null,...overrides});
 f.emp=(overrides={})=>f.employee(EMP,{data_scope:QA,user_id:null,role:'employee',email:empEmail,manager_id:HR,...overrides});
 f.identity=(employeeId,subject,overrides={})=>{const values={id:crypto.randomUUID(),issuer,subject,employee_id:employeeId,enabled:1,created_at:'2026-01-01T00:00:00Z',approved_by:'synthetic-reviewer',...overrides};f.run(`INSERT INTO employee_identities (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(()=>'?').join(',')})`,...Object.values(values));};
 f.provision=(subject=empSubject,email=empEmail)=>setupApi.provisionApprovedTestProfiles(issuer,subject,email);
 return f;
}
function snapshot(f){const tables=f.rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(r=>r.name);return JSON.stringify(Object.fromEntries(tables.map(table=>[table,f.rows(`SELECT * FROM ${table} ORDER BY rowid`)])));}
const denied=promise=>assert.rejects(promise,e=>e.status===403);
function verify(f){
 const hr=f.get('SELECT * FROM employees WHERE id=?',HR),emp=f.get('SELECT * FROM employees WHERE id=?',EMP);
 assert.equal(hr.data_scope,QA);assert.equal(hr.role,'hr_manager');assert.equal(hr.user_id,null);assert.equal(hr.email,hrEmail);assert.equal(hr.manager_id,null);
 assert.equal(emp.data_scope,QA);assert.equal(emp.role,'employee');assert.equal(emp.user_id,null);assert.equal(emp.email,empEmail);assert.equal(emp.manager_id,HR);
 for(const row of [hr,emp]){assert.equal(row.active,1);assert.equal(row.demo,0);}
 assert.deepEqual(f.rows('SELECT subject,employee_id,enabled FROM employee_identities ORDER BY employee_id').map(row=>({...row})),[{subject:empSubject,employee_id:EMP,enabled:1},{subject:hrSubject,employee_id:HR,enabled:1}]);
 assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n,0);assert.equal(f.get('SELECT COUNT(*) n FROM auth_session_tokens').n,0);assert.equal(f.storage.size,0);assert.equal(f.bucketReads.length,0);
 assert.ok(f.rows('SELECT * FROM audit').every(row=>row.data_scope===QA));assert.equal(f.get('SELECT valid FROM qa_provisioning_checks WHERE id=1').valid,1);
}

test('default absent configuration and bootstrap approval perform no writes',async t=>{
 const f=setup(t,{configure:false}),before=snapshot(f);assert.equal(setupApi.approvedQaConfiguration(),null);assert.equal(setupApi.approvedQaBootstrap(),null);await f.provision();assert.equal(snapshot(f),before);
 Object.assign(f.env,config);delete f.env.UFS_QA_BOOTSTRAP;assert.ok(setupApi.approvedQaConfiguration());assert.equal(setupApi.approvedQaBootstrap(),null);await f.provision();assert.equal(snapshot(f),before);
});
for(const key of Object.keys(config))test(`missing ${key} cannot bootstrap any record`,async t=>{
 const f=setup(t);delete f.env[key];const before=snapshot(f);assert.equal(setupApi.approvedQaBootstrap(),null);await f.provision();assert.equal(snapshot(f),before);
});
for(const [name,patch]of [
 ['unapproved access spelling',{UFS_QA_TEST_ACCESS:'true'}],['unapproved bootstrap spelling',{UFS_QA_BOOTSTRAP:'enabled'}],
 ['invalid employee UUID',{UFS_QA_EMPLOYEE_SUB:'employee'}],['invalid HR UUID',{UFS_QA_HR_MANAGER_SUB:'manager'}],
 ['duplicate UUID',{UFS_QA_HR_MANAGER_SUB:empSubject}],
 ['uppercase employee UUID',{UFS_QA_EMPLOYEE_SUB:empSubject.toUpperCase()}],['same UUID with alternate case',{UFS_QA_HR_MANAGER_SUB:empSubject.toUpperCase()}],['case-insensitive owner collision',{UFS_SUPABASE_OWNER_SUB:empSubject.toUpperCase()}],['owner collision',{UFS_SUPABASE_OWNER_SUB:empSubject}],['additional-admin collision',{UFS_SUPABASE_ADDITIONAL_ADMIN_SUB:hrSubject}],
 ['uppercase employee email',{UFS_QA_EMPLOYEE_EMAIL:'EMPLOYEE@example.test'}],['whitespace HR email',{UFS_QA_HR_MANAGER_EMAIL:' synthetic-hr@example.test'}],
 ['duplicate email',{UFS_QA_HR_MANAGER_EMAIL:empEmail}],['invalid employee email',{UFS_QA_EMPLOYEE_EMAIL:'no-at-sign'}],['invalid HR email',{UFS_QA_HR_MANAGER_EMAIL:'a@localhost'}],
 ['overlength email',{UFS_QA_EMPLOYEE_EMAIL:'x'.repeat(250)+'@example.test'}],
])test(`${name} fails closed without partial provisioning`,async t=>{
 const f=setup(t);Object.assign(f.env,patch);const before=snapshot(f);assert.equal(setupApi.approvedQaBootstrap(),null);await f.provision();assert.equal(snapshot(f),before);
});
for(const [name,subject,email]of [
 ['unknown subject','cccccccc-3333-4333-8333-333333333333',empEmail],['employee with HR email',empSubject,hrEmail],['HR with employee email',hrSubject,empEmail],['missing verified email',empSubject,''],['whitespace verified email',empSubject,empEmail+' '],
])test(`${name} cannot bootstrap approved profiles`,async t=>{const f=setup(t),before=snapshot(f);await denied(f.provision(subject,email));assert.equal(snapshot(f),before);});

for(const principal of ['employee','hr'])test(`approved ${principal} first login bootstraps only exact synthetic profiles and mappings`,async t=>{
 const f=setup(t),before=JSON.stringify(f.rows("SELECT * FROM employees WHERE data_scope='live' ORDER BY id"));await f.provision(principal==='employee'?empSubject:hrSubject,principal==='employee'?empEmail:hrEmail);verify(f);
 assert.equal(f.get('SELECT COUNT(*) n FROM employees').n,4);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,2);assert.equal(JSON.stringify(f.rows("SELECT * FROM employees WHERE data_scope='live' ORDER BY id")),before);
 const once=snapshot(f);await f.provision();await f.provision(hrSubject,hrEmail);assert.equal(snapshot(f),once,'repeated logins must not create audit or binding duplicates');
});

test('concurrent exact employee and HR first logins are atomic and idempotent',async t=>{
 const f=setup(t);await Promise.all([f.provision(),f.provision(hrSubject,hrEmail),f.provision(),f.provision(hrSubject,hrEmail)]);verify(f);assert.equal(f.get('SELECT COUNT(*) n FROM employees').n,4);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,2);
});

for(const [name,patch]of [
 ['wrong role',{role:'employee'}],['admin role',{role:'admin'}],['inactive',{active:0}],['demo',{demo:1}],['bound legacy identity',{user_id:'synthetic-legacy'}],['wrong email',{email:'other-synthetic@example.test'}],['live scope',{data_scope:'live'}],
])test(`existing HR ${name} is preserved and prevents every bootstrap write`,async t=>{
 const f=setup(t);f.hr(patch);const before=snapshot(f);await denied(f.provision());assert.equal(snapshot(f),before);assert.equal(f.get('SELECT COUNT(*) n FROM employees WHERE id=?',EMP).n,0);
});
for(const [name,patch]of [
 ['HR role',{role:'hr_manager'}],['inactive',{active:0}],['demo',{demo:1}],['bound identity',{user_id:'synthetic-legacy'}],['wrong email',{email:'other-synthetic@example.test'}],['missing manager',{manager_id:null}],
])test(`existing employee ${name} is preserved and prevents identity provisioning`,async t=>{
 const f=setup(t);f.hr();f.emp(patch);const before=snapshot(f);await denied(f.provision());assert.equal(snapshot(f),before);
});

test('same approved email on a real profile neither blocks QA nor binds or changes the real profile',async t=>{
 const f=setup(t);f.run('UPDATE employees SET email=? WHERE id=?',empEmail,f.live.id);const before={...f.get('SELECT * FROM employees WHERE id=?',f.live.id)};await f.provision();verify(f);assert.deepEqual({...f.get('SELECT * FROM employees WHERE id=?',f.live.id)},before);
});
test('approved email already used by another QA profile prevents deterministic profile creation',async t=>{
 const f=setup(t);f.employee('other-qa-profile',{data_scope:QA,user_id:null,email:empEmail});const before=snapshot(f);await denied(f.provision());assert.equal(snapshot(f),before);
});
for(const conflict of ['disabled','wrong-subject','subject-elsewhere','reversed'])test(`${conflict} existing identity cannot be repaired, rebound or promoted`,async t=>{
 const f=setup(t);f.hr();f.emp();
 if(conflict==='disabled')f.identity(HR,hrSubject,{enabled:0});
 if(conflict==='wrong-subject')f.identity(HR,'cccccccc-3333-4333-8333-333333333333');
 if(conflict==='subject-elsewhere')f.identity(f.live.id,hrSubject);
 if(conflict==='reversed'){f.identity(HR,empSubject);f.identity(EMP,hrSubject);}
 const before=snapshot(f);await denied(f.provision());assert.equal(snapshot(f),before);
});

test('configuration reversal after successful bootstrap preserves all existing identities and roles',async t=>{
 const f=setup(t);await f.provision();const before=snapshot(f);Object.assign(f.env,{UFS_QA_EMPLOYEE_SUB:hrSubject,UFS_QA_HR_MANAGER_SUB:empSubject});await denied(f.provision(hrSubject,empEmail));assert.equal(snapshot(f),before);
});
test('changed approved emails after bootstrap never rename or rebind existing users',async t=>{
 const f=setup(t);await f.provision();const before=snapshot(f);f.env.UFS_QA_EMPLOYEE_EMAIL='changed-synthetic@example.test';await denied(f.provision(empSubject,'changed-synthetic@example.test'));assert.equal(snapshot(f),before);
});
test('disabled mapping after successful bootstrap remains disabled on a repeated login',async t=>{
 const f=setup(t);await f.provision();f.run('UPDATE employee_identities SET enabled=0 WHERE subject=?',hrSubject);const before=snapshot(f);await denied(f.provision());assert.equal(snapshot(f),before);
});
test('deactivated or demoted profile after successful bootstrap is never reactivated or promoted',async t=>{
 const f=setup(t);await f.provision();f.run("UPDATE employees SET active=0,role='employee' WHERE id=?",HR);const before=snapshot(f);await denied(f.provision());assert.equal(snapshot(f),before);
});

test('a matching partial prior approval may complete missing rows without altering existing profile details',async t=>{
 const f=setup(t);f.hr({name:'Existing synthetic name',title:'Existing synthetic title'});f.identity(HR,hrSubject);const before={...f.get('SELECT * FROM employees WHERE id=?',HR)};await f.provision();verify(f);assert.deepEqual({...f.get('SELECT * FROM employees WHERE id=?',HR)},before);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,1);
});
for(const stage of ['employee-profile','identity','audit','final-assertion'])test(`${stage} write failure rolls the entire bootstrap transaction back`,async t=>{
 const f=setup(t),before=snapshot(f),prepare=f.env.DB.prepare;let failed=false;
 f.env.DB.prepare=sql=>{
  const statement=prepare(sql),run=statement.run;
  statement.run=async()=>{
   const isStage=stage==='employee-profile'?sql.startsWith('INSERT OR IGNORE INTO employees')&&f.get('SELECT COUNT(*) n FROM employees WHERE id=?',HR).n===1:stage==='identity'?sql.startsWith('INSERT OR IGNORE INTO employee_identities'):stage==='audit'?sql.startsWith('INSERT INTO audit'):sql.startsWith('INSERT INTO qa_provisioning_checks');
   if(isStage&&!failed){failed=true;throw new Error('Synthetic transaction failure');}return run();
  };return statement;
 };
 await denied(f.provision());assert.equal(failed,true);assert.equal(snapshot(f),before);
});
test('final CHECK invariant detects a silently skipped identity insertion and rolls everything back',async t=>{
 const f=setup(t),before=snapshot(f),prepare=f.env.DB.prepare;let skipped=false;
 f.env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('INSERT OR IGNORE INTO employee_identities')&&!skipped){skipped=true;statement.run=async()=>{f.run('UPDATE employees SET title=title WHERE 1=0');return {success:true,meta:{changes:0}};};}return statement;};
 await denied(f.provision());assert.equal(skipped,true);assert.equal(snapshot(f),before);
});
test('conflict arriving immediately before the batch is preserved without inserting the other profile',async t=>{
 const f=setup(t),batch=f.env.DB.batch;let conflict=false;
 f.env.DB.batch=statements=>{if(!conflict){conflict=true;f.hr({active:0});}return batch(statements);};
 await denied(f.provision());assert.equal(conflict,true);assert.equal(f.get('SELECT active FROM employees WHERE id=?',HR).active,0);assert.equal(f.get('SELECT COUNT(*) n FROM employees WHERE id=?',EMP).n,0);assert.equal(f.get('SELECT COUNT(*) n FROM employee_identities').n,0);assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);
});
