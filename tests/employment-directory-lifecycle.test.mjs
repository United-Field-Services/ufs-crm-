// Synthetic employment lifecycle fixtures only. Real auth/profile/state code runs
// against the existing in-memory D1 adapter; no external service is contacted.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,asUser,jsonRequest,fileRequest,fileContext} from './harness.mjs';
const state=await import('../app/api/state/route.ts');
const profiles=await import('../app/api/profiles/[id]/route.ts');
const photos=await import('../app/api/photos/[id]/route.ts');
const {currentPeople}=await import('../lib/workforce.ts');
const {getHeadcountSnapshot}=await import('../lib/hr-report.ts');
const QA='qa-bots-v1';
const stamp='2026-01-01T00:00:00Z';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lwoAAAAASUVORK5CYII=','base64'));

function setup(t,scope='live'){
 const f=fixture();t.after(()=>f.close());
 const hr=f.employee('hr',{role:'hr_manager',data_scope:scope});
 const viewer=f.employee('viewer',{data_scope:scope});
 const person=f.employee('person',{data_scope:scope});
 return {...f,hr,viewer,person};
}
function savedProfile(f,person,status,scope=person.data_scope??'live'){
 f.run('INSERT INTO employee_profiles (employee_id,data_scope,employment_status,bio,updated_at) VALUES (?,?,?,?,?)',person.id,scope,status,'Synthetic private biography',stamp);
}
function source(f,person,status){
 f.run('INSERT INTO source_employee_links (source_id,employee_id,source_email,source_status,imported_at) VALUES (?,?,?,?,?)',`/people/${person.id}`,person.id,person.email,status,stamp);
}
function savedPhoto(f,person){
 const scope=person.data_scope??'live',key=`${scope===QA?'test/'+QA+'/':''}photos/${person.id}`;
 f.run('INSERT INTO employee_photos (employee_id,data_scope,object_key,mime,size,sha256,source_id,imported_at) VALUES (?,?,?,?,?,?,?,?)',person.id,scope,key,'image/png',png.length,'a'.repeat(64),`/people/${person.id}`,stamp);
 f.storage.set(key,png);
}
const getPhoto=(actor,id)=>asUser(actor,()=>photos.GET(fileRequest(id),fileContext(id)));
const postProfile=(actor,id,status)=>asUser(actor,()=>profiles.POST(jsonRequest({action:'update_employment',values:{employment_status:status},effective_date:'2026-01-01',reason:'Synthetic lifecycle regression'}),fileContext(id)));
const getProfile=(actor,id)=>asUser(actor,()=>profiles.GET(fileRequest(id),fileContext(id)));
async function ok(response){assert.equal(response.status,200,await response.clone().text());return response.json()}
const workspace=actor=>asUser(actor,()=>state.GET()).then(ok);
function assertCurrentCount(data,expected){
 assert.equal(currentPeople(data.people).length,expected);
 if(data.testMode)assert.equal(data.headcountSnapshot.rows[0].value,expected);
}

