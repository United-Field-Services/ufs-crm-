// Release gate: application-private sources and recorded data may not enter browser assets.
// This is an explicit invariant check, not a general data-loss prevention scanner.
import {readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),client=resolve(root,'dist/client');
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(resolve(dir,entry.name)):[resolve(dir,entry.name)])}
const privateFiles=['lib/hr-report.ts','lib/server.ts','lib/profiles.ts','lib/photos.ts','lib/demo.ts','lib/standalone-auth.ts','lib/auth-provider.ts','lib/convex-auth.ts','lib/convex-recovery.ts','lib/password-recovery.ts','lib/test-scope-setup.ts','db/auth-schema.ts'];
const sourceFiles=[...walk(resolve(root,'app')),...walk(resolve(root,'lib'))].filter(path=>/\.[cm]?[jt]sx?$/.test(path));
function imports(path){const code=readFileSync(path,'utf8'),result=[];for(const match of code.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+)\1/g)){const base=resolve(dirname(path),match[2]),found=['','.ts','.tsx','.mjs','.mts','/index.ts','/index.tsx'].map(ext=>base+ext).find(p=>existsSync(p)&&statSync(p).isFile());if(found)result.push(found)}return result}
function graph(path,seen=new Set()){if(seen.has(path))return seen;seen.add(path);for(const child of imports(path))graph(child,seen);return seen}
for(const path of sourceFiles){if(/^\s*['"]use client['"];/.test(readFileSync(path,'utf8'))){const reachable=graph(path);for(const privateFile of privateFiles)assert.ok(!reachable.has(resolve(root,privateFile)),`${relative(root,path)} imports private ${privateFile}`)}}
assert.ok(existsSync(client),'Build dist/client before the asset audit');
const forbidden=[/unitedffs\.talenthr\.io/,/UFS_OWNER_EMAIL/,/UFS_SUPABASE_/,/UFS_QA_/,/1ce902e2-5c60-40fd-96b3-1ae14478f5e7/,/qa_provisioning_checks/,/employee_identities/,/auth_sessions/,/auth_session_tokens/,/ufs_session_is_active/,/sb_secret_/,/service_role/,/source_employee_links/,/source_hr_settings/,/oai-authenticated-user-(?:id|email)/,/Oct 25["']?\s*,\s*19/,/19\s*,\s*19\s*,\s*19\s*,\s*19\s*,\s*19\s*,\s*21/];
const files=walk(client);
for(const path of files){const name=relative(client,path);assert.doesNotMatch(name,/(?:^|\/)(?:\.env|\.git|node_modules|tests|drizzle|lib|db)(?:\/|$)|\.(?:sqlite|sqlite3|db|map|pem|key|sql|tar|gz)$/i,`Private or debug asset: ${name}`);if(/\.(?:js|css|html|json|svg|txt|webmanifest)$/i.test(name)){const body=readFileSync(path,'utf8');for(const pattern of forbidden)assert.ok(!pattern.test(body),`Private marker ${pattern} found in ${name}`)}}
console.log(`Public-asset audit passed: ${files.length} assets; ${sourceFiles.length} source modules checked.`);
