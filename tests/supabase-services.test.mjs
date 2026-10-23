// The Supabase side services: sign-in invitations (Supabase Auth admin API), file storage, and the email relay.
// Every network call is answered by a stand-in; nothing leaves the machine.
import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, asUser, jsonRequest } from './harness.mjs';

const action = await import('../app/api/action/route.ts');
const { supabaseBucket } = await import('../lib/supabase-storage.ts');
const { flushOutbox, mailEnabled, notify } = await import('../lib/notifications.ts');
const { SUPABASE_URL, SUPABASE_ISSUER } = await import('../lib/standalone-auth.ts');

const USER_ID = '7d4cf0c6-1f6e-4f3a-9a41-2f4c2b1a9e11';
let f, admin, hr, person;
beforeEach(() => {
  f = fixture();
  admin = f.employee('admin', { role: 'admin' });
  hr = f.employee('hr', { role: 'hr_manager' });
  person = f.employee('newbie', { user_id: null, email: 'Newbie@Example.test', name: 'New Bie' });
  Object.assign(f.env, { UFS_SUPABASE_URL: SUPABASE_URL, UFS_SUPABASE_SERVICE_KEY: 'service-key-for-tests', UFS_MAIL_RELAY: 'supabase', UFS_PUBLIC_URL: 'https://ufs.example.test' });
});
afterEach(() => { for (const key of ['UFS_SUPABASE_URL', 'UFS_SUPABASE_SERVICE_KEY', 'UFS_MAIL_RELAY', 'UFS_PUBLIC_URL']) delete f.env[key]; f.close(); });

const act = (who, body) => asUser(who, () => action.POST(jsonRequest(body)));
async function withFetch(handler, run) {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body }); return handler(String(url), init); };
  try { await run(calls); } finally { globalThis.fetch = original; }
}

test('inviting through Supabase Auth: account created without a password, bound with the Supabase issuer, email queued', async () => {
  await withFetch(() => Response.json({ id: USER_ID, email: 'newbie@example.test' }), async calls => {
    const response = await act(admin, { action: 'inviteEmployee', employeeId: person.id });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(calls[0].url, `${SUPABASE_URL}/auth/v1/admin/users`);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers.Authorization, 'Bearer service-key-for-tests');
    assert.equal(calls[0].headers.apikey, 'service-key-for-tests');
    assert.deepEqual(JSON.parse(calls[0].body), { email: 'newbie@example.test', email_confirm: true });
    assert.equal('password' in JSON.parse(calls[0].body), false, 'no password is ever sent');
  });
  const binding = f.get('SELECT * FROM employee_identities');
  assert.equal(binding.issuer, SUPABASE_ISSUER);
  assert.equal(binding.subject, USER_ID);
  assert.equal(binding.employee_id, person.id);
  assert.ok(f.get("SELECT 1 x FROM audit WHERE action = 'Invited to sign in'"));
});

test('an address that already has a Supabase account is never linked automatically', async () => {
  await withFetch(() => Response.json({ msg: 'exists' }, { status: 422 }), async calls => {
    const response = await act(admin, { action: 'inviteEmployee', employeeId: person.id });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /already has a sign-in account/);
    assert.equal(calls.length, 1, 'no account list was read to find one to attach');
  });
  assert.equal(f.rows('SELECT * FROM employee_identities').length, 0);
});

test('withdrawing removes the Supabase account before first sign-in', async () => {
  await withFetch(() => Response.json({ id: USER_ID }), async () => { assert.equal((await act(admin, { action: 'inviteEmployee', employeeId: person.id })).status, 200); });
  await withFetch(() => new Response('{}', { status: 200 }), async calls => {
    const response = await act(admin, { action: 'withdrawInvite', employeeId: person.id });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(calls[0].method, 'DELETE');
    assert.equal(calls[0].url, `${SUPABASE_URL}/auth/v1/admin/users/${USER_ID}`);
  });
  assert.equal(f.rows('SELECT * FROM employee_identities').length, 0);
});

test('a refusal from Supabase Auth leaves nothing half-made, and only the Super admin can invite', async () => {
  await withFetch(() => new Response('{}', { status: 500 }), async () => {
    assert.equal((await act(admin, { action: 'inviteEmployee', employeeId: person.id })).status, 502);
    assert.equal((await act(hr, { action: 'inviteEmployee', employeeId: person.id })).status, 403);
  });
  assert.equal(f.rows('SELECT * FROM employee_identities').length, 0);
});

test('the invite controls are off without the service key', async () => {
  delete f.env.UFS_SUPABASE_SERVICE_KEY;
  assert.equal((await act(admin, { action: 'inviteEmployee', employeeId: person.id })).status, 503);
});

test('file storage: private bucket, upsert, read, missing file and delete', async () => {
  const seen = [];
  const store = supabaseBucket('https://p.supabase.co', 'key', async (url, init) => {
    seen.push({ url, method: init.method || 'GET', headers: init.headers, body: init.body });
    if (url.endsWith('/missing')) return new Response('{"statusCode":"404"}', { status: 400 });
    if ((init.method || 'GET') === 'GET') return new Response(new Uint8Array([1, 2, 3]));
    return new Response('{}', { status: 200 });
  });
  await store.put('documents/emp one/file 1.txt', new Uint8Array([9, 8]), { httpMetadata: { contentType: 'text/plain' } });
  assert.equal(seen[0].url, 'https://p.supabase.co/storage/v1/object/ufs-files/documents/emp%20one/file%201.txt');
  assert.equal(seen[0].headers['x-upsert'], 'true');
  assert.equal(seen[0].headers['Content-Type'], 'text/plain');
  assert.equal(seen[0].headers.Authorization, 'Bearer key');
  assert.deepEqual([...new Uint8Array(await new Response((await store.get('documents/a')).body).arrayBuffer())], [1, 2, 3]);
  assert.equal(await store.get('documents/missing'), null);
  await store.delete('documents/a');
  assert.equal(seen.at(-1).method, 'DELETE');
  assert.deepEqual(JSON.parse(seen.at(-1).body), { prefixes: ['documents/a'] });
  const failing = supabaseBucket('https://p.supabase.co', 'key', async () => new Response('', { status: 500 }));
  await assert.rejects(failing.put('k', new Uint8Array([1])), /could not be stored/);
});

test('email relay: the Supabase Edge Function receives the message with the service key', async () => {
  assert.equal(mailEnabled(), true);
  await notify({ recipients: person.id, kind: 'task_assigned', title: 'New task: X', body: 'Soon', link: '/tasks', dedupeKey: 'r1' });
  await withFetch(() => Response.json({ ok: true }), async calls => {
    assert.equal(await flushOutbox(), 1);
    assert.equal(calls[0].url, `${SUPABASE_URL}/functions/v1/send-mail`);
    assert.equal(calls[0].headers.Authorization, 'Bearer service-key-for-tests');
    assert.equal(JSON.parse(calls[0].body).to, 'Newbie@Example.test');
  });
  assert.equal(f.get('SELECT status FROM email_outbox').status, 'sent');
  delete f.env.UFS_MAIL_RELAY;
  assert.equal(mailEnabled(), false, 'without the relay setting and the Convex secret no email is attempted');
});
