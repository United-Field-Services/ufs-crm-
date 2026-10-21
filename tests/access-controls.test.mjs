import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, asUser, jsonRequest, uploadRequest, fileContext, fileRequest, origin } from './harness.mjs';

const policy = await import('../lib/policy.ts');
const server = await import('../lib/server.ts');
const action = await import('../app/api/action/route.ts');
const state = await import('../app/api/state/route.ts');
const files = await import('../app/api/files/route.ts');
const file = await import('../app/api/files/[id]/route.ts');
let f, owner, alice, bob;
beforeEach(() => { f = fixture(); owner = f.employee('owner', { role: 'admin' }); alice = f.employee('alice', { manager_id: owner.id }); bob = f.employee('bob', { manager_id: owner.id }); });
afterEach(() => f.close());
const act = (who, body, headers) => asUser(who, () => action.POST(jsonRequest(body, headers)));
const requestLeave = overrides => ({ action: 'requestLeave', type: 'Vacation', startDate: '2026-11-02', endDate: '2026-11-02', hours: 8, ...overrides });

test('calendar validation rejects impossible, reversed, weekend-only, and cross-year dates', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-01-00', '26-01-01']) assert.throws(() => policy.validDate(date));
  assert.equal(policy.validDate('2028-02-29'), '2028-02-29');
  assert.throws(() => policy.workingDays('2026-11-03', '2026-11-02'));
  assert.throws(() => policy.workingDays('2026-11-07', '2026-11-08'));
  assert.throws(() => policy.workingDays('2026-12-31', '2027-01-01'));
  assert.equal(policy.workingDays('2026-11-02', '2026-11-06', ['2026-11-03']), 4);
});

test('state requires authenticated identity and explicit membership', async () => {
  assert.equal((await asUser(null, () => state.GET())).status, 401);
  assert.equal((await asUser({ userId: 'stranger', email: 'stranger@example.test' }, () => state.GET())).status, 403);
  assert.equal(f.get('SELECT count(*) n FROM employees').n, 3);
});

test('owner is bootstrapped only from the configured verified email', async () => {
  f.run('DELETE FROM employees WHERE id = ?', owner.id);
  const me = await asUser({ userId: 'trusted-owner-id', email: 'OWNER@EXAMPLE.TEST' }, () => server.currentEmployee());
  assert.equal(me.role, 'admin');
  assert.equal(me.user_id, 'trusted-owner-id');
  assert.equal(me.demo, 0);
});

test('missing owner configuration never promotes an unregistered user', async () => {
  delete f.env.UFS_OWNER_EMAIL;
  await assert.rejects(asUser({ userId: 'unknown', email: 'unknown@example.test' }, () => server.currentEmployee()), error => error.status === 403);
});

test('verified email binds an active preregistered employee exactly once', async () => {
  const invited = f.employee('invited', { user_id: null });
  const me = await asUser({ userId: 'invited-id', email: invited.email.toUpperCase() }, () => server.currentEmployee());
  assert.equal(me.id, invited.id);
  assert.equal(me.role, 'employee');
  await assert.rejects(asUser({ userId: 'other-id', email: invited.email }, () => server.currentEmployee()), error => error.status === 403);
});

for (const [name, overrides] of [['inactive', { active: 0 }], ['demo', { demo: 1 }], ['administrator', { role: 'admin' }]]) {
  test(`unbound ${name} records cannot be claimed by email`, async () => {
    const person = f.employee('unbound', { user_id: null, ...overrides });
    await assert.rejects(asUser({ userId: 'claimant', email: person.email }, () => server.currentEmployee()), error => error.status === 403);
    assert.equal(f.get('SELECT user_id FROM employees WHERE id = ?', person.id).user_id, null);
  });
}

test('inactive bound employees cannot read any state', async () => {
  f.run('UPDATE employees SET active = 0 WHERE id = ?', alice.id);
  assert.equal((await asUser(alice, () => state.GET())).status, 403);
});

test('stable user ID keeps its original employee identity even if email changes', async () => {
  const me = await asUser({ ...alice, email: bob.email }, () => server.currentEmployee());
  assert.equal(me.id, alice.id);
});

test('cross-origin, missing-origin, and cross-site actions are rejected before mutation', async () => {
  for (const headers of [{ Origin: 'https://attacker.example' }, { Origin: 'null' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await act(alice, requestLeave(), headers)).status, 403);
  }
  assert.equal(f.get('SELECT count(*) n FROM leave_requests').n, 0);
  assert.equal((await act(alice, requestLeave(), { 'Sec-Fetch-Site': 'same-origin' })).status, 200);
});

