// Synthetic in-memory backend fail-safes. No live identities, data or services.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,asUser,jsonRequest,fileContext} from './harness.mjs';
const profiles=await import('../app/api/profiles/[id]/route.ts');
const actions=await import('../app/api/action/route.ts');
const snapshot=f=>JSON.stringify({identifiers:f.rows('SELECT * FROM employee_identifiers ORDER BY id'),entitlements:f.rows('SELECT * FROM entitlements ORDER BY id'),audit:f.rows('SELECT * FROM audit ORDER BY id')});
const identifier={type:'Passport',country:'Synthetic country',status:'Recorded',last4:'A123'};
for(const last4 of ['ABCDE','SYNTHETICFULL12345','123','12-4','😀123',1234,{value:'A123'}])test(`identifier fail-safe rejects malformed suffix ${JSON.stringify(last4)} with no record or audit write`,async t=>{
 const f=fixture();t.after(()=>f.close());const actor=f.employee('synthetic-employee');const before=snapshot(f);
 const result=await asUser(actor,()=>profiles.POST(jsonRequest({action:'save_identifier',identifier:{...identifier,last4}}),fileContext(actor.id)));
 assert.equal(result.status,400,await result.clone().text());assert.equal(snapshot(f),before);const payload=await result.json();if(typeof last4==='string'&&last4.length>4)assert.ok(!JSON.stringify(payload).includes(last4));
});
for(const field of ['vacation','sick','wfh','bereavement'])for(const total of [-1,0.1,365.125,''])test(`allowance server rejects ${field}=${JSON.stringify(total)} atomically and preserves the saved 2027 budget`,async t=>{
 const f=fixture();t.after(()=>f.close());const hr=f.employee('synthetic-hr',{role:'hr_manager'}),employee=f.employee('synthetic-employee');
 const body={action:'updateBudgets',employeeId:employee.id,year:2027,vacation:24,sick:8,wfh:35,bereavement:6};
 const first=await asUser(hr,()=>actions.POST(jsonRequest(body)));assert.equal(first.status,200,await first.clone().text());const before=snapshot(f);
 const result=await asUser(hr,()=>actions.POST(jsonRequest({...body,[field]:total})));assert.equal(result.status,400,await result.clone().text());assert.equal(snapshot(f),before);
});
test('allowance server retains zero and exact eighth-day support for 2027 without changing 2026',async t=>{
 const f=fixture();t.after(()=>f.close());const hr=f.employee('synthetic-hr',{role:'hr_manager'}),employee=f.employee('synthetic-employee');
 const body={action:'updateBudgets',employeeId:employee.id,year:2026,vacation:15,sick:5,wfh:30,bereavement:3};
 assert.equal((await asUser(hr,()=>actions.POST(jsonRequest(body)))).status,200);const before=f.rows('SELECT type,total FROM entitlements WHERE year=2026 ORDER BY type');
 const result=await asUser(hr,()=>actions.POST(jsonRequest({...body,year:2027,vacation:0,sick:0.125,wfh:1.5,bereavement:365})));assert.equal(result.status,200,await result.clone().text());assert.deepEqual(f.rows('SELECT type,total FROM entitlements WHERE year=2026 ORDER BY type'),before);assert.deepEqual(f.rows('SELECT type,total FROM entitlements WHERE year=2027 ORDER BY type').map(row=>({...row})),[{type:'Bereavement',total:365},{type:'Sick Leave',total:0.125},{type:'Vacation',total:0},{type:'WFH',total:1.5}]);
});
