// Sign-in invitations: an administrator invites an existing employee profile from the app, no commands needed.
import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, asUser, jsonRequest, fileContext, origin } from './harness.mjs';

const action = await import('../app/api/action/route.ts');
const profiles = await import('../app/api/profiles/[id]/route.ts');
const state = await import('../app/api/state/route.ts');

const SITE = 'https://invite-test.convex.site';
let f, admin, hr, manager, person;
beforeEach(() => {
  f = fixture();
  admin = f.employee('admin', { role: 'admin' });
  hr = f.employee('hr', { role: 'hr_manager' });
  manager = f.employee('manager', { role: 'manager' });
  person = f.employee('newbie', { user_id: null, manager_id: manager.id, email: 'newbie@example.test', name: 'New Bie' });
  Object.assign(f.env, { UFS_AUTH_PROVIDER: 'convex', UFS_CONVEX_URL: 'https://invite-test.convex.cloud', UFS_CONVEX_SITE_URL: SITE, UFS_INVITE_SECRET: 'invite-secret', UFS_NOTIFY_SECRET: 'notify-secret', UFS_PUBLIC_URL: 'https://ufs.example.test' });
});
afterEach(() => { for (const key of ['UFS_AUTH_PROVIDER', 'UFS_CONVEX_URL', 'UFS_CONVEX_SITE_URL', 'UFS_INVITE_SECRET', 'UFS_NOTIFY_SECRET', 'UFS_PUBLIC_URL']) delete f.env[key]; f.close(); });

const act = (who, body) => asUser(who, () => action.POST(jsonRequest(body)));
const invite = (who, id = person.id) => act(who, { action: 'inviteEmployee', employeeId: id });
const withdraw = (who, id = person.id) => act(who, { action: 'withdrawInvite', employeeId: id });
const profileOf = async (who, id = person.id) => (await (await asUser(who, () => profiles.GET(new Request(`${origin}/api/profiles/${id}`), fileContext(id)))).json()).profile;
const identities = () => f.rows('SELECT * FROM employee_identities');

// A stand-in for the Convex backend: records what it was asked and answers like the real routes.
async function withConvex(run, { fail = false, userId = 'k17newbieaccountid0001' } = {}) {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), headers: init?.headers, body });
    if (fail) return new Response('{"error":"nope"}', { status: 502 });
    if (String(url).endsWith('/invite')) return Response.json({ ok: true, userId, created: true });
    return Response.json({ ok: true });
  };
  try { await run(calls); } finally { globalThis.fetch = original; }
}

