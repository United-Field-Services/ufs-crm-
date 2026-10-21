// Independent boundary tests. All identities, data, and object bytes are synthetic.
// asUser supplies the existing local verified-identity fixture; these are not real
// employee logins. The standalone provider gate has a separate signed-JWT suite.
// No network, live sign-in, provisioning, notification, or deployment occurs here.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {fixture, asUser, jsonRequest, uploadRequest, fileContext, fileRequest} from './harness.mjs';

const action = await import('../app/api/action/route.ts');
const state = await import('../app/api/state/route.ts');
const operations = await import('../app/api/operations/route.ts');
const profile = await import('../app/api/profiles/[id]/route.ts');
const photo = await import('../app/api/photos/[id]/route.ts');
const files = await import('../app/api/files/route.ts');
const file = await import('../app/api/files/[id]/route.ts');
const policy = await import('../lib/policy.ts');
const server = await import('../lib/server.ts');
const QA = 'qa-bots-v1', LIVE = 'live', stamp = '2026-01-01T00:00:00Z';
const scopedTables = ['employees','leave_requests','documents','events','audit','tasks','entitlements','employee_profiles','emergency_contacts','employee_identifiers','compensation_records','employment_history','education_records','benefit_enrollments','workflow_templates','workflow_runs','assets','asset_history','announcements','announcement_reads','time_entries','document_acknowledgements','employee_photos'];
const act = (who, body) => asUser(who, () => action.POST(jsonRequest(body)));
const op = (who, body) => asUser(who, () => operations.POST(jsonRequest(body)));
const getProfile = (who, id) => asUser(who, () => profile.GET(fileRequest(id),fileContext(id)));
const postProfile = (who, id, body) => asUser(who, () => profile.POST(jsonRequest(body),fileContext(id)));
const getFile = (who, id) => asUser(who, () => file.GET(fileRequest(id),fileContext(id)));
const getPhoto = (who, id) => asUser(who, () => photo.GET(fileRequest(id),fileContext(id)));
const steps = [{title:'Synthetic step',assignee:'employee',offset:0},{title:'Synthetic HR step',assignee:'hr',offset:1}];
const template = (overrides={}) => ({action:'saveTemplate',name:'Synthetic template',kind:'Onboarding',steps,...overrides});
const notice = (overrides={}) => ({action:'saveAnnouncement',title:'Synthetic notice',body:'Synthetic body',status:'published',...overrides});
const asset = (overrides={}) => ({action:'saveAsset',name:'Synthetic laptop',tag:'SYNTHETIC-TAG',category:'Laptop',...overrides});
const leave = (overrides={}) => ({action:'requestLeave',type:'Vacation',startDate:'2026-11-09',endDate:'2026-11-09',...overrides});
const budgets = employeeId => ({action:'updateBudgets',employeeId,year:2026,vacation:10,sick:5,wfh:20,bereavement:3});
const newPerson = (overrides={}) => ({action:'createEmployee',name:'Synthetic added employee',email:'synthetic-added@example.test',title:'Tester',department:'Synthetic department',location:'United States',employment:'Full-Time',hireDate:'2026-01-01',...overrides});
const contact = {name:'Synthetic contact',relationship:'Sibling',phone:'+1 555 010 2222',is_primary:true,priority:1};
const identifier = {type:'Passport',country:'United States',status:'Recorded',last4:'AB12'};
const education = {institution:'Synthetic college',status:'Completed'};
const benefit = {type:'Health',plan:'Synthetic plan',status:'Enrolled',effective_date:'2026-01-01'};
const compensation = {amount:100,currency:'USD',frequency:'Annual',effective_date:'2026-01-01',reason:'Synthetic reason'};
const job = values => ({action:'update_employment',values,effective_date:'2026-01-01',reason:'Synthetic job change'});
const insert = (f, table, values) => f.run(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(()=>'?').join(',')})`,...Object.values(values));
async function ok(response) { assert.equal(response.status,200,await response.clone().text()); return response.json(); }
async function denied(response) { assert.ok([400,401,403,404,409,410].includes(response.status),`Expected a controlled refusal, got ${response.status}: ${await response.clone().text()}`); }
function snapshot(f,scope) { return JSON.stringify(Object.fromEntries(scopedTables.map(table=>[table,f.rows(`SELECT * FROM ${table} WHERE data_scope=? ORDER BY rowid`,scope)]))); }
function setup(t,{seed=true}={}) {
  const f=fixture();t.after(()=>f.close());
  const previousFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('No external calls are permitted in this local boundary suite')};t.after(()=>{globalThis.fetch=previousFetch});
  for(const [prefix,scope] of [['live',LIVE],['qa',QA]]) {
    const marker=prefix==='live'?'LIVE_ONLY':'QA_ONLY';
    const hr=f.employee(`${prefix}-hr`,{role:'hr_manager',name:`${marker} HR`,data_scope:scope});
    const manager=f.employee(`${prefix}-manager`,{role:'manager',name:`${marker} manager`,data_scope:scope});
    const employee=f.employee(`${prefix}-employee`,{manager_id:manager.id,name:`${marker} employee`,data_scope:scope});
    const admin=f.employee(`${prefix}-admin`,{role:'admin',name:`${marker} admin`,data_scope:scope});
    f[prefix]={hr,manager,employee,admin,scope,marker};
    if(!seed)continue;
    const row=(table,values)=>insert(f,table,{...values,data_scope:scope});
    f.document(`${prefix}-personal`,employee.id,{data_scope:scope,name:`${marker}-personal.txt`});
    f.document(`${prefix}-company`,hr.id,{data_scope:scope,name:`${marker}-company.txt`,visibility:'company'});
    f.document(`${prefix}-hrfile`,employee.id,{data_scope:scope,name:`${marker}-hr.txt`,visibility:'hr'});
    f.leave(`${prefix}-leave`,employee.id,{data_scope:scope,note:`${marker} leave`,attachment_id:`${prefix}-personal`});
    f.leave(`${prefix}-away`,employee.id,{data_scope:scope,note:`${marker} away`,status:'approved',start_date:'2026-11-03',end_date:'2026-11-03'});
    row('events',{id:`${prefix}-event`,title:`${marker} event`,date:'2026-11-20',kind:'Company event',created_by:hr.id});
    row('audit',{id:`${prefix}-audit`,actor_id:hr.id,action:`${marker} audit`,target_id:employee.id,created_at:stamp});
    row('entitlements',{id:`${prefix}-entitlement`,employee_id:employee.id,year:2026,type:'Vacation',total:15,updated_by:hr.id,updated_at:stamp});
    row('employee_profiles',{employee_id:employee.id,bio:`${marker} biography`,division:`${marker} division`,updated_at:stamp});
    row('emergency_contacts',{id:`${prefix}-contact`,employee_id:employee.id,name:`${marker} contact`,relationship:'Sibling',phone:'+1 555 010 3333',updated_at:stamp});
    row('employee_identifiers',{id:`${prefix}-identifier`,employee_id:employee.id,type:'Passport',country:'United States',last4:'CD34',updated_at:stamp});
    row('compensation_records',{id:`${prefix}-compensation`,employee_id:employee.id,amount:100,currency:'USD',frequency:'Annual',effective_date:'2026-01-01',reason:`${marker} compensation`,created_by:hr.id,created_at:stamp});
    row('employment_history',{id:`${prefix}-history`,employee_id:employee.id,effective_date:'2026-01-01',reason:`${marker} history`,snapshot:JSON.stringify({title:`${marker} prior title`}),created_by:hr.id,created_at:stamp});
    row('education_records',{id:`${prefix}-education`,employee_id:employee.id,institution:`${marker} school`,updated_at:stamp});
    row('benefit_enrollments',{id:`${prefix}-benefit`,employee_id:employee.id,type:'Health',plan:`${marker} plan`,status:'Enrolled',effective_date:'2026-01-01',updated_at:stamp});
    row('workflow_templates',{id:`${prefix}-template`,name:`${marker} template`,kind:'Onboarding',steps:JSON.stringify(steps),created_by:hr.id,updated_at:stamp});
    row('workflow_runs',{id:`${prefix}-workflow`,template_id:`${prefix}-template`,employee_id:employee.id,name:`${marker} workflow`,kind:'Onboarding',start_date:'2026-01-01',created_by:hr.id,created_at:stamp});
    row('tasks',{id:`${prefix}-task`,title:`${marker} task`,assignee_id:employee.id,related_employee_id:employee.id,workflow_id:`${prefix}-workflow`,due_date:'2026-11-20',created_by:hr.id,created_at:stamp});
    row('assets',{id:`${prefix}-asset`,name:`${marker} asset`,category:'Laptop',tag:`${prefix}-tag`,assigned_to:employee.id,status:'assigned',created_by:hr.id,updated_at:stamp});
    row('asset_history',{id:`${prefix}-asset-history`,asset_id:`${prefix}-asset`,employee_id:employee.id,action:'assignAsset',actor_id:hr.id,created_at:stamp});
    row('announcements',{id:`${prefix}-announcement`,title:`${marker} announcement`,body:`${marker} body`,status:'published',created_by:hr.id,created_at:stamp});
    row('announcement_reads',{id:`${prefix}-read`,announcement_id:`${prefix}-announcement`,employee_id:employee.id,read_at:stamp});
    row('time_entries',{id:`${prefix}-time`,employee_id:employee.id,date:'2026-01-01',minutes:60,project:`${marker} project`,status:'submitted',required_manager_id:manager.id,created_at:stamp,updated_at:stamp});
    row('document_acknowledgements',{id:`${prefix}-ack`,document_id:`${prefix}-company`,employee_id:employee.id,acknowledged_at:stamp});
    row('employee_photos',{employee_id:employee.id,object_key:`${prefix==='qa'?'test/qa-bots-v1/':''}photos/${prefix}-employee`,mime:'image/png',size:12,sha256:prefix.repeat(16),source_id:`${prefix}-photo`,imported_at:stamp});
    f.storage.set(`${prefix==='qa'?'test/qa-bots-v1/':''}photos/${prefix}-employee`,new TextEncoder().encode(`${marker}photo`));
  }
  if(seed) {
    insert(f,'source_employee_links',{source_id:'LIVE_ONLY_source',employee_id:f.live.employee.id,source_email:'imported@example.test',manager_name:'LIVE_ONLY source manager',source_status:'active',imported_at:stamp});
    for(const id of ['talenthr-directory-v1','talenthr-former-v1','talenthr-current-history-v1','talenthr-profile-photos-v1'])insert(f,'migration_batches',{id,source_origin:'LIVE_ONLY_import',digest:'synthetic-digest',counts_json:JSON.stringify({employees:1,historyRows:1,transferred:1,marker:'LIVE_ONLY_counts'}),imported_at:stamp});
    insert(f,'source_hr_settings',{id:'talenthr-org',settings_json:JSON.stringify({marker:'LIVE_ONLY_settings'}),imported_at:stamp});
  }
  return f;
}

test('schema includes all 23 boundaries, defaults old data to live, and rejects invalid or mutable scopes',t=>{
  const f=setup(t);
  assert.equal(scopedTables.length,23);
  const defaultEmployee=f.employee('default-live');assert.equal(f.get('SELECT data_scope FROM employees WHERE id=?',defaultEmployee.id).data_scope,LIVE);
  for(const table of scopedTables) {
    const columns=f.rows(`PRAGMA table_info(${table})`),scope=columns.find(c=>c.name==='data_scope');assert.ok(scope,table);assert.equal(scope.notnull,1,table);assert.equal(scope.dflt_value,"'live'",table);
    assert.throws(()=>f.run(`UPDATE ${table} SET data_scope=? WHERE data_scope=?`,QA,LIVE),undefined,`${table} scope must be immutable`);
  }
  assert.throws(()=>f.employee('bad-scope',{data_scope:'other-tenant'}));
  assert.throws(()=>f.employee('null-scope',{data_scope:null}));
  assert.equal(policy.scopeOf({}),LIVE);assert.equal(policy.scopeOf({data_scope:QA}),QA);assert.throws(()=>policy.scopeOf({data_scope:'injected'}));assert.throws(()=>policy.scopeSql(f.qa.hr,'e; DROP TABLE employees'));
});

for(const viewer of ['hr','manager','employee'])test(`${viewer}: workspace and operations responses isolate both directions, including totals and global resources`,async t=>{
  const f=setup(t);
  for(const [prefix,other] of [['qa','LIVE_ONLY'],['live','QA_ONLY']]) {
    const actor=f[prefix][viewer];
    const workspace=await ok(await asUser(actor,()=>state.GET()));const ops=await ok(await asUser(actor,()=>operations.GET()));
    assert.ok(!JSON.stringify(workspace).includes(other),`${prefix} workspace leaked ${other}`);assert.ok(!JSON.stringify(ops).includes(other),`${prefix} operations leaked ${other}`);
    assert.ok(workspace.people.length>=3);assert.ok(workspace.people.every(row=>row.id.startsWith(prefix+'-')));
    assert.ok(workspace.documents.some(row=>row.id===`${prefix}-company`));assert.equal(ops.announcements.length,1);assert.equal(workspace.events.length,1);
    if(viewer==='hr') {assert.equal(ops.workflows.length,1);assert.equal(ops.workflows[0].total,1);assert.equal(ops.announcements[0].read_count,1);assert.equal(ops.acknowledgements.length,1);}
    if(prefix==='qa'){assert.equal(workspace.importSummary,null);assert.equal(workspace.sourceSettings,null);if(viewer==='hr'){assert.equal(workspace.headcountSnapshot.sourceLabel,'Synthetic test data');assert.equal(workspace.headcountSnapshot.sourceUrl,null);assert.equal(workspace.headcountSnapshot.rows[0].value,4);}else assert.equal(workspace.headcountSnapshot,null);}
    else if(viewer==='hr'){assert.equal(workspace.headcountSnapshot.sourceLabel,'TalentHR');assert.equal(workspace.sourceSettings.marker,'LIVE_ONLY_settings');}
  }
});

for(const viewer of ['admin','hr','manager','employee'])test(`${viewer}: guessed foreign profile, photo and file IDs do not disclose or touch storage`,async t=>{
  const f=setup(t);
  for(const [prefix,other] of [['qa','live'],['live','qa']]) {
    const actor=f[prefix][viewer],reads=f.bucketReads.length;
    for(const target of [`${other}-employee`,`${other}-hr`])assert.equal((await getProfile(actor,target)).status,404);
    assert.equal((await getPhoto(actor,`${other}-employee`)).status,404);
    for(const kind of ['personal','company','hrfile'])assert.equal((await getFile(actor,`${other}-${kind}`)).status,404);
    assert.equal(f.bucketReads.length,reads,'denied resource must never be fetched from R2');
  }
});

test('same-scope profile, private file, company file and avatar positive controls remain usable',async t=>{
  const f=setup(t);
  for(const prefix of ['live','qa']) {
    const {hr,employee,marker}=f[prefix];const data=await ok(await getProfile(hr,employee.id));assert.equal(data.profile.bio,`${marker} biography`);for(const key of ['emergencyContacts','identifiers','compensation','history','education','benefits'])assert.equal(data[key].length,1,key);
    assert.equal((await getFile(employee,`${prefix}-personal`)).status,200);assert.equal((await getFile(employee,`${prefix}-company`)).status,200);assert.equal((await getPhoto(employee,employee.id)).status,200);
  }
});

test('all foreign profile mutation and nested record-ID paths reject without changing live rows',async t=>{
  const f=setup(t),before=snapshot(f,LIVE),who=f.qa.hr,id=f.live.employee.id;
  const attempts=[{action:'update_personal',values:{bio:'tampered'}},job({title:'tampered'}),{action:'add_compensation',record:compensation},{action:'add_bonus',record:{amount:10,currency:'USD',effective_date:'2026-01-01',reason:'Synthetic'}},{action:'save_emergency_contact',contact},{action:'save_identifier',identifier},{action:'save_education',education},{action:'save_benefit',benefit},...['emergency_contact','identifier','education','benefit'].map(kind=>({action:`delete_${kind}`,[kind==='emergency_contact'?'contact_id':`${kind}_id`]:`live-${kind==='emergency_contact'?'contact':kind}`}))];
  for(const body of attempts)await denied(await postProfile(who,id,body));
  for(const [kind,key,record] of [['emergency_contact','contact',contact],['identifier','identifier',identifier],['education','education',education],['benefit','benefit',benefit]])await denied(await postProfile(who,f.qa.employee.id,{action:`save_${kind}`,[key]:{...record,id:`live-${key}`}}));
  assert.equal(snapshot(f,LIVE),before);
});

test('all foreign operation IDs and references reject without cross-scope changes or audit side effects',async t=>{
  const f=setup(t),before=snapshot(f,LIVE),qaBefore=snapshot(f,QA),hr=f.qa.hr,e=f.qa.employee;
  const attempts=[template({id:'live-template'}),{action:'archiveTemplate',id:'live-template'},{action:'applyTemplate',templateId:'live-template',employeeId:e.id,startDate:'2026-01-01'},{action:'applyTemplate',templateId:'qa-template',employeeId:f.live.employee.id,startDate:'2026-01-01'},asset({id:'live-asset'}),{action:'assignAsset',id:'live-asset',employeeId:e.id},{action:'returnAsset',id:'live-asset'},{action:'setAssetStatus',id:'live-asset',status:'retired'},notice({id:'live-announcement'}),{action:'readAnnouncement',id:'live-announcement'},{action:'saveTime',id:'live-time',date:'2026-01-01',minutes:30},{action:'submitTime',id:'live-time'},{action:'reviewTime',id:'live-time',status:'approved'},{action:'deleteTime',id:'live-time'},{action:'acknowledgeDocument',id:'live-company'}];
  for(const body of attempts)await denied(await op(hr,body));
  assert.equal(snapshot(f,LIVE),before);assert.equal(snapshot(f,QA),qaBefore);
});

test('foreign action targets, attachments, manager references and file edits fail without touching either scope',async t=>{
  const f=setup(t),before=snapshot(f,LIVE),hr=f.qa.hr,e=f.qa.employee;
  for(const body of [budgets(f.live.employee.id),{action:'createTask',title:'Synthetic',assigneeId:f.live.employee.id,dueDate:'2026-11-20'},{action:'toggleTask',id:'live-task',status:'completed'},{action:'reviewLeave',id:'live-leave',status:'approved'},{action:'cancelLeave',id:'live-leave'}])await denied(await act(hr,body));
  await denied(await act(e,leave({attachmentId:'live-personal'})));
  await denied(await act(f.qa.admin,{action:'updateAccess',employeeId:f.live.employee.id,role:'employee',active:true,managerId:f.qa.manager.id}));
  await denied(await postProfile(f.qa.admin,f.qa.employee.id,job({manager_id:f.live.manager.id})));
  await denied(await asUser(hr,()=>files.POST(uploadRequest('synthetic.txt','synthetic',{employeeId:f.live.employee.id,visibility:'hr'}))));
  await denied(await asUser(hr,()=>file.PATCH(jsonRequest({name:'changed.txt',folder:'Synthetic'}),fileContext('live-company'))));
  await denied(await asUser(hr,()=>file.DELETE(fileRequest('live-company','DELETE'),fileContext('live-company'))));
  assert.equal(snapshot(f,LIVE),before);
});

test('new QA business records inherit actor scope across every writable module and never alter live rows',async t=>{
  const f=setup(t),before=snapshot(f,LIVE),hr=f.qa.hr,e=f.qa.employee;
  await ok(await act(e,leave()));await ok(await act(hr,budgets(e.id)));await ok(await act(hr,newPerson()));
  await ok(await act(hr,{action:'addEvent',title:'Synthetic event',date:'2026-11-21',location:'All locations'}));await ok(await act(hr,{action:'createTask',title:'Synthetic task',assigneeId:e.id,dueDate:'2026-11-21'}));
  const temp=await ok(await op(hr,template()));await ok(await op(hr,{action:'applyTemplate',templateId:temp.id,employeeId:e.id,startDate:'2026-01-01'}));
  const inventory=await ok(await op(hr,asset()));await ok(await op(hr,{action:'assignAsset',id:inventory.id,employeeId:e.id}));
  const announcement=await ok(await op(hr,notice()));await ok(await op(e,{action:'readAnnouncement',id:announcement.id}));
  const time=await ok(await op(e,{action:'saveTime',date:'2026-01-02',minutes:120}));await ok(await op(e,{action:'submitTime',id:time.id}));await ok(await op(f.qa.manager,{action:'reviewTime',id:time.id,status:'approved'}));
  const uploaded=await ok(await asUser(hr,()=>files.POST(uploadRequest('synthetic-policy.txt','synthetic policy',{visibility:'company'}))));await ok(await op(e,{action:'acknowledgeDocument',id:uploaded.id}));
  await ok(await postProfile(e,e.id,{action:'update_personal',values:{bio:'Synthetic new bio'}}));await ok(await postProfile(hr,e.id,job({title:'Synthetic new title'})));
  for(const body of [{action:'save_emergency_contact',contact},{action:'save_identifier',identifier},{action:'save_education',education},{action:'save_benefit',benefit},{action:'add_compensation',record:compensation}])await ok(await postProfile(hr,e.id,body));
  assert.equal(snapshot(f,LIVE),before,'QA workflows must not mutate any live business record');
  const created=f.get('SELECT * FROM employees WHERE email=? AND data_scope=?','synthetic-added@example.test',QA);assert.equal(created.role,'employee');assert.equal(created.user_id,null);assert.equal(created.data_scope,QA);
  for(const table of scopedTables.filter(table=>table!=='employee_photos'))assert.ok(f.get(`SELECT COUNT(*) n FROM ${table} WHERE data_scope=?`,QA).n>=1,table);
  assert.equal(f.get('SELECT COUNT(*) n FROM employee_identities').n,0);assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n,0);
});

for(const field of ['data_scope','dataScope','scope','test_scope','testMode'])test(`client ${field} cannot choose the live data scope`,async t=>{
  const f=setup(t,{seed:false}),before=snapshot(f,LIVE);
  await denied(await act(f.qa.hr,{...newPerson(),[field]:LIVE}));await denied(await op(f.qa.hr,{...notice(),[field]:LIVE}));
  await denied(await postProfile(f.qa.employee,f.qa.employee.id,{action:'update_personal',values:{bio:'Synthetic',[field]:LIVE}}));
  const response=await asUser(f.qa.employee,()=>files.POST(uploadRequest('synthetic.txt','Synthetic',{[field]:LIVE})));
  if(response.status===200){const {id}=await response.json();assert.equal(f.get('SELECT data_scope FROM documents WHERE id=?',id).data_scope,QA);}else await denied(response);
  assert.equal(snapshot(f,LIVE),before);
});

test('scope-local email and asset identifiers may coincide without changing live records',async t=>{
  const f=setup(t,{seed:false}),before=snapshot(f,LIVE);
  await ok(await act(f.qa.hr,newPerson({email:f.live.employee.email})));
  const first=await ok(await op(f.live.hr,asset({tag:'SHARED-SYNTHETIC'}))),second=await ok(await op(f.qa.hr,asset({tag:'SHARED-SYNTHETIC'})));
  assert.notEqual(first.id,second.id);assert.equal(f.rows('SELECT * FROM assets WHERE tag=?','SHARED-SYNTHETIC').length,2);
  assert.equal(JSON.stringify(f.get('SELECT * FROM employees WHERE id=?',f.live.employee.id)),JSON.stringify(JSON.parse(before).employees.find(row=>row.id===f.live.employee.id)));
  await denied(await act(f.qa.hr,newPerson({email:f.live.employee.email})));await denied(await op(f.qa.hr,asset({tag:'SHARED-SYNTHETIC'})));
});

test('holiday and allowance calculations stay scoped when live dates overlap test leave',async t=>{
  const f=setup(t,{seed:false});insert(f,'events',{id:'live-holiday',title:'LIVE_ONLY holiday',date:'2026-11-09',kind:'Holiday',location:'All locations',created_by:f.live.hr.id,data_scope:LIVE});
  await ok(await act(f.qa.employee,leave({endDate:'2026-11-10'})));assert.equal(f.get('SELECT days FROM leave_requests WHERE employee_id=?',f.qa.employee.id).days,2);
  await ok(await act(f.live.employee,leave({endDate:'2026-11-10'})));assert.equal(f.get('SELECT days FROM leave_requests WHERE employee_id=?',f.live.employee.id).days,1);
});

test('mixed live and QA concurrent requests keep query state and created scopes request-local',async t=>{
  const f=setup(t,{seed:false});
  const responses=await Promise.all(Array.from({length:12},(_,i)=>{const actor=i%2?f.qa.hr:f.live.hr;return op(actor,notice({title:`Concurrent ${i}`,body:`${actor.data_scope} body`}));}));for(const response of responses)await ok(response);
  assert.equal(f.get('SELECT COUNT(*) n FROM announcements WHERE data_scope=?',LIVE).n,6);assert.equal(f.get('SELECT COUNT(*) n FROM announcements WHERE data_scope=?',QA).n,6);
  const results=await Promise.all(Array.from({length:12},(_,i)=>asUser(i%2?f.qa.hr:f.live.hr,()=>operations.GET())));
  for(const [i,response] of results.entries()){const data=await ok(response),expected=i%2?QA:LIVE;assert.equal(data.announcements.length,6);assert.ok(data.announcements.every(row=>row.data_scope===expected));}
});

test('QA admin defense does not seed live demo rows or expose live approvers/reports',async t=>{
  const f=setup(t,{seed:false}),before=snapshot(f,LIVE);const data=await ok(await asUser(f.qa.admin,()=>state.GET()));assert.equal(snapshot(f,LIVE),before);assert.equal(data.headcountSnapshot.sourceLabel,'Synthetic test data');assert.equal(data.headcountSnapshot.rows[0].value,4);assert.ok(data.eligibleApprovers.every(row=>row.id.startsWith('qa-')));
});

test('legacy email auto-link selects only live profiles when a QA profile shares the address',async t=>{
  const f=setup(t,{seed:false}),email='shared-unbound@example.test';f.employee('qa-unbound',{user_id:null,email,data_scope:QA});f.employee('live-unbound',{user_id:null,email,data_scope:LIVE});
  const actor=await asUser({user_id:'new-synthetic-identity',email},()=>server.currentEmployee());assert.equal(actor.id,'live-unbound');assert.equal(f.get('SELECT user_id FROM employees WHERE id=?','qa-unbound').user_id,null);
});

test('one-time import endpoints remain closed for test actors without any mutation',async t=>{
  const f=setup(t),beforeLive=snapshot(f,LIVE),beforeQa=snapshot(f,QA);
  for(const path of ['import','import-former','import-current-history','photo-import']){const route=await import(`../app/api/${path}/route.ts`);assert.equal((await asUser(f.qa.hr,()=>route.POST(jsonRequest({data_scope:LIVE})))).status,410);}
  assert.equal(snapshot(f,LIVE),beforeLive);assert.equal(snapshot(f,QA),beforeQa);
});

const relationCases=[
  ['employees','id','qa-employee','manager_id','live-manager'],
  ['leave_requests','id','qa-leave','employee_id','live-employee'],
  ['leave_requests','id','qa-leave','required_manager_id','live-manager'],
  ['leave_requests','id','qa-leave','reviewer_id','live-manager'],
  ['leave_requests','id','qa-leave','attachment_id','live-personal'],
  ['documents','id','qa-personal','owner_id','live-employee'],
  ['events','id','qa-event','created_by','live-hr'],
  ['audit','id','qa-audit','actor_id','live-hr'],
  ['tasks','id','qa-task','assignee_id','live-employee'],
  ['tasks','id','qa-task','related_employee_id','live-employee'],
  ['tasks','id','qa-task','created_by','live-hr'],
  ['tasks','id','qa-task','workflow_id','live-workflow'],
  ['entitlements','id','qa-entitlement','employee_id','live-employee'],
  ['entitlements','id','qa-entitlement','updated_by','live-hr'],
  ['employee_profiles','employee_id','qa-employee','employee_id','live-admin'],
  ...['emergency_contacts','employee_identifiers','education_records','benefit_enrollments','compensation_records','employment_history'].map((table,i)=>[table,'id',`qa-${['contact','identifier','education','benefit','compensation','history'][i]}`,'employee_id','live-employee']),
  ['compensation_records','id','qa-compensation','created_by','live-hr'],
  ['employment_history','id','qa-history','created_by','live-hr'],
  ['workflow_templates','id','qa-template','created_by','live-hr'],
  ['workflow_runs','id','qa-workflow','template_id','live-template'],
  ['workflow_runs','id','qa-workflow','employee_id','live-employee'],
  ['workflow_runs','id','qa-workflow','created_by','live-hr'],
  ['assets','id','qa-asset','assigned_to','live-employee'],
  ['assets','id','qa-asset','created_by','live-hr'],
  ['asset_history','id','qa-asset-history','asset_id','live-asset'],
  ['asset_history','id','qa-asset-history','employee_id','live-employee'],
  ['asset_history','id','qa-asset-history','actor_id','live-hr'],
  ['announcements','id','qa-announcement','created_by','live-hr'],
  ['announcement_reads','id','qa-read','announcement_id','live-announcement'],
  ['announcement_reads','id','qa-read','employee_id','live-employee'],
  ['time_entries','id','qa-time','employee_id','live-employee'],
  ['time_entries','id','qa-time','required_manager_id','live-manager'],
  ['time_entries','id','qa-time','reviewed_by','live-manager'],
  ['document_acknowledgements','id','qa-ack','document_id','live-company'],
  ['document_acknowledgements','id','qa-ack','employee_id','live-employee'],
  ['employee_photos','employee_id','qa-employee','employee_id','live-admin'],
];
for(const [table,key,id,column,foreign] of relationCases)test(`database rejects cross-scope ${table}.${column} on insert and update`,t=>{
  const f=setup(t),before=snapshot(f,LIVE),row=f.get(`SELECT * FROM ${table} WHERE ${key}=?`,id);
  assert.throws(()=>f.run(`UPDATE ${table} SET ${column}=? WHERE ${key}=?`,foreign,id),undefined,`${table}.${column} update`);
  const added={...row,[key]:key==='employee_id'?'live-admin':`${id}-adversarial`,[column]:foreign};
  if(table==='employees'){added.user_id='synthetic-unique-user';added.email='unique-adversarial@example.test';}
  if(table==='assets')added.tag='unique-adversarial-tag';
  if(table==='documents')added.object_key=`test/qa-bots-v1/documents/${added.owner_id}/${added.id}`;
  if(table==='employee_photos')added.object_key='test/qa-bots-v1/photos/synthetic-adversarial';
  if(table==='employee_photos')added.source_id='synthetic-adversarial-photo';
  assert.throws(()=>insert(f,table,added),undefined,`${table}.${column} insert`);
  assert.equal(snapshot(f,LIVE),before);
});

test('database rejects attaching import-source metadata to QA employees',t=>{
  const f=setup(t);
  assert.throws(()=>insert(f,'source_employee_links',{source_id:'synthetic-qa-source',employee_id:f.qa.employee.id,source_email:'synthetic@example.test',imported_at:stamp}));
  assert.throws(()=>f.run('UPDATE source_employee_links SET employee_id=? WHERE source_id=?',f.qa.employee.id,'LIVE_ONLY_source'));
});

for(const [api,body,table,id] of [
  [operations,template({id:'qa-race-template'}),'workflow_templates','qa-race-template'],
  [operations,notice({id:'qa-race-announcement'}),'announcements','qa-race-announcement'],
])test(`${table}: preflight-authorized upsert cannot modify a replacement live row at the same ID`,async t=>{
  const f=setup(t,{seed:false}),hr=f.qa.hr;
  if(table==='workflow_templates')insert(f,table,{id,name:'Synthetic original',kind:'Onboarding',steps:JSON.stringify(steps),created_by:hr.id,updated_at:stamp,data_scope:QA});
  else insert(f,table,{id,title:'Synthetic original',body:'Synthetic body',created_by:hr.id,created_at:stamp,data_scope:QA});
  const batch=f.env.DB.batch;let replaced=false;
  f.env.DB.batch=async statements=>{
    if(!replaced){replaced=true;const row=f.get(`SELECT * FROM ${table} WHERE id=?`,id);f.run(`DELETE FROM ${table} WHERE id=?`,id);insert(f,table,{...row,data_scope:LIVE,created_by:f.live.hr.id});}
    return batch(statements);
  };
  await denied(await asUser(hr,()=>api.POST(jsonRequest(body))));assert.equal(replaced,true);
  const saved=f.get(`SELECT * FROM ${table} WHERE id=?`,id);assert.equal(saved.data_scope,LIVE);assert.equal(saved[table==='workflow_templates'?'name':'title'],'Synthetic original');assert.equal(f.get('SELECT COUNT(*) n FROM audit').n,0);
});


test('new migration preserves every pre-existing live row byte-for-byte apart from its default scope column',t=>{
  const f=setup(t),legacy=new DatabaseSync(':memory:');t.after(()=>legacy.close());legacy.exec('PRAGMA foreign_keys=ON');
  const directory=new URL('../drizzle/',import.meta.url),migrations=readdirSync(directory).filter(name=>name.endsWith('.sql')).sort();
  for(const name of migrations.filter(name=>name<'0009'))legacy.exec(readFileSync(new URL(name,directory),'utf8'));
  const before={};
  for(const table of scopedTables){
    before[table]=f.rows(`SELECT * FROM ${table} WHERE data_scope=? ORDER BY rowid`,LIVE).map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='data_scope')));
    for(const row of before[table])legacy.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  }
  for(const name of migrations.filter(name=>name>='0009'))legacy.exec(readFileSync(new URL(name,directory),'utf8'));
  for(const table of scopedTables){const after=legacy.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();assert.ok(after.every(row=>row.data_scope===LIVE),table);assert.deepEqual(after.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='data_scope'))),before[table],table);}
  assert.deepEqual(legacy.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(legacy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});