for(const scope of ['live',QA])for(const former of ['Terminated','Inactive'])test(`${scope}: Active to ${former} to Active restores the directory, public profile and photo without restoring login`,async t=>{
 const f=setup(t,scope);savedProfile(f,f.person,'Active');savedPhoto(f,f.person);
 assert.equal((await getPhoto(f.viewer,f.person.id)).status,200);
 assertCurrentCount(await workspace(f.hr),3);
 await ok(await postProfile(f.hr,f.person.id,'On leave'));
 assert.equal(f.get('SELECT active FROM employees WHERE id=?',f.person.id).active,1);
 assertCurrentCount(await workspace(f.hr),3);
 await ok(await asUser(f.person,()=>state.GET()));

 await ok(await postProfile(f.hr,f.person.id,former));
 assert.equal(f.get('SELECT active FROM employees WHERE id=?',f.person.id).active,0);
 const offboarded=await workspace(f.hr);
 assert.equal(offboarded.people.length,3);
 assert.equal(offboarded.people.find(p=>p.id===f.person.id).directory_active,0);
 assertCurrentCount(offboarded,2);
 assert.equal((await workspace(f.viewer)).people.some(p=>p.id===f.person.id),false);
 assert.equal((await getProfile(f.viewer,f.person.id)).status,404);
 assert.equal((await getPhoto(f.viewer,f.person.id)).status,404);
 assert.equal((await getPhoto(f.hr,f.person.id)).status,200);
 assert.equal((await asUser(f.person,()=>state.GET())).status,403);

 await ok(await postProfile(f.hr,f.person.id,'Active'));
 assert.equal(f.get('SELECT active FROM employees WHERE id=?',f.person.id).active,0);
 const rehired=await workspace(f.hr);
 assert.equal(rehired.people.find(p=>p.id===f.person.id).directory_active,1);
 assert.equal(rehired.people.find(p=>p.id===f.person.id).active,0);
 assertCurrentCount(rehired,3);
 assert.equal((await workspace(f.viewer)).people.some(p=>p.id===f.person.id),true);
 const publicProfile=await ok(await getProfile(f.viewer,f.person.id));
 assert.equal(publicProfile.access.private,false);
 assert.equal('bio' in publicProfile.profile,false);
 assert.equal('email' in publicProfile.profile,false);
 const photo=await getPhoto(f.viewer,f.person.id);assert.equal(photo.status,200);assert.deepEqual(new Uint8Array(await photo.arrayBuffer()),png);
 assert.equal((await getPhoto(f.person,f.person.id)).status,403);
 assert.equal((await asUser(f.person,()=>state.GET())).status,403);
 assert.equal((await getProfile(f.person,f.person.id)).status,403);
 const history=f.rows('SELECT snapshot FROM employment_history WHERE employee_id=? AND data_scope=? ORDER BY rowid',f.person.id,scope).map(row=>JSON.parse(row.snapshot).employment_status);
 assert.deepEqual(history,['On leave',former,'Active']);
});

for(const status of ['Active','Probation','On leave','Notice period'])test(`${status} is current employment even when account access is disabled`,async t=>{
 const f=setup(t,QA);f.run('UPDATE employees SET active=0 WHERE id=?',f.person.id);savedProfile(f,f.person,status);
 const data=await workspace(f.hr);assert.equal(data.people.find(p=>p.id===f.person.id).directory_active,1);assertCurrentCount(data,3);
 await ok(await getProfile(f.viewer,f.person.id));assert.equal((await asUser(f.person,()=>state.GET())).status,403);
});

for(const status of ['Inactive','Terminated',' Archived '])test(`${status.trim()} profile remains former even if its login flag is stale`,async t=>{
 const f=setup(t,QA);savedProfile(f,f.person,status);
 const data=await workspace(f.hr);assert.equal(data.people.find(p=>p.id===f.person.id).directory_active,0);assertCurrentCount(data,2);
 assert.equal((await workspace(f.viewer)).people.some(p=>p.id===f.person.id),false);
 assert.equal((await getProfile(f.viewer,f.person.id)).status,404);
 assert.equal((await asUser(f.person,()=>state.GET())).status,403);
 assert.equal(f.get('SELECT active FROM employees WHERE id=?',f.person.id).active,1);
});

test('legacy local employees without an explicit recognized lifecycle retain the existing account fallback',async t=>{
 const f=setup(t,QA);
 for(const [id,status,active]of [['absent-active',null,1],['absent-disabled',null,0],['unknown-active','Legacy unknown',1],['unknown-disabled','Legacy unknown',0]]){
  const person=f.employee(id,{data_scope:QA,active});if(status!==null)savedProfile(f,person,status);
 }
 const data=await workspace(f.hr);
 for(const person of data.people)assert.equal(person.directory_active,person.active);
 assertCurrentCount(data,5);
});

for(const sourceStatus of ['Terminated',' INACTIVE ','Archived'])test(`imported ${sourceStatus.trim()} stays former after a local Active edit`,async t=>{
 const f=setup(t);savedProfile(f,f.person,'Terminated');source(f,f.person,sourceStatus);savedPhoto(f,f.person);f.run('UPDATE employees SET active=0 WHERE id=?',f.person.id);
 await ok(await postProfile(f.hr,f.person.id,'Active'));
 const data=await workspace(f.hr);assert.equal(data.people.find(p=>p.id===f.person.id).directory_active,0);assertCurrentCount(data,2);
 assert.equal((await workspace(f.viewer)).people.some(p=>p.id===f.person.id),false);
 assert.equal((await getProfile(f.viewer,f.person.id)).status,404);
 assert.equal((await getPhoto(f.viewer,f.person.id)).status,404);
 assert.equal((await asUser(f.person,()=>state.GET())).status,403);
 assert.equal(f.get('SELECT active FROM employees WHERE id=?',f.person.id).active,0);
});

