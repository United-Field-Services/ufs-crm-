// Extra T053 coverage for the exported build. Synthetic, isolated in-memory DB only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,asUser,jsonRequest,origin} from './harness.mjs';
const state=await import('../app/api/state/route.ts');
const action=await import('../app/api/action/route.ts');
const read=(actor,year)=>asUser(actor,()=>state.GET(new Request(origin+'/api/state?year='+year)));
const act=(actor,body)=>asUser(actor,()=>action.POST(jsonRequest(body)));
async function ok(response){assert.equal(response.status,200,await response.clone().text());return response.json()}
for(const role of ['hr_manager','admin'])test(`T053 ${role}: 2027 approval is visible to employee and HR, spends once, and leaves 2026 unchanged`,async t=>{
 const f=fixture();t.after(()=>f.close());
 const reviewer=f.employee('synthetic-reviewer',{role,data_scope:'qa-bots-v1'});
 const employee=f.employee('synthetic-requester',{manager_id:reviewer.id,data_scope:'qa-bots-v1'});
 for(const [year,total] of [[2026,9],[2027,12]]) await ok(await act(reviewer,{action:'updateBudgets',employeeId:employee.id,year,vacation:total,sick:5,wfh:30,bereavement:3}));
 const before=await ok(await read(employee,2026));
 const req=await ok(await act(employee,{action:'requestLeave',type:'Vacation',startDate:'2027-06-01',endDate:'2027-06-01'}));
 const pending=await ok(await read(employee,2027));
 assert.deepEqual(pending.balances.find(b=>b.type==='Vacation'),{type:'Vacation',total:12,used:0,pending:1});
 await ok(await act(reviewer,{action:'reviewLeave',id:req.id,status:'approved'}));
 const after=await ok(await read(employee,2027));
 assert.deepEqual(after.balances.find(b=>b.type==='Vacation'),{type:'Vacation',total:12,used:1,pending:0});
 assert.equal(after.requests.find(r=>r.id===req.id).status,'approved');
 const hr=await ok(await read(reviewer,2027));
 assert.equal(hr.requests.find(r=>r.id===req.id).status,'approved');
 assert.equal(hr.requests.find(r=>r.id===req.id).days,1);
 assert.equal(hr.employeeBudgets.find(b=>b.employee_id===employee.id&&b.year===2027&&b.type==='Vacation').total,12);
 assert.equal((await act(reviewer,{action:'reviewLeave',id:req.id,status:'approved'})).status,409);
 assert.deepEqual((await ok(await read(employee,2027))).balances,after.balances);
 assert.deepEqual((await ok(await read(employee,2026))).balances,before.balances);
 assert.equal(f.rows("SELECT * FROM audit WHERE action='Approved time off'").length,1);
});
