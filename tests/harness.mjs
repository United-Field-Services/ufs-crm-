// Test-only Worker adapters. Policy and SQL run unchanged. QA business-route
// fixtures explicitly replace principal acquisition; real auth has separate tests.
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('../', import.meta.url));
const context = new AsyncLocalStorage();
const globals = { env: {}, context };
globalThis.__ufsSecurityTest = globals;

registerHooks({
  resolve(specifier, ctx, next) {
    if (specifier === 'cloudflare:workers') return { url: 'ufs-test:workers', shortCircuit: true };
    if (specifier === 'next/headers') return { url: 'ufs-test:headers', shortCircuit: true };
    if (specifier === 'next/navigation') return { url: 'ufs-test:navigation', shortCircuit: true };
    try { return next(specifier, ctx); } catch (error) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, ctx);
      throw error;
    }
  },
  load(url, ctx, next) {
    const mocks = {
      'ufs-test:workers': 'export const env = globalThis.__ufsSecurityTest.env;',
      'ufs-test:headers': 'export async function headers() { return globalThis.__ufsSecurityTest.context.getStore() || new Headers(); }',
      'ufs-test:navigation': 'export function redirect(url) { throw new Error(`Redirect: ${url}`); }',
    };
    if (url in mocks) return { format: 'module', source: mocks[url], shortCircuit: true };
    if (url.startsWith('file:') && fileURLToPath(url).startsWith(root) && url.endsWith('.ts')) {
      let source = readFileSync(new URL(url), 'utf8');
      // Authorization-fixture injection ONLY in the local Node loader. Production
      // server.ts has no QA-header bypass. Genuine standalone QA authentication,
      // exact provider UUIDs and disabled-by-default access are tested separately.
      // Route-boundary tests use a fresh DB principal, never a copied actor role.
      if (url.endsWith('/lib/server.ts')) source = source.replace(
        'export async function currentEmployee():Promise<Employee>{',
        `export async function currentEmployee():Promise<Employee>{
 const syntheticHeaders=globalThis.__ufsSecurityTest.context.getStore();
 const syntheticId=syntheticHeaders?.get('x-ufs-synthetic-qa-principal');
 if(syntheticId){
  const syntheticActor=await first<Employee>(\`SELECT * FROM employees WHERE id=? AND user_id IS ? AND data_scope='qa-bots-v1' AND \${loginEligibleSql('employees')}\`,syntheticId,syntheticHeaders.get('oai-authenticated-user-id'));
  if(!syntheticActor||!isEmployeeRole(syntheticActor.role))throw new AppError('Synthetic QA principal is unavailable.',403);
  return syntheticActor;
 }
`);
      return { format: 'module', source: stripTypeScriptTypes(source, { mode: 'transform' }), shortCircuit: true };
    }
    return next(url, ctx);
  },
});

// Used before the builder generates migrations. Prefer the real migration once available.
const fallbackSchema = `
CREATE TABLE employees (id TEXT PRIMARY KEY,user_id TEXT UNIQUE,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,title TEXT NOT NULL,department TEXT NOT NULL,location TEXT NOT NULL,employment TEXT NOT NULL,hire_date TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'employee',active INTEGER NOT NULL DEFAULT 1,annual_allowance REAL NOT NULL DEFAULT 15,sick_allowance REAL NOT NULL DEFAULT 5,wfh_allowance REAL NOT NULL DEFAULT 30,bereavement_allowance REAL NOT NULL DEFAULT 3,demo INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE leave_requests (id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),type TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,days REAL NOT NULL,year INTEGER NOT NULL,note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,reviewed_at TEXT,reviewer_id TEXT,review_note TEXT NOT NULL DEFAULT '');
CREATE TABLE documents (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES employees(id),name TEXT NOT NULL,object_key TEXT NOT NULL UNIQUE,category TEXT NOT NULL,visibility TEXT NOT NULL DEFAULT 'personal',mime TEXT NOT NULL,size INTEGER NOT NULL,uploaded_at TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE events (id TEXT PRIMARY KEY,title TEXT NOT NULL,date TEXT NOT NULL,kind TEXT NOT NULL,location TEXT NOT NULL DEFAULT 'All locations',created_by TEXT NOT NULL,demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE audit (id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE tasks (id TEXT PRIMARY KEY,title TEXT NOT NULL,assignee_id TEXT NOT NULL REFERENCES employees(id),related_employee_id TEXT,due_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_by TEXT NOT NULL,created_at TEXT NOT NULL,demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE entitlements (id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),year INTEGER NOT NULL,type TEXT NOT NULL,total REAL NOT NULL,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL);
ALTER TABLE employees ADD manager_id TEXT;
ALTER TABLE leave_requests ADD required_manager_id TEXT;
ALTER TABLE leave_requests ADD attachment_id TEXT;
`;

