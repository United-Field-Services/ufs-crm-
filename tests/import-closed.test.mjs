import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,asUser} from './harness.mjs';
const api=await import('../app/api/import/route.ts');
test('published one-time import endpoint remains unconditionally closed for service and every role',async()=>{const f=fixture();try{const before=f.get('SELECT COUNT(*) n FROM employees').n;for(const role of [null,'admin','hr_manager','manager','hiring_manager','employee']){const result=await asUser(role?{id:role,user_id:role,email:role+'@example.test',role,active:1}:null,()=>api.POST(new Request('https://ufs.example.test/api/import',{method:'POST',body:JSON.stringify({action:'apply',payload:{}})})));assert.equal(result.status,410);assert.match((await result.json()).error,/closed/i);assert.equal(result.headers.get('Cache-Control'),'no-store')}assert.equal(f.get('SELECT COUNT(*) n FROM employees').n,before)}finally{f.close()}});