test('employees cannot access admin actions even with submitted role or identity', async () => {
  for (const actionName of ['createEmployee', 'addEvent', 'createTask', 'updateBudgets', 'updateAccess']) {
    assert.equal((await act(alice, { action: actionName, role: 'admin', user_id: owner.user_id, id: 'anything' })).status, 403);
  }
});

test('admin creation cannot assign browser-supplied role, bound user ID, or allowances', async () => {
  const result = await act(owner, { action: 'createEmployee', name: 'New Test Employee', email: 'new@example.test', title: 'Tester', department: 'Test', location: 'United States', employment: 'Full-Time', hireDate: '2026-11-02', role: 'admin', user_id: 'attacker-id', annual_allowance: 1000 });
  assert.equal(result.status, 200);
  const added = f.get('SELECT * FROM employees WHERE email = ?', 'new@example.test');
  assert.equal(added.role, 'employee');
  assert.equal(added.user_id, null);
  assert.equal(added.annual_allowance, 15);
});

test('leave creation ignores submitted employee, days, year, approval, and reviewer', async () => {
  assert.equal((await act(alice, requestLeave({ employee_id: bob.id, days: -50, year: 1999, status: 'approved', reviewer_id: owner.id }))).status, 200);
  const leave = f.get('SELECT * FROM leave_requests');
  assert.equal(leave.employee_id, alice.id);
  assert.equal(leave.days, 1);
  assert.equal(leave.year, 2026);
  assert.equal(leave.status, 'pending');
  assert.equal(leave.reviewer_id, null);
});

for (const hours of [0, false, true, null, '', [4], -1, 0.5, 8.5, 'not-a-number']) {
  test(`invalid explicit leave hours ${JSON.stringify(hours)} are rejected`, async () => {
    assert.equal((await act(alice, requestLeave({ hours }))).status, 400);
    assert.equal(f.get('SELECT count(*) n FROM leave_requests').n, 0);
  });
}

test('half-day leave and full-day defaults have correct balances', async () => {
  assert.equal((await act(alice, requestLeave({ hours: 4 }))).status, 200);
  assert.equal(f.get('SELECT days FROM leave_requests').days, 0.5);
  const body = requestLeave({ startDate: '2026-11-03', endDate: '2026-11-03' });
  delete body.hours;
  assert.equal((await act(alice, body)).status, 200);
  assert.equal(f.get('SELECT sum(days) n FROM leave_requests').n, 1.5);
});

test('hourly leave cannot span multiple dates', async () => {
  assert.equal((await act(alice, requestLeave({ endDate: '2026-11-03', hours: 4 }))).status, 400);
});

test('holiday calculation uses real local and all-location holidays only', async () => {
  for (const [id, date, location, demo] of [['global', '2026-11-02', 'All locations', 0], ['local', '2026-11-03', alice.location, 0], ['other', '2026-11-04', 'Europe', 0], ['sample', '2026-11-05', alice.location, 1]]) {
    f.run('INSERT INTO events (id,title,date,kind,location,created_by,demo) VALUES (?,?,?,?,?,?,?)', id, 'Test Holiday', date, 'Holiday', location, owner.id, demo);
  }
  assert.equal((await act(alice, requestLeave({ endDate: '2026-11-06' }))).status, 200);
  assert.equal(f.get('SELECT days FROM leave_requests').days, 3);
});

test('concurrent overlapping requests yield exactly one saved request', async () => {
  const responses = await Promise.all([act(alice, requestLeave()), act(alice, requestLeave())]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.get('SELECT count(*) n FROM leave_requests').n, 1);
});

test('only own pending leave can be cancelled', async () => {
  f.leave('other', bob.id);
  f.leave('own-approved', alice.id, { status: 'approved' });
  f.leave('own-pending', alice.id);
  assert.equal((await act(alice, { action: 'cancelLeave', id: 'other' })).status, 403);
  assert.equal((await act(alice, { action: 'cancelLeave', id: 'own-approved' })).status, 403);
  assert.equal((await act(alice, { action: 'cancelLeave', id: 'own-pending' })).status, 200);
  assert.equal(f.get('SELECT status FROM leave_requests WHERE id = ?', 'own-pending').status, 'cancelled');
});

