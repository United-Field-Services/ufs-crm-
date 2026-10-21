// Application-session simulation only. No real employee login, account activation,
// hosted identity bypass, or production storage is used by this suite.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, asUser, jsonRequest, fileContext, fileRequest, uploadRequest } from './harness.mjs';
const state = await import('../app/api/state/route.ts');
const action = await import('../app/api/action/route.ts');
const operations = await import('../app/api/operations/route.ts');
const profiles = await import('../app/api/profiles/[id]/route.ts');
const files = await import('../app/api/files/route.ts');
const file = await import('../app/api/files/[id]/route.ts');
const { planImport, applyImport } = await import('../lib/directory-import.ts');
const { currentPeople, workforceRows, summaryCsv } = await import('../lib/workforce.ts');
const shapes = JSON.parse(readFileSync(new URL('./fixtures/roster-shapes.json', import.meta.url))).employees;
const roles = ['admin', 'hr_manager', 'manager', 'hiring_manager', 'employee'];
const payload = {schemaVersion:1,sourceOrigin:'https://unitedffs.talenthr.io',extractedAt:'2026-10-11T12:00:00Z',employees:shapes,holidays:[],excluded:[],settings:{timezone:'America/Los_Angeles',language:'English',currency:'USD',workingDays:[1,2,3,4,5],cycleStart:'01-01',requestInHours:true,calendarNotes:false,leaveTypes:[['Vacation',15],['Sick Leave',5],['WFH',30],['Bereavement',3]].map(([name,days])=>({name,days}))}};
let f, people, reviewer;
beforeEach(async () => {
 f=fixture();const owner=f.employee('qa-owner',{role:'admin',email:'owner@example.test'});
 const preview=await planImport(payload);await applyImport(payload,preview.digest,owner.id);
 people=shapes.map(shape=>f.get('SELECT e.* FROM employees e JOIN source_employee_links s ON s.employee_id=e.id WHERE s.source_id=?',shape.sourceId));
 // Only this disposable SQLite fixture is activated; production is never touched.
 for(const person of people){f.run('UPDATE employees SET user_id=?,active=1,role=? WHERE id=?',`qa-identity-${person.id}`,'employee',person.id);Object.assign(person,{user_id:`qa-identity-${person.id}`,active:1,role:'employee'});}
 reviewer=f.employee('qa-reviewer',{role:'manager'});
});
afterEach(()=>f.close());
const act=(actor,body)=>asUser(actor,()=>action.POST(jsonRequest(body)));
const op=(actor,body)=>asUser(actor,()=>operations.POST(jsonRequest(body)));
const profile=(actor,id)=>asUser(actor,()=>profiles.GET(fileRequest(id),fileContext(id)));
const edit=(actor,id,body)=>asUser(actor,()=>profiles.POST(jsonRequest(body),fileContext(id)));
async function ok(response,label){assert.equal(response.status,200,label);return response.json();}

