import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,asUser,origin} from './harness.mjs';
const {POST}=await import('../app/api/photo-import/route.ts');
test('completed photo import is closed for service, anonymous and admin callers without touching storage',async()=>{const f=fixture();try{const admin=f.employee('viewer',{role:'admin'});for(const viewer of [null,admin]){const res=await asUser(viewer,()=>POST(new Request(`${origin}/api/photo-import`,{method:'POST',body:JSON.stringify({action:'apply',payload:{}})})));assert.equal(res.status,410);assert.deepEqual(await res.json(),{error:'The one-time profile photo import is closed.'});assert.equal(res.headers.get('cache-control'),'no-store');}assert.equal(f.storage.size,0);assert.equal(f.bucketReads.length,0);assert.equal(f.get('SELECT COUNT(*) n FROM employee_photos').n,0);assert.equal(f.get('SELECT COUNT(*) n FROM migration_batches').n,0);}finally{f.close()}});
test('closed photo route does not import a database, R2 or temporary handler',()=>{const source=readFileSync(new URL('../app/api/photo-import/route.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/^import\s/m);assert.doesNotMatch(source,/handlePhotoImport|applyPhotoImport|bucket\(/);});