test('administrators cannot approve or reject their own leave', async () => {
  f.leave('owner-request', owner.id);
  for (const status of ['approved', 'rejected']) assert.equal((await act(owner, { action: 'reviewLeave', id: 'owner-request', status })).status, 403);
  assert.equal(f.get('SELECT status FROM leave_requests').status, 'pending');
});

test('concurrent approvals cannot overspend an employee balance', async () => {
  f.run('UPDATE employees SET annual_allowance = 1 WHERE id = ?', alice.id);
  f.leave('request-a', alice.id);
  f.leave('request-b', alice.id, { start_date: '2026-11-03', end_date: '2026-11-03' });
  const responses = await Promise.all(['request-a', 'request-b'].map(id => act(owner, { action: 'reviewLeave', id, status: 'approved' })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.get("SELECT sum(days) n FROM leave_requests WHERE status = 'approved'").n, 1);
});

test('repeat reviews cannot change a previously reviewed request', async () => {
  f.leave('review-once', alice.id);
  assert.equal((await act(owner, { action: 'reviewLeave', id: 'review-once', status: 'approved' })).status, 200);
  assert.equal((await act(owner, { action: 'reviewLeave', id: 'review-once', status: 'rejected' })).status, 409);
  assert.equal(f.get('SELECT status FROM leave_requests').status, 'approved');
});

test('leave allowances remain isolated by year and leave type', async () => {
  f.run('UPDATE employees SET annual_allowance = 1 WHERE id = ?', alice.id);
  f.leave('old-year', alice.id, { year: 2025, days: 15, status: 'approved' });
  f.leave('other-type', alice.id, { type: 'Sick Leave', days: 5, status: 'approved' });
  f.leave('current', alice.id);
  assert.equal((await act(owner, { action: 'reviewLeave', id: 'current', status: 'approved' })).status, 200);
});

const budgets = overrides => ({ action: 'updateBudgets', employeeId: 'alice', year: 2026, vacation: 10, sick: 5, wfh: 20, bereavement: 3, ...overrides });

test('per-year budgets require HR permission and do not update default employee allowances', async () => {
  assert.equal((await act(alice, budgets({ vacation: 365 }))).status, 403);
  assert.equal(f.get('SELECT count(*) n FROM entitlements').n, 0);
  assert.equal((await act(owner, budgets({ vacation: 8.125 }))).status, 200);
  assert.equal(f.get('SELECT count(*) n FROM entitlements').n, 4);
  assert.equal(f.get('SELECT total FROM entitlements WHERE employee_id = ? AND year = ? AND type = ?', alice.id, 2026, 'Vacation').total, 8.125);
  assert.equal(f.get('SELECT annual_allowance FROM employees WHERE id = ?', alice.id).annual_allowance, 15);
  assert.equal(f.get('SELECT updated_by FROM entitlements').updated_by, owner.id);
  assert.equal(f.get('SELECT count(*) n FROM audit').n, 1);
});

test('budgets reject invalid employee IDs and inactive employees', async () => {
  for (const employeeId of ['missing', "alice' OR 1=1 --"]) assert.equal((await act(owner, budgets({ employeeId }))).status, 404);
  f.run('UPDATE employees SET active = 0 WHERE id = ?', bob.id);
  assert.equal((await act(owner, budgets({ employeeId: bob.id }))).status, 404);
  assert.equal(f.get('SELECT count(*) n FROM entitlements').n, 0);
});

test('budget years must be integer calendar years in the supported range', async () => {
  for (const year of [2019, 2101, 2026.5, null, '', 'not-a-year']) assert.equal((await act(owner, budgets({ year }))).status, 400);
  assert.equal(f.get('SELECT count(*) n FROM entitlements').n, 0);
});

test('budget amounts reject invalid values without partially saving any type', async () => {
  for (const vacation of [-1, 365.125, 0.1, null, '', false, true, [4], 'invalid']) {
    assert.equal((await act(owner, budgets({ vacation }))).status, 400);
    assert.equal(f.get('SELECT count(*) n FROM entitlements').n, 0);
  }
  assert.equal((await act(owner, budgets({ bereavement: -1 }))).status, 400);
  assert.equal(f.get('SELECT count(*) n FROM entitlements').n, 0);
  assert.equal(f.get('SELECT count(*) n FROM audit').n, 0);
});

test('budget changes are isolated to the exact employee and year and upsert without duplicates', async () => {
  assert.equal((await act(owner, budgets({ vacation: 1 }))).status, 200);
  assert.equal((await act(owner, budgets({ employeeId: bob.id, vacation: 2 }))).status, 200);
  assert.equal((await act(owner, budgets({ year: 2027, vacation: 3 }))).status, 200);
  assert.equal((await act(owner, budgets({ vacation: 4 }))).status, 200);
  assert.equal(f.get('SELECT count(*) n FROM entitlements').n, 12);
  assert.equal(f.get('SELECT total FROM entitlements WHERE employee_id = ? AND year = ? AND type = ?', alice.id, 2026, 'Vacation').total, 4);
  assert.equal(f.get('SELECT total FROM entitlements WHERE employee_id = ? AND year = ? AND type = ?', bob.id, 2026, 'Vacation').total, 2);
  assert.equal(f.get('SELECT total FROM entitlements WHERE employee_id = ? AND year = ? AND type = ?', alice.id, 2027, 'Vacation').total, 3);
});

test('zero per-year budget overrides defaults without affecting another year or employee', async () => {
  assert.equal((await act(owner, budgets({ vacation: 0 }))).status, 200);
  f.leave('alice-this-year', alice.id);
  f.leave('alice-next-year', alice.id, { year: 2027, start_date: '2027-11-01', end_date: '2027-11-01' });
  f.leave('bob-this-year', bob.id);
  assert.equal((await act(owner, { action: 'reviewLeave', id: 'alice-this-year', status: 'approved' })).status, 409);
  assert.equal((await act(owner, { action: 'reviewLeave', id: 'alice-next-year', status: 'approved' })).status, 200);
  assert.equal((await act(owner, { action: 'reviewLeave', id: 'bob-this-year', status: 'approved' })).status, 200);
});

test('concurrent approvals respect a smaller per-year budget', async () => {
  assert.equal((await act(owner, budgets({ vacation: 0.5 }))).status, 200);
  f.leave('half-a', alice.id, { days: 0.5 });
  f.leave('half-b', alice.id, { days: 0.5, start_date: '2026-11-03', end_date: '2026-11-03' });
  const responses = await Promise.all(['half-a', 'half-b'].map(id => act(owner, { action: 'reviewLeave', id, status: 'approved' })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.get("SELECT sum(days) n FROM leave_requests WHERE status = 'approved'").n, 0.5);
});

test('state exposes own current-year budgets without leaking other employee entitlements', async () => {
  const year = new Date().getUTCFullYear();
  assert.equal((await act(owner, budgets({ year, vacation: 0, sick: 2.5 }))).status, 200);
  assert.equal((await act(owner, budgets({ year: year + 1, vacation: 100 }))).status, 200);
  assert.equal((await act(owner, budgets({ employeeId: bob.id, year, vacation: 250 }))).status, 200);
  const result = await asUser(alice, () => state.GET());
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.deepEqual(data.employeeBudgets, []);
  assert.equal(data.balances.find(b => b.type === 'Vacation').total, 0);
  assert.equal(data.balances.find(b => b.type === 'Sick Leave').total, 2.5);
});

test('employee state hides other leave details, private documents, admin fields, and tasks', async () => {
  f.leave('alice-leave', alice.id);
  f.leave('bob-leave', bob.id, { status: 'approved' });
  f.document('alice-doc', alice.id);
  f.document('bob-private', bob.id);
  f.document('company-doc', owner.id, { visibility: 'company' });
  f.run('INSERT INTO tasks (id,title,assignee_id,due_date,created_by,created_at) VALUES (?,?,?,?,?,?)', 'bob-task', 'Private Bob Task', bob.id, '2026-11-02', owner.id, '2026-01-01');
  const result = await asUser(alice, () => state.GET());
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.deepEqual(data.requests.map(l => l.id), ['alice-leave']);
  assert.deepEqual(data.documents.map(d => d.id).sort(), ['alice-doc', 'company-doc']);
  assert.deepEqual(data.tasks, []);
  assert.deepEqual(data.activity, []);
  for (const person of data.people) for (const key of ['email', 'user_id', 'role', 'annual_allowance', 'sick_allowance']) assert.equal(key in person, false);
  for (const absence of data.teamAway) for (const key of ['type', 'note', 'review_note', 'reviewer_id']) assert.equal(key in absence, false);
});

test('direct private document downloads are restricted and denied reads never touch storage', async () => {
  f.document('bob-private', bob.id);
  const response = await asUser(alice, () => file.GET(fileRequest('bob-private'), fileContext('bob-private')));
  assert.equal(response.status, 404);
  assert.deepEqual(f.bucketReads, []);
  assert.equal((await asUser(owner, () => file.GET(fileRequest('bob-private'), fileContext('bob-private')))).status, 200);
});

test('own and company documents download safely and archived files stay hidden', async () => {
  f.document('own', alice.id);
  f.document('company', owner.id, { visibility: 'company' });
  f.document('archived', alice.id, { archived: 1 });
  for (const id of ['own', 'company']) {
    const response = await asUser(alice, () => file.GET(fileRequest(id), fileContext(id)));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), `content of ${id}`);
    assert.match(response.headers.get('Content-Disposition'), /^attachment;/);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(response.headers.get('Content-Security-Policy'), /sandbox/);
  }
  assert.equal((await asUser(owner, () => file.GET(fileRequest('archived'), fileContext('archived')))).status, 404);
});

