import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,asUser,jsonRequest,origin} from './harness.mjs';
const state=await import('../app/api/state/route.ts');
const action=await import('../app/api/action/route.ts');
const businessYear=Number(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric'}).format(new Date()));
const read=(actor,query='')=>asUser(actor,()=>state.GET(new Request(origin+'/api/state'+query)));
const act=(actor,body)=>asUser(actor,()=>action.POST(jsonRequest(body)));
async function ok(response){assert.equal(response.status,200,await response.clone().text());return response.json()}
function budget(f,actor,year,total){f.run('INSERT INTO entitlements(id,employee_id,year,type,total,updated_by,updated_at,data_scope) VALUES(?,?,?,?,?,?,?,?)',`${actor.id}:${year}:Vacation`,actor.id,year,'Vacation',total,actor.id,'2026-01-01',actor.data_scope??'live')}
for(const scope of ['live','qa-bots-v1'])test(`${scope}: selected year separates totals and request usage without leaking another employee or scope`,async t=>{
 const f=fixture();t.after(()=>f.close());const actor=f.employee('employee',{data_scope:scope}),peer=f.employee('peer',{data_scope:scope}),other=f.employee('other',{data_scope:scope==='live'?'qa-bots-v1':'live'});
 budget(f,actor,2026,19);budget(f,actor,2027,24);budget(f,peer,2027,222);budget(f,other,2027,333);
 for(const [id,person,year,status,days]of [['old',actor,2026,'approved',3],['next-approved',actor,2027,'approved',4],['next-pending',actor,2027,'pending',2],['cancelled',actor,2027,'cancelled',9],['rejected',actor,2027,'rejected',8],['peer',peer,2027,'approved',10],['other',other,2027,'approved',11]])f.leave(id,person.id,{year,start_date:`${year}-06-01`,end_date:`${year}-06-01`,status,days,data_scope:person.data_scope});
 const old=await ok(await read(actor,'?year=2026')),next=await ok(await read(actor,'?year=2027'));
 assert.equal(old.year,2026);assert.equal(next.year,2027);assert.equal(next.currentYear,businessYear);assert.deepEqual(old.balances.find(b=>b.type==='Vacation'),{type:'Vacation',total:19,used:3,pending:0});assert.deepEqual(next.balances.find(b=>b.type==='Vacation'),{type:'Vacation',total:24,used:4,pending:2});assert.ok(next.requests.every(r=>r.employee_id===actor.id));assert.equal(next.employeeBudgets.length,0);
 const defaults=await ok(await read(actor,'?year=2028'));assert.deepEqual(defaults.balances.find(b=>b.type==='Vacation'),{type:'Vacation',total:15,used:0,pending:0});assert.equal((await ok(await read(actor))).year,businessYear);
});
for(const value of ['2019','2101','2026.5','not-a-year','','2027e0','02027','2026&year=2027'])test(`invalid balance year ${JSON.stringify(value)} is rejected`,async t=>{const f=fixture();t.after(()=>f.close());const actor=f.employee('employee');assert.equal((await read(actor,'?year='+value)).status,400)});
test('selected-year state uses the same final identity revocation guard',async t=>{const f=fixture();t.after(()=>f.close());const actor=f.employee('actor',{role:'hr_manager'}),prepare=f.env.DB.prepare;let changed=false;f.env.DB.prepare=sql=>{const statement=prepare(sql);if(/SELECT sha256 FROM employee_photos/.test(sql)){const run=statement.first;statement.first=async()=>{const result=await run();changed=true;f.run('UPDATE employees SET active=0 WHERE id=?',actor.id);return result}}return statement};const response=await read(actor,'?year=2027');assert.ok(changed);assert.equal(response.status,403);assert.equal('balances' in await response.json(),false)});
test('viewing another year never changes the year used for request approval or allowances',async t=>{
 const f=fixture();t.after(()=>f.close());const hr=f.employee('hr',{role:'hr_manager'}),employee=f.employee('employee',{manager_id:hr.id});budget(f,employee,2026,0);budget(f,employee,2027,1);
 await ok(await read(employee,'?year=2026'));const request=await ok(await act(employee,{action:'requestLeave',type:'Vacation',startDate:'2027-06-01',endDate:'2027-06-01'}));assert.equal(f.get('SELECT year FROM leave_requests WHERE id=?',request.id).year,2027);
 await ok(await act(hr,{action:'reviewLeave',id:request.id,status:'approved'}));const updated=await ok(await read(employee,'?year=2027'));assert.equal(updated.balances.find(b=>b.type==='Vacation').used,1);assert.equal(f.get('SELECT total FROM entitlements WHERE employee_id=? AND year=?',employee.id,2026).total,0);
});
test('saving one allowance year leaves all four values in the other year unchanged',async t=>{
 const f=fixture();t.after(()=>f.close());const hr=f.employee('hr',{role:'hr_manager'}),employee=f.employee('employee');
 const payload={action:'updateBudgets',employeeId:employee.id,vacation:20,sick:6,wfh:31,bereavement:4};await ok(await act(hr,{...payload,year:2026}));await ok(await act(hr,{...payload,year:2027,vacation:25,sick:7,wfh:32,bereavement:5}));
 const before=f.rows('SELECT type,total FROM entitlements WHERE employee_id=? AND year=2026 ORDER BY type',employee.id);await ok(await act(hr,{...payload,year:2027,vacation:26,sick:7,wfh:32,bereavement:5}));assert.deepEqual(f.rows('SELECT type,total FROM entitlements WHERE employee_id=? AND year=2026 ORDER BY type',employee.id),before);assert.equal(f.get('SELECT total FROM entitlements WHERE employee_id=? AND year=2027 AND type=?',employee.id,'Sick Leave').total,7);
});
