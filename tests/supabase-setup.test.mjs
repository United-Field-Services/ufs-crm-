// The Supabase setup helper (scripts/supabase-setup.mjs) run for real against a local stand-in for the project:
// an HTTP server that answers like Supabase and keeps its data in an in-process Postgres.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const file = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const SERVICE = 'service-key-for-tests', PUBLIC = 'public-key-for-tests';
let pg, server, url;
const users = [];

before(async () => {
  pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role;');
  await pg.exec(file('supabase/schema.sql'));
  await pg.exec(file('supabase/executor.sql'));
  await pg.exec("insert into ufs.employees (id,email,name,title,department,location,employment,hire_date,role,created_at) values ('boss1','boss@example.test','The Boss','t','d','l','Full-Time','2026-01-01','admin','2026-01-01')");
  server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const key = (request.headers.authorization || '').replace('Bearer ', '');
    const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (key !== SERVICE) return send(request.url.startsWith('/rest/v1/employees') || request.url.includes('ufs_batch') ? 401 : 403, { message: 'denied' });
    if (request.url.startsWith('/rest/v1/rpc/ufs_batch')) {
      try { const { rows } = await pg.query('select public.ufs_batch($1::jsonb) r', [JSON.stringify(JSON.parse(body).statements)]); return send(200, rows[0].r); }
      catch (error) { return send(400, { message: error.message }); }
    }
    if (request.url.startsWith('/storage/v1/bucket/ufs-files')) return send(200, { id: 'ufs-files', public: false });
    if (request.url.startsWith('/auth/v1/admin/users') && request.method === 'GET') return send(200, { users });
    if (request.url.startsWith('/auth/v1/admin/users') && request.method === 'POST') { const email = JSON.parse(body).email; if (users.some(user => user.email === email)) return send(422, { msg: 'email_exists' }); const user = { id: '11111111-2222-4333-8444-555555555555', email }; users.push(user); return send(200, user); }
    if (request.url.startsWith('/functions/v1/send-mail')) return send(400, { error: 'Invalid address' });
    send(404, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); });

const exec = (args, env) => new Promise(resolve => execFile(process.execPath, ['scripts/supabase-setup.mjs', ...args], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, ...env } }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, out: stdout + stderr })));
const run = (...args) => {
  // The local server is plain HTTP; the helper only allows that when UFS_SETUP_TEST=1.
  return exec(args, { UFS_SETUP_TEST: '1', UFS_SUPABASE_URL: url, UFS_SUPABASE_SERVICE_KEY: SERVICE, UFS_SUPABASE_PUBLISHABLE_KEY: PUBLIC });
};

test('check: confirms the database function, private bucket, auth and the locked-down public key', async () => {
  const result = await run('check');
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /database function works \(1 employees/);
  assert.match(result.out, /bucket 'ufs-files' exists and is private/);
  assert.match(result.out, /Auth admin access works/);
  assert.match(result.out, /public key cannot read employee data/);
  assert.match(result.out, /public key cannot call the database function/);
  assert.doesNotMatch(result.out, new RegExp(SERVICE), 'the service key is never printed');
});

test('first-admin: creates the sign-in without a password and binds it to the administrator profile', async () => {
  const result = await run('first-admin', '--email', 'Boss@Example.test');
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /is the first administrator/);
  const binding = (await pg.query('select issuer, subject, employee_id, enabled from ufs.employee_identities')).rows[0];
  assert.equal(binding.employee_id, 'boss1');
  assert.equal(binding.subject, '11111111-2222-4333-8444-555555555555');
  assert.equal(binding.issuer, `${url}/auth/v1`);
  assert.equal(Number(binding.enabled), 1);
  const again = await run('first-admin', '--email', 'boss@example.test');
  assert.notEqual(again.code, 0, 'the account now exists, so a second run is refused rather than attaching again');
  assert.match(again.out, /already has a Supabase sign-in account/);
  assert.equal((await pg.query("select count(*)::int n from ufs.employee_identities where employee_id = 'boss1'")).rows[0].n, 1, 'still bound once');
});

test('first-admin will not attach to an account that already exists unless told to', async () => {
  users.push({ id: '99999999-2222-4333-8444-555555555555', email: 'other@example.test' });
  await pg.exec("insert into ufs.employees (id,email,name,title,department,location,employment,hire_date,role,created_at) values ('boss2','other@example.test','Other Admin','t','d','l','Full-Time','2026-01-01','admin','2026-01-01')");
  const refused = await run('first-admin', '--email', 'other@example.test');
  assert.notEqual(refused.code, 0);
  assert.match(refused.out, /already has a Supabase sign-in account/);
  assert.equal((await pg.query("select count(*)::int n from ufs.employee_identities where employee_id = 'boss2'")).rows[0].n, 0, 'nothing was attached');
  const linked = await run('first-admin', '--email', 'other@example.test', '--link-existing');
  assert.equal(linked.code, 0, linked.out);
  assert.equal((await pg.query("select subject from ufs.employee_identities where employee_id = 'boss2'")).rows[0].subject, '99999999-2222-4333-8444-555555555555');
});

test('first-admin refuses an address with no administrator profile, and everything refuses without the key', async () => {
  assert.notEqual((await run('first-admin', '--email', 'nobody@example.test')).code, 0);
  const noKey = await exec(['check'], { UFS_SUPABASE_SERVICE_KEY: '' });
  assert.notEqual(noKey.code, 0);
  assert.match(noKey.out, /UFS_SUPABASE_SERVICE_KEY/);
});