test('an administrator invites an employee: account created, bound to the profile, email queued', async () => {
  await withConvex(async calls => {
    const response = await invite(admin);
    assert.equal(response.status, 200, await response.clone().text());
    assert.match((await response.json()).message, /Invite sent/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${SITE}/invite`);
    assert.equal(calls[0].headers.Authorization, 'Bearer invite-secret');
    assert.deepEqual(calls[0].body, { email: 'newbie@example.test' });
  });
  const [binding] = identities();
  assert.equal(binding.employee_id, person.id);
  assert.equal(binding.issuer, SITE);
  assert.equal(binding.subject, 'k17newbieaccountid0001');
  assert.equal(binding.enabled, 1);
  assert.equal(binding.approved_by, admin.id);
  assert.ok(f.get("SELECT 1 x FROM audit WHERE action = 'Invited to sign in' AND target_id = ?", person.id));
  const mail = f.get("SELECT * FROM email_outbox WHERE to_address = 'newbie@example.test'");
  assert.ok(mail, 'the invitation email is queued');
  assert.match(mail.text_body, /Forgot your password/);
  assert.match(mail.html_body, /ufs\.example\.test\/login/);
  assert.equal((await profileOf(admin)).login_status, 'invited');
});

test('inviting again re-sends the email without creating a second account', async () => {
  await withConvex(async calls => {
    assert.equal((await invite(admin)).status, 200);
    f.run('DELETE FROM notifications');
    f.run("UPDATE email_outbox SET status = 'sent'");
    const again = await invite(admin);
    assert.equal(again.status, 200);
    assert.match((await again.json()).message, /again/);
    assert.equal(calls.filter(call => call.url.endsWith('/invite')).length, 1, 'the account is created once');
  });
  assert.equal(identities().length, 1);
});

test('someone who has already signed in is not invited again', async () => {
  await withConvex(async () => { assert.equal((await invite(admin)).status, 200); });
  f.run("INSERT INTO auth_sessions (session_id,issuer,subject,employee_id,created_at,last_seen) VALUES ('s1',?,?,?,1,1)", SITE, 'k17newbieaccountid0001', person.id);
  const response = await invite(admin);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already signed in/);
  assert.equal((await profileOf(admin)).login_status, 'active');
});

test('only a Super admin can invite or withdraw', async () => {
  await withConvex(async calls => {
    for (const who of [hr, manager, person]) {
      assert.equal((await invite(who)).status, 403);
      assert.equal((await withdraw(who)).status, 403);
    }
    assert.equal(calls.length, 0, 'nothing reached the sign-in service');
  });
  assert.equal(identities().length, 0);
  assert.equal((await act(null, { action: 'inviteEmployee', employeeId: person.id })).status, 401);
});

test('withdrawing removes the sign-in before first use, and never after', async () => {
  await withConvex(async calls => {
    assert.equal((await withdraw(admin)).status, 409, 'nothing to withdraw yet');
    assert.equal((await invite(admin)).status, 200);
    const response = await withdraw(admin);
    assert.equal(response.status, 200, await response.clone().text());
    assert.ok(calls.some(call => call.url === `${SITE}/invite/revoke` && call.body.email === 'newbie@example.test'));
  });
  assert.equal(identities().length, 0);
  assert.equal((await profileOf(admin)).login_status, 'none');
  await withConvex(async () => { await invite(admin); });
  f.run("INSERT INTO auth_sessions (session_id,issuer,subject,employee_id,created_at,last_seen) VALUES ('s2',?,?,?,1,1)", SITE, 'k17newbieaccountid0001', person.id);
  assert.equal((await withdraw(admin)).status, 409, 'after a sign-in the account is deactivated instead');
  assert.equal(identities().length, 1);
});

test('profiles that cannot sign in are refused: inactive, demo, or no such person', async () => {
  const inactive = f.employee('gone', { active: 0 }), demo = f.employee('demo1', { demo: 1 });
  await withConvex(async calls => {
    for (const id of [inactive.id, demo.id, 'missing']) assert.equal((await invite(admin, id)).status, 404, id);
    assert.equal(calls.length, 0);
  });
});

test('a failing sign-in service leaves no half-made binding', async () => {
  await withConvex(async () => {
    const response = await invite(admin);
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /sign-in service/);
  }, { fail: true });
  assert.equal(identities().length, 0);
});

test('the feature switches itself off when its secret is missing', async () => {
  delete f.env.UFS_INVITE_SECRET;
  assert.equal((await invite(admin)).status, 503);
  assert.equal((await profileOf(admin)).invites_enabled, false);
  assert.equal((await (await asUser(admin, () => state.GET(new Request(`${origin}/api/state`)))).json()).invitesEnabled, false);
});

test('the screens learn the feature is on only for the Super admin', async () => {
  assert.equal((await profileOf(admin)).invites_enabled, true);
  assert.equal((await profileOf(hr)).invites_enabled, false);
  assert.equal((await (await asUser(admin, () => state.GET(new Request(`${origin}/api/state`)))).json()).invitesEnabled, true);
  assert.equal((await (await asUser(hr, () => state.GET(new Request(`${origin}/api/state`)))).json()).invitesEnabled, false);
});

test('Add employee can set a role and invite in one step (Super admin only)', async () => {
  const hire = overrides => ({ action: 'createEmployee', name: 'Fresh Hire', email: 'fresh@example.test', title: 'Coordinator', department: 'Operations', location: 'United States', hireDate: new Date().toISOString().slice(0, 10), ...overrides });
  await withConvex(async calls => {
    const response = await act(admin, hire({ role: 'manager', invite: true }));
    assert.equal(response.status, 200, await response.clone().text());
    assert.match((await response.json()).message, /invite sent/i);
    assert.equal(calls.length, 1);
  });
  const created = f.get("SELECT id,role FROM employees WHERE email = 'fresh@example.test'");
  assert.equal(created.role, 'manager');
  assert.equal(identities().filter(row => row.employee_id === created.id).length, 1);

  await withConvex(async calls => {
    const response = await act(hr, hire({ email: 'second@example.test', name: 'Second Hire', role: 'manager', invite: true }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 0, 'HR cannot send invites');
  });
  assert.equal(f.get("SELECT role FROM employees WHERE email = 'second@example.test'").role, 'employee', 'HR cannot choose a role');
});

test('Add employee without the invite box only creates the profile', async () => {
  await withConvex(async calls => {
    const response = await act(admin, { action: 'createEmployee', name: 'Plain Hire', email: 'plain@example.test', title: 'Clerk', department: 'Operations', location: 'United States', hireDate: new Date().toISOString().slice(0, 10) });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 0);
  });
  assert.equal(f.get("SELECT COUNT(*) n FROM employee_identities").n, 0);
});

test('an invite email problem does not hide that the profile was created', async () => {
  const hire = { action: 'createEmployee', name: 'Odd Hire', email: 'odd@example.test', title: 'Clerk', department: 'Operations', location: 'United States', hireDate: new Date().toISOString().slice(0, 10), invite: true };
  await withConvex(async () => {
    const response = await act(admin, hire);
    assert.equal(response.status, 200);
    assert.match((await response.json()).message, /Profile created, but the invite was not sent/);
  }, { fail: true });
  assert.ok(f.get("SELECT 1 x FROM employees WHERE email = 'odd@example.test'"));
});
