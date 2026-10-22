// Regression tests for the October 2026 QA report (UFS-01 to UFS-15).
import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fixture, asUser, jsonRequest, fileContext, origin } from './harness.mjs';
import { SECTION_PATHS, sectionForPath, sectionPath } from '../lib/sections.ts';

const action = await import('../app/api/action/route.ts');
const profiles = await import('../app/api/profiles/[id]/route.ts');
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
