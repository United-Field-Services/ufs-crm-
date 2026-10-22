// Regression tests for the October 2026 QA report (UFS-01 to UFS-15).
import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fixture, asUser, jsonRequest, uploadRequest, fileContext, fileRequest, origin } from './harness.mjs';
import { d1Bucket } from '../lib/d1-storage.ts';
import { SECTION_PATHS, sectionForPath, sectionPath } from '../lib/sections.ts';

const action = await import('../app/api/action/route.ts');
const profiles = await import('../app/api/profiles/[id]/route.ts');
const files = await import('../app/api/files/route.ts');
const file = await import('../app/api/files/[id]/route.ts');
let f, owner, hr;
beforeEach(() => { f = fixture(); owner = f.employee('owner', { role: 'admin' }); hr = f.employee('hr', { role: 'hr_manager' }); });
afterEach(() => f.close());
const act = (who, body) => asUser(who, () => action.POST(jsonRequest(body)));
const readProfile = (who, id) => asUser(who, () => profiles.GET(new Request(`${origin}/api/profiles/${id}`), fileContext(id)));
const hire = (overrides = {}) => ({ action: 'createEmployee', name: 'New Hire', email: 'new-hire@example.test', title: 'Tester', department: 'Operations', location: 'United States', hireDate: new Date().toISOString().slice(0, 10), ...overrides });
const row = () => f.get('SELECT * FROM employees WHERE email = ?', 'new-hire@example.test');

test('UFS-01: a duplicate email is refused with a readable message', async () => {
  assert.equal((await act(owner, hire())).status, 200);
  const again = await act(owner, hire());
  assert.equal(again.status, 409);
  assert.match((await again.json()).error, /already uses that email/i);
});

test('UFS-08: names and titles over 100 characters are refused', async () => {
  assert.equal((await act(owner, hire({ name: 'X'.repeat(101) }))).status, 400);
  assert.equal((await act(owner, hire({ title: 'T'.repeat(101) }))).status, 400);
  assert.equal(row(), undefined);
});

test('UFS-08: a hire date years ahead is refused, a near start date is allowed', async () => {
  const refused = await act(owner, hire({ hireDate: '2099-01-01' }));
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /year ahead/i);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  assert.equal((await act(owner, hire({ hireDate: soon }))).status, 200);
});

test('UFS-08: a new person starts in their department division and has no login yet', async () => {
  assert.equal((await act(hr, hire())).status, 200);
  const created = row();
  assert.equal(f.get('SELECT division FROM employee_profiles WHERE employee_id = ?', created.id).division, 'Operations');
  const body = await (await readProfile(hr, created.id)).json();
  assert.equal(body.profile.login_bound, false);
  f.run("INSERT INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) VALUES ('i1','https://x.convex.site','sub1',?,1,'2026-01-01','test')", created.id);
  assert.equal((await (await readProfile(hr, created.id)).json()).profile.login_bound, true);
});

test('UFS-08: only HR is told whether a person can sign in', async () => {
  const peer = f.employee('peer');
  const body = await (await readProfile(peer, owner.id)).json();
  assert.equal('login_bound' in body.profile, false);
});

test('UFS-09: LinkedIn only accepts https linkedin.com addresses', async () => {
  for (const bad of ['javascript:alert(1)', 'http://linkedin.com/in/x', 'https://evil.example/linkedin.com']) {
    const response = await asUser(owner, () => profiles.POST(jsonRequest({ action: 'update_personal', values: { linkedin: bad } }), fileContext(owner.id)));
    assert.equal(response.status, 400, bad);
  }
  const ok = await asUser(owner, () => profiles.POST(jsonRequest({ action: 'update_personal', values: { linkedin: 'https://www.linkedin.com/in/someone' } }), fileContext(owner.id)));
  assert.equal(ok.status, 200);
});

test('UFS-02: an end date before the start date is refused with a message the dialog can show', async () => {
  const response = await act(owner, { action: 'requestLeave', type: 'Vacation', startDate: '2026-11-10', endDate: '2026-11-05', hours: 8 });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /end date/i);
});