for(let i=0;i<shapes.length;i++)for(const role of roles)test(`synthetic profile ${String(i+1).padStart(2,'0')}: ${role} application session`,async()=>{
 const actor=people[i],other=people[(i+1)%people.length],hr=['admin','hr_manager'].includes(role);
 f.run('UPDATE employees SET role=?,manager_id=? WHERE id=?',role,reviewer.id,actor.id);Object.assign(actor,{role,manager_id:reviewer.id});
 f.run('UPDATE employee_profiles SET personal_email=?,bio=? WHERE employee_id=?','private-marker@example.invalid','CROSS-USER-PRIVATE-MARKER',other.id);
 f.document('own-doc',actor.id);f.document('other-doc',other.id);f.document('hr-doc',actor.id,{visibility:'hr'});f.document('company-doc',other.id,{visibility:'company'});
 f.run('INSERT INTO tasks (id,title,assignee_id,due_date,created_by,created_at) VALUES (?,?,?,?,?,?)','own-task','Synthetic assigned task',actor.id,'2026-11-01',reviewer.id,'2026-01-01');
 f.leave('calendar-away',other.id,{status:'approved',note:'PRIVATE-LEAVE-MARKER',type:'Sick Leave'});
 const data=await ok(await asUser(actor,()=>state.GET()),'state');
 assert.equal(data.me.id,actor.id);assert.equal(data.me.role,role);assert.equal(data.people.filter(p=>p.imported).length,26);
 assert.equal(currentPeople(data.people,'real').filter(p=>p.imported).length,26);
 const publicJson=JSON.stringify(data.people);assert.ok(!publicJson.includes('CROSS-USER-PRIVATE-MARKER'));assert.ok(!publicJson.includes('private-marker@example.invalid'));
 assert.ok(data.teamAway.some(x=>x.id==='calendar-away'));assert.ok(!JSON.stringify(data.teamAway).includes('PRIVATE-LEAVE-MARKER'));assert.ok(!JSON.stringify(data.teamAway).includes('Sick Leave'));
 for(const person of people){const result=await ok(await profile(actor,person.id),'profile read');assert.equal(result.access.private,hr||person.id===actor.id);if(!hr&&person.id!==actor.id){assert.deepEqual(result.emergencyContacts,[]);assert.deepEqual(result.compensation,[]);assert.ok(!JSON.stringify(result).includes('CROSS-USER-PRIVATE-MARKER'));}}
 assert.equal((await edit(actor,actor.id,{action:'update_personal',values:{bio:'Synthetic self service edit'}})).status,200);
 assert.equal((await edit(actor,other.id,{action:'update_personal',values:{bio:'Synthetic HR edit'}})).status,hr?200:403);
 assert.equal((await asUser(actor,()=>file.GET(fileRequest('own-doc'),fileContext('own-doc')))).status,200);
 assert.equal((await asUser(actor,()=>file.GET(fileRequest('other-doc'),fileContext('other-doc')))).status,hr?200:404);
 assert.equal((await asUser(actor,()=>file.GET(fileRequest('hr-doc'),fileContext('hr-doc')))).status,hr?200:404);
 assert.equal((await asUser(actor,()=>files.POST(uploadRequest('own-upload.txt','Synthetic QA file')))).status,200);
 assert.equal((await act(actor,{action:'toggleTask',id:'own-task',status:'completed'})).status,200);
 const leave=await ok(await act(actor,{action:'requestLeave',type:'Vacation',startDate:'2026-11-04',endDate:'2026-11-04',note:'Synthetic self-service request',attachmentId:'own-doc'}),'leave');
 assert.equal(f.get('SELECT employee_id,required_manager_id FROM leave_requests WHERE id=?',leave.id).employee_id,actor.id);
 assert.equal((await act(actor,{action:'reviewLeave',id:leave.id,status:'approved',role:'admin',employeeId:other.id})).status,403);
 assert.equal((await act(actor,{action:'cancelLeave',id:leave.id})).status,200);
 const time=await ok(await op(actor,{action:'saveTime',date:'2026-01-05',minutes:60,project:'Synthetic QA',employeeId:other.id,role:'admin'}),'time');
 assert.equal(f.get('SELECT employee_id FROM time_entries WHERE id=?',time.id).employee_id,actor.id);
 assert.equal((await op(actor,{action:'submitTime',id:time.id})).status,200);
 assert.equal((await op(reviewer,{action:'reviewTime',id:time.id,status:'rejected',note:'Synthetic QA return'})).status,200);
 assert.equal((await op(actor,{action:'deleteTime',id:time.id})).status,200);
 assert.equal((await op(actor,{action:'acknowledgeDocument',id:'company-doc'})).status,200);
 assert.equal((await asUser(actor,()=>operations.GET())).status,200);
 const csv=summaryCsv(workforceRows(data.people,'Departments','real'),'Departments','real','2026-10-11');assert.ok(!csv.includes(actor.email));assert.ok(!csv.includes('PRIVATE-LEAVE-MARKER'));
 if(!hr){assert.equal((await act(actor,{action:'createEmployee',name:'Spoof',email:'spoof@example.invalid',title:'Tester',department:'Test',location:'Test',hireDate:'2026-01-01',role:'admin',user_id:'forged'})).status,403);assert.equal((await op(actor,{action:'saveAsset',name:'Spoof',tag:'SPOOF',category:'Test',role:'admin'})).status,403);}
});
for(let i=0;i<shapes.length;i++)test(`synthetic profile ${String(i+1).padStart(2,'0')}: inactive login and every module fail closed`,async()=>{
 const actor=people[i];f.run('UPDATE employees SET active=0 WHERE id=?',actor.id);f.document('private',actor.id);
 for(const call of [()=>state.GET(),()=>operations.GET(),()=>profiles.GET(fileRequest(actor.id),fileContext(actor.id)),()=>profiles.POST(jsonRequest({action:'update_personal',values:{bio:'blocked'}}),fileContext(actor.id)),()=>action.POST(jsonRequest({action:'requestLeave',type:'Vacation',startDate:'2026-11-04',endDate:'2026-11-04'})),()=>operations.POST(jsonRequest({action:'saveTime',date:'2026-01-05',minutes:60})),()=>files.POST(uploadRequest()),()=>file.GET(fileRequest('private'),fileContext('private')),()=>file.DELETE(fileRequest('private','DELETE'),fileContext('private'))])assert.equal((await asUser(actor,call)).status,403);
 assert.equal(f.get('SELECT active FROM employees WHERE id=?',actor.id).active,0);assert.equal(f.get('SELECT COUNT(*) n FROM time_entries').n,0);assert.equal(f.get('SELECT COUNT(*) n FROM leave_requests').n,0);
});
test('synthetic roster covers all26 current source field shapes without personal values',()=>{assert.equal(shapes.length,26);assert.equal(shapes.filter(p=>p.managerSourceId).length,25);assert.equal(shapes.filter(p=>!p.title).length,18);assert.equal(shapes.filter(p=>!p.location).length,15);assert.equal(shapes.filter(p=>!p.department).length,6);assert.equal(shapes.filter(p=>!p.division).length,10);for(const p of shapes)assert.match(p.email,/@example\.(invalid|test)$/);});