test('current imported staff stay visible while awaiting account activation',async t=>{
 const f=setup(t);savedProfile(f,f.person,'On leave');source(f,f.person,'Full-Time');f.run('UPDATE employees SET active=0 WHERE id=?',f.person.id);
 const data=await workspace(f.hr);assert.equal(data.people.find(p=>p.id===f.person.id).directory_active,1);assertCurrentCount(data,3);
 await ok(await getProfile(f.viewer,f.person.id));assert.equal((await asUser(f.person,()=>state.GET())).status,403);
 assert.deepEqual(data.headcountSnapshot,getHeadcountSnapshot(f.hr));
});

test('current headcount and employment changes are isolated by scope',async t=>{
 const f=setup(t,QA);savedProfile(f,f.person,'Active');
 const liveHR=f.employee('live-hr',{role:'hr_manager'}),liveFormer=f.employee('live-former',{active:0}),liveCurrent=f.employee('live-current',{active:0});
 savedProfile(f,liveFormer,'Terminated');savedProfile(f,liveCurrent,'Active');
 const liveBefore=JSON.stringify(f.rows("SELECT * FROM employees WHERE data_scope='live' ORDER BY id"));
 let data=await workspace(f.hr);assertCurrentCount(data,3);assert.deepEqual(data.people.map(p=>p.id).sort(),[f.hr.id,f.viewer.id,f.person.id].sort());
 await ok(await postProfile(f.hr,f.person.id,'Terminated'));data=await workspace(f.hr);assertCurrentCount(data,2);
 await ok(await postProfile(f.hr,f.person.id,'Active'));data=await workspace(f.hr);assertCurrentCount(data,3);
 assert.equal((await postProfile(f.hr,liveCurrent.id,'Inactive')).status,404);
 const live=await workspace(liveHR);assert.deepEqual(live.people.map(p=>p.id).sort(),[liveHR.id,liveFormer.id,liveCurrent.id].sort());assertCurrentCount(live,2);
 assert.deepEqual(live.headcountSnapshot,getHeadcountSnapshot(liveHR));
 assert.equal(JSON.stringify(f.rows("SELECT * FROM employees WHERE data_scope='live' ORDER BY id")),liveBefore);
});

test('mismatched profile scopes are rejected and cannot promote disabled accounts into directory counts',async t=>{
 const f=setup(t,QA);f.run('UPDATE employees SET active=0 WHERE id=?',f.person.id);assert.throws(()=>savedProfile(f,f.person,'Active','live'),/Data scope boundary/);
 const data=await workspace(f.hr);assert.equal(data.people.find(p=>p.id===f.person.id).directory_active,0);assertCurrentCount(data,2);
 assert.equal((await getProfile(f.viewer,f.person.id)).status,404);assert.equal((await asUser(f.person,()=>state.GET())).status,403);
});

test('test-scope source links are rejected and never inflate live pending-activation totals',async t=>{
 const f=setup(t);f.run('UPDATE employees SET active=0 WHERE id=?',f.person.id);savedProfile(f,f.person,'Active');source(f,f.person,'Full-Time');
 const qa=f.employee('qa-linked',{data_scope:QA,active:0});savedProfile(f,qa,'Active');assert.throws(()=>source(f,qa,'Full-Time'),/Source imports cannot reference test profiles/);
 f.run('INSERT INTO migration_batches (id,source_origin,digest,counts_json,imported_at) VALUES (?,?,?,?,?)','talenthr-directory-v1','https://example.test','synthetic',JSON.stringify({employees:1}),stamp);
 const data=await workspace(f.hr);assert.equal(data.importSummary.pendingAccess,1);assert.equal(data.people.some(p=>p.id===qa.id),false);
});