test('UFS-03: every section has its own address and a page for it', () => {
  assert.equal(sectionPath('People'), '/people');
  assert.equal(sectionForPath('/people'), 'People');
  assert.equal(sectionForPath('/people/'), 'People');
  assert.equal(sectionForPath('/'), 'Overview');
  assert.equal(sectionForPath('/nope'), null);
  for (const [section, path] of Object.entries(SECTION_PATHS)) {
    const file = path === '/' ? 'app/page.tsx' : `app${path}/page.tsx`;
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${section} needs ${file}`);
  }
});

test('UFS-16: files are stored in the database when no R2 bucket is bound', async () => {
  const bytes = new Uint8Array(2_600_000).map((_, index) => (index * 31) % 251);
  const store = d1Bucket(f.env.DB);
  await store.put('documents/x/one', bytes);
  const back = new Uint8Array(await new Response((await store.get('documents/x/one')).body).arrayBuffer());
  assert.equal(back.length, bytes.length);
  assert.ok(back.every((value, index) => value === bytes[index]));
  assert.ok(f.get('SELECT COUNT(*) n FROM file_chunks').n >= 4, 'large files use several rows');
  await store.put('documents/x/one', new Uint8Array([1, 2, 3]));
  assert.deepEqual([...new Uint8Array(await new Response((await store.get('documents/x/one')).body).arrayBuffer())], [1, 2, 3]);
  await store.delete('documents/x/one');
  assert.equal(await store.get('documents/x/one'), null);
  assert.equal(f.get('SELECT COUNT(*) n FROM file_chunks').n, 0);
});

test('UFS-16: upload and download work without an R2 bucket', async () => {
  delete f.env.BUCKET;
  const uploaded = await asUser(hr, () => files.POST(uploadRequest('policy.txt', 'Synthetic policy text', { visibility: 'company', category: 'Policy' })));
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  const { id } = await uploaded.json();
  const download = await asUser(owner, () => file.GET(fileRequest(id), fileContext(id)));
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'Synthetic policy text');
});

test('UFS-17: an oversized upload is refused straight away with a clear message', async () => {
  const big = new Request(`${origin}/api/files`, { method: 'POST', headers: { Origin: origin, 'content-length': String(12 * 1024 * 1024), 'content-type': 'multipart/form-data; boundary=x' }, body: 'x' });
  const response = await asUser(hr, () => files.POST(big));
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /10 MB/);
});

const operations = await import('../app/api/operations/route.ts');
const ops = (who, body) => asUser(who, () => operations.POST(new Request(`${origin}/api/operations`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })));
const asset = (overrides = {}) => ({ action: 'saveAsset', name: 'Laptop', tag: 'QA-1', category: 'Laptop', ...overrides });

test('UFS-20: an over-long serial number or note is refused, not silently cut', async () => {
  const serial = await ops(hr, asset({ serial: 'S'.repeat(300) }));
  assert.equal(serial.status, 400);
  assert.match((await serial.json()).error, /serial number is too long/i);
  assert.equal((await ops(hr, asset({ notes: 'n'.repeat(2000) }))).status, 400);
  assert.equal(f.get('SELECT COUNT(*) n FROM assets').n, 0);
  assert.equal((await ops(hr, asset({ serial: 'S'.repeat(150) }))).status, 200);
});

test('UFS-21: an asset cannot be assigned with a return date in the past', async () => {
  const created = await (await ops(hr, asset())).json();
  const worker = f.employee('assignee');
  const past = await ops(hr, { action: 'assignAsset', id: created.id, employeeId: worker.id, returnDue: '2020-01-01' });
  assert.equal(past.status, 400);
  assert.match((await past.json()).error, /past/i);
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  assert.equal((await ops(hr, { action: 'assignAsset', id: created.id, employeeId: worker.id, returnDue: future })).status, 200);
});

test('UFS-22: workflow steps need a short title and a day offset in range', async () => {
  const step = (overrides = {}) => ({ title: 'Step', assignee: 'employee', offset: 0, description: '', ...overrides });
  const save = steps => ops(hr, { action: 'saveTemplate', name: 'Template', kind: 'Onboarding', steps });
  assert.equal((await save([step({ title: 'T'.repeat(600) })])).status, 400);
  assert.equal((await save([step({ offset: -500 })])).status, 400);
  assert.equal((await save([step({ offset: 'abc' })])).status, 400);
  assert.equal((await save([step({ offset: -5 })])).status, 200, 'a step due before the start date is allowed');
});

const { formatDate, formatMonth } = await import('../lib/format.ts');
test('UFS-31: one date style everywhere', () => {
  assert.equal(formatDate('2026-11-05'), 'Nov 5, 2026');
  assert.equal(formatDate('2026-11-05T09:30:00.000Z'), 'Nov 5, 2026');
  assert.equal(formatDate(''), '—');
  assert.equal(formatDate(null), '—');
  assert.equal(formatMonth('2026-03'), 'Mar 2026');
});

test('UFS-33: phone and tablet layout is in place', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../app/responsive.css', import.meta.url), 'utf8');
  for (const rule of ['@media (max-width:1024px)', '@media (max-width:720px)', '.bottom-nav', '.table-wrap td::before', 'env(safe-area-inset-bottom)', 'attr(data-label)']) assert.ok(css.includes(rule), rule);
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /viewportFit:'cover'/);
  const workspace = readFileSync(new URL('../app/workspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /import '\.\/responsive\.css'/);
  assert.match(workspace, /className="bottom-nav"/);
});

test('demo people are never created unless a developer turns them on', async () => {
  const { GET } = await import('../app/api/state/route.ts');
  await asUser(owner, () => GET(new Request(`${origin}/api/state`)));
  assert.equal(f.get('SELECT COUNT(*) n FROM employees WHERE demo = 1').n, 0);
  f.env.UFS_DEMO_DATA = 'enabled';
  try {
    await asUser(owner, () => GET(new Request(`${origin}/api/state`)));
    assert.ok(f.get('SELECT COUNT(*) n FROM employees WHERE demo = 1').n > 0, 'local development still gets sample data');
  } finally { delete f.env.UFS_DEMO_DATA; }
});