export function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrations = readdirSync(`${root}/drizzle`).filter(name => name.endsWith('.sql')).sort();
  if (migrations.length) for (const name of migrations) sqlite.exec(readFileSync(`${root}/drizzle/${name}`, 'utf8'));
  else sqlite.exec(fallbackSchema);
  const storage = new Map();
  const bucketReads = [];
  // With UFS_CAPTURE_SQL=<file>, every statement the app runs is written there; tests/postgres-translation.test.mjs replays them on Postgres.
  const capture = (sql, args) => { if (process.env.UFS_CAPTURE_SQL) appendFileSync(process.env.UFS_CAPTURE_SQL, JSON.stringify({ sql, args }) + '\n'); };
  function prepare(sql) {
    let args = [];
    return {
      sql, // Test-only statement metadata for pausing before an atomic D1 batch.
      bind(...values) { args = values; return this; },
      async all() { capture(sql, args); return { results: sqlite.prepare(sql).all(...args) }; },
      async first() { capture(sql, args); return sqlite.prepare(sql).get(...args) || null; },
      async run() { capture(sql, args); const result = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
  }
  // D1 serializes transactional batches. Queue batches so concurrency tests do not
  // create impossible nested SQLite BEGINs while retaining async statement hooks.
  let batchTail = Promise.resolve();
  globals.env.DB = {
    prepare,
    batch(statements) {
      const result = batchTail.then(async () => {
        sqlite.exec('BEGIN');
        try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      });
      batchTail = result.catch(() => {});
      return result;
    },
  };
  globals.env.BUCKET = {
    async put(key, bytes) { storage.set(key, new Uint8Array(bytes)); },
    async get(key) { bucketReads.push(key); return storage.has(key) ? { body: storage.get(key) } : null; },
    async delete(key) { storage.delete(key); },
  };
  globals.env.UFS_OWNER_EMAIL = 'owner@example.test';
  const run = (sql, ...args) => sqlite.prepare(sql).run(...args);
  const get = (sql, ...args) => sqlite.prepare(sql).get(...args);
  const rows = (sql, ...args) => sqlite.prepare(sql).all(...args);
  const employee = (id, overrides = {}) => {
    const values = { id, user_id: `identity-${id}`, email: `${id}@example.test`, name: `Test ${id}`, title: 'Tester', department: 'Test Department', location: 'United States', employment: 'Full-Time', hire_date: '2025-01-01', role: 'employee', active: 1, manager_id: null, annual_allowance: 15, sick_allowance: 5, wfh_allowance: 30, bereavement_allowance: 3, demo: 0, created_at: '2026-01-01T00:00:00Z', ...overrides };
    run(`INSERT INTO employees (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`, ...Object.values(values));
    return values;
  };
  const leave = (id, employeeId, overrides = {}) => {
    const values = { data_scope: get('SELECT data_scope FROM employees WHERE id=?', employeeId)?.data_scope ?? 'live', id, employee_id: employeeId, type: 'Vacation', start_date: '2026-11-02', end_date: '2026-11-02', days: 1, year: 2026, note: 'Private fixture note', status: 'pending', created_at: '2026-01-01T00:00:00Z', required_manager_id: get('SELECT manager_id FROM employees WHERE id = ?', employeeId)?.manager_id ?? null, attachment_id: null, ...overrides };
    run(`INSERT INTO leave_requests (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`, ...Object.values(values));
    return values;
  };
  const document = (id, ownerId, overrides = {}) => {
    const ownerScope = get('SELECT data_scope FROM employees WHERE id=?', ownerId)?.data_scope ?? 'live';
    const values = { data_scope: ownerScope, id, owner_id: ownerId, name: `${id}.txt`, object_key: `${ownerScope === 'qa-bots-v1' ? 'test/qa-bots-v1/' : ''}documents/${ownerId}/${id}`, category: 'General', visibility: 'personal', mime: 'text/plain', size: 12, uploaded_at: '2026-01-01T00:00:00Z', archived: 0, ...overrides };
    run(`INSERT INTO documents (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`, ...Object.values(values));
    storage.set(values.object_key, new TextEncoder().encode(`content of ${id}`));
    return values;
  };
  return { sqlite, env: globals.env, storage, bucketReads, run, get, rows, employee, leave, document, close: () => sqlite.close() };
}

export const origin = 'https://ufs.example.test';
export function asUser(employee, callback) {
  const headers = new Headers();
  if (employee) {
    headers.set('oai-authenticated-user-id', employee.user_id ?? employee.userId);
    headers.set('oai-authenticated-user-email', employee.email);
    // This header exists solely in the local source-loader fixture above. It is
    // deliberately not consumed by any shipped application authentication code.
    if (employee.data_scope === 'qa-bots-v1') headers.set('x-ufs-synthetic-qa-principal', employee.id);
  }
  return context.run(headers, callback);
}
export const jsonRequest = (body, headers = {}) => new Request(`${origin}/api/action`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
export function uploadRequest(name = 'example.txt', bytes = 'example text', fields = {}) {
  const form = new FormData();
  form.set('file', new File([bytes], name));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request(`${origin}/api/files`, { method: 'POST', headers: { Origin: origin }, body: form });
}
export const fileContext = id => ({ params: Promise.resolve({ id }) });
export const fileRequest = (id, method = 'GET', headers = {}) => new Request(`${origin}/api/files/${id}`, { method, headers: { Origin: origin, ...headers } });