test('employees can upload personal files but cannot publish to the company', async () => {
  assert.equal((await asUser(alice, () => files.POST(uploadRequest()))).status, 200);
  assert.equal((await asUser(alice, () => files.POST(uploadRequest('company.txt', 'hello', { visibility: 'company' })))).status, 403);
  const document = f.get('SELECT * FROM documents');
  assert.equal(document.owner_id, alice.id);
  assert.equal(document.visibility, 'personal');
  assert.equal(f.storage.size, 1);
  assert.equal((await asUser(owner, () => files.POST(uploadRequest('company.txt', 'hello', { visibility: 'company' })))).status, 200);
});

test('uploads ignore browser owner, object key, and archived metadata', async () => {
  assert.equal((await asUser(alice, () => files.POST(uploadRequest('own.txt', 'hello', { owner_id: bob.id, object_key: 'target-key', archived: '1' })))).status, 200);
  const document = f.get('SELECT * FROM documents');
  assert.equal(document.owner_id, alice.id);
  assert.match(document.object_key, /^documents\/alice\//);
  assert.equal(document.archived, 0);
});

test('failed document metadata insertion cleans up the uploaded object', async () => {
  const prepare = f.env.DB.prepare;
  f.env.DB.prepare = sql => {
    if (/INSERT INTO documents/i.test(sql)) return { bind() { return this; }, async run() { throw new Error('Synthetic database failure'); } };
    return prepare(sql);
  };
  assert.equal((await asUser(alice, () => files.POST(uploadRequest()))).status, 500);
  assert.equal(f.get('SELECT count(*) n FROM documents').n, 0);
  assert.equal(f.storage.size, 0);
});

test('full upload quota is enforced while archived documents do not count', async () => {
  for (let i = 0; i < 100; i++) f.document(`existing-${i}`, alice.id);
  assert.equal((await asUser(alice, () => files.POST(uploadRequest()))).status, 400);
  f.run('UPDATE documents SET archived = 1 WHERE id = ?', 'existing-0');
  assert.equal((await asUser(alice, () => files.POST(uploadRequest()))).status, 200);
  assert.equal(f.get('SELECT count(*) n FROM documents WHERE archived = 0').n, 100);
});

test('concurrent uploads cannot bypass the 100-active-file quota', async () => {
  for (let i = 0; i < 99; i++) f.document(`existing-${i}`, alice.id);
  const put = f.env.BUCKET.put;
  f.env.BUCKET.put = async (...args) => {
    // Real R2 writes are asynchronous. Let both requests reach this network boundary.
    await new Promise(resolve => setImmediate(resolve));
    return put(...args);
  };
  const responses = await Promise.all([
    asUser(alice, () => files.POST(uploadRequest('one.txt', 'one'))),
    asUser(alice, () => files.POST(uploadRequest('two.txt', 'two'))),
  ]);
  assert.equal(responses.filter(r => r.status === 200).length, 1);
  assert.equal(f.get('SELECT count(*) n FROM documents WHERE owner_id = ? AND archived = 0', alice.id).n, 100);
  assert.equal(f.storage.size, 100);
});

test('multipart body limits apply to extra fields without Content-Length', async () => {
  const outgoing = uploadRequest('small.txt', 'small', { padding: 'x'.repeat(11 * 1024 * 1024) });
  // Use encoded wire bytes: Node's outgoing FormData encoder throws asynchronously
  // if its own stream is cancelled, unlike the incoming HTTP body in a Worker.
  const req = new Request(outgoing.url, { method: 'POST', headers: outgoing.headers, body: await outgoing.arrayBuffer() });
  assert.equal(req.headers.has('Content-Length'), false);
  const response = await asUser(alice, () => files.POST(req));
  assert.ok([400, 413].includes(response.status), `Oversized multipart body was accepted with ${response.status}`);
  assert.equal(f.get('SELECT count(*) n FROM documents').n, 0);
});

test('unsafe extension, spoofed content, empty files, invalid category, and oversized files are rejected', async () => {
  const cases = [['program.exe', 'MZ'], ['fake.pdf', 'not PDF'], ['fake.png', 'PNG'], ['fake.docx', 'not zip'], ['fake.jpg', 'JPG'], ['nul.txt', 'a\0b'], ['empty.txt', ''], ['category.txt', 'text', { category: 'Unknown' }], ['large.txt', new Uint8Array(10 * 1024 * 1024 + 1)]];
  for (const args of cases) assert.equal((await asUser(alice, () => files.POST(uploadRequest(...args)))).status, 400);
  assert.equal(f.get('SELECT count(*) n FROM documents').n, 0);
  assert.equal(f.storage.size, 0);
});

test('upload and archive requests reject hostile origins', async () => {
  const upload = uploadRequest();
  upload.headers.set('Origin', 'https://attacker.example');
  assert.equal((await asUser(alice, () => files.POST(upload))).status, 403);
  f.document('own', alice.id);
  assert.equal((await asUser(alice, () => file.DELETE(fileRequest('own', 'DELETE', { Origin: 'https://attacker.example' }), fileContext('own')))).status, 403);
  assert.equal(f.get('SELECT archived FROM documents').archived, 0);
});

test('document archiving preserves ownership isolation and storage recoverability', async () => {
  f.document('bob-doc', bob.id);
  f.document('alice-doc', alice.id);
  assert.equal((await asUser(alice, () => file.DELETE(fileRequest('bob-doc', 'DELETE'), fileContext('bob-doc')))).status, 404);
  assert.equal((await asUser(alice, () => file.DELETE(fileRequest('alice-doc', 'DELETE'), fileContext('alice-doc')))).status, 200);
  assert.equal(f.get('SELECT archived FROM documents WHERE id = ?', 'bob-doc').archived, 0);
  assert.equal(f.get('SELECT archived FROM documents WHERE id = ?', 'alice-doc').archived, 1);
  assert.equal(f.storage.size, 2);
});

test('task mutation is restricted to assignee or administrator', async () => {
  f.run('INSERT INTO tasks (id,title,assignee_id,due_date,created_by,created_at) VALUES (?,?,?,?,?,?)', 'task', 'Test Task', bob.id, '2026-11-02', owner.id, '2026-01-01');
  assert.equal((await act(alice, { action: 'toggleTask', id: 'task', status: 'completed', assignee_id: alice.id })).status, 403);
  assert.equal((await act(bob, { action: 'toggleTask', id: 'task', status: 'completed' })).status, 200);
  assert.equal((await act(owner, { action: 'toggleTask', id: 'task', status: 'pending' })).status, 200);
  assert.equal(f.get('SELECT status FROM tasks').status, 'pending');
});

test('actual JSON body limits apply even without Content-Length', async () => {
  const req = jsonRequest(requestLeave({ padding: 'x'.repeat(21000) }));
  assert.equal(req.headers.has('Content-Length'), false);
  const response = await asUser(alice, () => action.POST(req));
  assert.ok([400, 413].includes(response.status), `Oversized body was accepted with ${response.status}`);
  assert.equal(f.get('SELECT count(*) n FROM leave_requests').n, 0);
});

test('invalid and non-object JSON returns a validation response', async () => {
  for (const body of ['{', 'null', '[]']) {
    const req = new Request(`${origin}/api/action`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body });
    assert.equal((await asUser(alice, () => action.POST(req))).status, 400);
  }
});

test('streaming body limit cancels before consuming the remaining chunks', async () => {
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(10)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const req = new Request(`${origin}/api/action`, { method: 'POST', body, duplex: 'half' });
  await assert.rejects(policy.readLimited(req, 15), error => error.status === 413);
  assert.equal(cancelled, true);
  assert.equal(pulls, 2);
});

test('body limits accept an exact-size body and reject a false Content-Length', async () => {
  const exact = new Request(`${origin}/api/action`, { method: 'POST', body: '1234567890' });
  assert.equal((await policy.readLimited(exact, 10)).byteLength, 10);
  const dishonest = new Request(`${origin}/api/action`, { method: 'POST', body: '12345678901', headers: { 'Content-Length': '1' } });
  await assert.rejects(policy.readLimited(dishonest, 10), error => error.status === 413);
});
