// Notifications and reminders: who is told, what they can choose, how email is queued and sent, and that nothing repeats.
import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, asUser, jsonRequest, origin } from './harness.mjs';

const action = await import('../app/api/action/route.ts');
const operations = await import('../app/api/operations/route.ts');
const api = await import('../app/api/notifications/route.ts');
const { notify, flushOutbox, queueDigests, mailEnabled } = await import('../lib/notifications.ts');
const { runReminders, daysUntil } = await import('../lib/reminders.ts');

let f, admin, hr, manager, worker, other;
beforeEach(() => {
  f = fixture();
  admin = f.employee('admin', { role: 'admin' });
  hr = f.employee('hr', { role: 'hr_manager' });
  manager = f.employee('manager', { role: 'manager', manager_id: admin.id });
  worker = f.employee('worker', { manager_id: manager.id });
  other = f.employee('other', { manager_id: manager.id });
});
afterEach(() => { delete f.env.UFS_NOTIFY_SECRET; delete f.env.UFS_CONVEX_SITE_URL; f.close(); });

const act = (who, body) => asUser(who, () => action.POST(jsonRequest(body)));
const ops = (who, body) => asUser(who, () => operations.POST(new Request(`${origin}/api/operations`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })));
const call = (who, body) => asUser(who, () => api.POST(new Request(`${origin}/api/notifications`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })));
const inboxOf = id => f.rows('SELECT * FROM notifications WHERE recipient_id = ? ORDER BY created_at', id);
const enableMail = () => { f.env.UFS_NOTIFY_SECRET = 'secret-for-tests'; f.env.UFS_CONVEX_SITE_URL = 'https://test-deployment.convex.site'; f.env.UFS_PUBLIC_URL = 'https://ufs.example.test'; };
const withFetch = async (handler, run) => { const original = globalThis.fetch, calls = []; globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return handler(String(url), init); }; try { await run(calls); } finally { globalThis.fetch = original; } };

test('a time-off request tells the approver; the decision tells the employee', async () => {
  const leave = { action: 'requestLeave', type: 'Vacation', startDate: '2026-11-09', endDate: '2026-11-10', hours: 8 };
  assert.equal((await act(worker, leave)).status, 200);
  const toManager = inboxOf(manager.id);
  assert.equal(toManager.length, 1);
  assert.match(toManager[0].title, /Test worker asked for 2 days of Vacation/);
  assert.equal(toManager[0].link, '/time-off');
  const id = f.get('SELECT id FROM leave_requests').id;
  assert.equal((await act(manager, { action: 'reviewLeave', id, status: 'approved' })).status, 200);
  const toWorker = inboxOf(worker.id);
  assert.equal(toWorker.length, 1);
  assert.match(toWorker[0].title, /was approved/);
  assert.match(toWorker[0].body, /Approved by Test manager/);
  assert.equal(inboxOf(other.id).length, 0, 'colleagues are not told');
});

test('a request with no approver is escalated to HR instead of waiting silently', async () => {
  const loner = f.employee('loner');
  assert.equal((await act(loner, { action: 'requestLeave', type: 'Vacation', startDate: '2026-11-09', endDate: '2026-11-09', hours: 8 })).status, 200);
  for (const person of [hr, admin]) assert.ok(inboxOf(person.id).some(row => row.kind === 'approval_escalation' && /has no approver/.test(row.title)));
  assert.equal(inboxOf(manager.id).length, 0);
});

test('tasks, equipment, access changes and announcements notify the right people', async () => {
  assert.equal((await act(hr, { action: 'createTask', title: 'Collect handbook', assigneeId: worker.id, dueDate: '2026-11-12' })).status, 200);
  assert.match(inboxOf(worker.id).at(-1).title, /New task: Collect handbook/);
  await act(hr, { action: 'createTask', title: 'My own task', assigneeId: hr.id, dueDate: '2026-11-12' });
  assert.equal(inboxOf(hr.id).length, 0, 'assigning to yourself does not notify you');

  const asset = await (await ops(hr, { action: 'saveAsset', name: 'Laptop', tag: 'L-1', category: 'Laptop' })).json();
  assert.equal((await ops(hr, { action: 'assignAsset', id: asset.id, employeeId: worker.id })).status, 200);
  assert.ok(inboxOf(worker.id).some(row => row.kind === 'asset_assigned' && /Laptop \(L-1\)/.test(row.title)));

  assert.equal((await act(admin, { action: 'updateAccess', employeeId: other.id, role: 'manager', active: true, managerId: manager.id })).status, 200);
  assert.ok(inboxOf(other.id).some(row => row.kind === 'access_changed' && /role is now Manager/.test(row.title)));

  const news = await ops(hr, { action: 'saveAnnouncement', title: 'Office closed Friday', body: 'See you Monday.', status: 'published' });
  assert.equal(news.status, 200);
  assert.ok(inboxOf(worker.id).some(row => row.kind === 'announcement'));
  assert.equal(inboxOf(hr.id).some(row => row.kind === 'announcement'), false, 'the author is not told about their own post');
  const id = (await news.json()).id;
  await ops(hr, { action: 'saveAnnouncement', id, title: 'Office closed Friday (edited)', body: 'See you Monday.', status: 'published' });
  assert.equal(inboxOf(worker.id).filter(row => row.kind === 'announcement').length, 1, 'editing does not alert twice');
});

test('a draft announcement notifies nobody', async () => {
  await ops(hr, { action: 'saveAnnouncement', title: 'Draft', body: 'Not yet', status: 'draft' });
  assert.equal(f.get('SELECT COUNT(*) n FROM notifications').n, 0);
});

test('preferences: in-app can be switched off, security notices cannot', async () => {
  await call(worker, { action: 'savePreferences', preferences: [{ kind: 'task_assigned', inApp: false, email: 'off' }, { kind: 'access_changed', inApp: false, email: 'off' }] });
  await act(hr, { action: 'createTask', title: 'Quiet task', assigneeId: worker.id, dueDate: '2026-11-12' });
  assert.equal(inboxOf(worker.id).length, 0, 'switched off: no notification');
  await act(admin, { action: 'updateAccess', employeeId: worker.id, role: 'manager', active: true, managerId: manager.id });
  assert.equal(inboxOf(worker.id).length, 1, 'security notice still arrives');
});

test('preferences: an unknown kind or a bad email choice is refused', async () => {
  assert.equal((await call(worker, { action: 'savePreferences', preferences: [{ kind: 'nonsense', inApp: true, email: 'off' }] })).status, 400);
  assert.equal((await call(worker, { action: 'savePreferences', preferences: [{ kind: 'task_due', inApp: true, email: 'sometimes' }] })).status, 400);
});

test('everyone only reads and changes their own notifications', async () => {
  await notify({ recipients: [worker.id, other.id], kind: 'announcement', title: 'Hello', dedupeKey: 'a' });
  const mine = inboxOf(worker.id)[0], theirs = inboxOf(other.id)[0];
  await call(worker, { action: 'markRead', id: theirs.id });
  assert.equal(f.get('SELECT read_at FROM notifications WHERE id = ?', theirs.id).read_at, null, 'cannot mark someone else’s notification');
  await call(worker, { action: 'markRead', id: mine.id });
  assert.ok(f.get('SELECT read_at FROM notifications WHERE id = ?', mine.id).read_at);
  const body = await (await asUser(worker, () => api.GET())).json();
  assert.equal(body.items.length, 1);
  assert.equal(body.unread, 0);
  await call(worker, { action: 'clearRead' });
  assert.equal(inboxOf(other.id).length, 1, 'clearing only touches your own');
  assert.equal((await asUser(null, () => api.GET())).status, 401);
});

test('the preference list hides HR-only settings from employees', async () => {
  const employeeView = await (await asUser(worker, () => api.GET())).json();
  const hrView = await (await asUser(hr, () => api.GET())).json();
  assert.equal(employeeView.preferences.some(item => item.kind === 'contract_ending'), false);
  assert.equal(hrView.preferences.some(item => item.kind === 'contract_ending'), true);
  assert.equal(employeeView.preferences.some(item => item.kind === 'test'), false);
});

test('email: instant mail is queued and sent through the Convex route with the secret', async () => {
  enableMail();
  assert.equal(mailEnabled(), true);
  await notify({ recipients: worker.id, kind: 'task_assigned', title: 'New task: X', body: 'Due soon', link: '/tasks', dedupeKey: 'mail-1' });
  const queued = f.rows('SELECT * FROM email_outbox');
  assert.equal(queued.length, 1);
  assert.equal(queued[0].to_address, 'worker@example.test');
  assert.match(queued[0].html_body, /https:\/\/ufs\.example\.test\/tasks/);
  await withFetch(() => new Response('{"ok":true}', { status: 200 }), async calls => {
    assert.equal(await flushOutbox(), 1);
    assert.equal(calls[0].url, 'https://test-deployment.convex.site/notify');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-for-tests');
    assert.equal(JSON.parse(calls[0].init.body).to, 'worker@example.test');
  });
  assert.equal(f.get('SELECT status FROM email_outbox').status, 'sent');
  await withFetch(() => new Response('', { status: 200 }), async calls => { assert.equal(await flushOutbox(), 0); assert.equal(calls.length, 0, 'sent mail is never sent again'); });
});

test('email: a failing send is retried and gives up after five attempts', async () => {
  enableMail();
  await notify({ recipients: worker.id, kind: 'task_assigned', title: 'Retry me', dedupeKey: 'mail-2' });
  await withFetch(() => new Response('nope', { status: 502 }), async () => { for (let i = 0; i < 6; i++) await flushOutbox(); });
  const row = f.get('SELECT status,attempts,last_error FROM email_outbox');
  assert.equal(row.status, 'failed');
  assert.equal(row.attempts, 5);
  assert.equal(row.last_error, 'http 502');
});

test('email: without the secret nothing is queued and the in-app notification still works', async () => {
  assert.equal(mailEnabled(), false);
  await notify({ recipients: worker.id, kind: 'task_assigned', title: 'In-app only', dedupeKey: 'mail-3' });
  assert.equal(f.get('SELECT COUNT(*) n FROM email_outbox').n, 0);
  assert.equal(inboxOf(worker.id).length, 1);
  assert.equal(inboxOf(worker.id)[0].email_mode, 'off');
});

test('email: daily-summary choices are combined into one message', async () => {
  enableMail();
  await call(worker, { action: 'savePreferences', preferences: [{ kind: 'task_assigned', inApp: true, email: 'daily' }] });
  await notify({ recipients: worker.id, kind: 'task_assigned', title: 'First task', dedupeKey: 'd1' });
  await notify({ recipients: worker.id, kind: 'task_assigned', title: 'Second task', dedupeKey: 'd2' });
  assert.equal(f.get('SELECT COUNT(*) n FROM email_outbox').n, 0, 'nothing is sent straight away');
  assert.equal(await queueDigests(), 1);
  const mail = f.get('SELECT * FROM email_outbox');
  assert.match(mail.subject, /summary: 2 items/);
  assert.match(mail.text_body, /First task/);
  assert.match(mail.text_body, /Second task/);
  assert.equal(await queueDigests(), 0, 'the same items are not summarised twice');
});

test('a duplicate event never notifies twice', async () => {
  assert.equal(await notify({ recipients: worker.id, kind: 'task_due', title: 'Same', dedupeKey: 'same-key' }), 1);
  assert.equal(await notify({ recipients: worker.id, kind: 'task_due', title: 'Same', dedupeKey: 'same-key' }), 0);
  assert.equal(inboxOf(worker.id).length, 1);
});

test('inactive people and demo accounts are never notified', async () => {
  f.run('UPDATE employees SET active = 0 WHERE id = ?', other.id);
  assert.equal(await notify({ recipients: [other.id], kind: 'announcement', title: 'Hi', dedupeKey: 'x' }), 0);
});

test('send a test email needs email to be set up and is limited to once a minute', async () => {
  assert.equal((await call(worker, { action: 'sendTest' })).status, 503);
  enableMail();
  await withFetch(() => new Response('{"ok":true}', { status: 200 }), async () => {
    assert.equal((await call(worker, { action: 'sendTest' })).status, 200);
    assert.equal((await call(worker, { action: 'sendTest' })).status, 429);
  });
  assert.equal(f.get("SELECT status FROM email_outbox").status, 'sent');
});

// ---------------------------------------------------------------- reminders
const TODAY = '2026-10-23'; // a Friday
const at = (overrides = {}) => ({ today: TODAY, hour: 10, weekday: 'Fri', ...overrides });
const reminderKinds = id => inboxOf(id).map(row => row.kind);

test('reminders: waiting requests nudge the approver daily and escalate to HR after three days', async () => {
  f.leave('old', worker.id, { start_date: '2026-11-20', end_date: '2026-11-20', created_at: '2026-10-19T09:00:00Z' });
  await runReminders(at());
  assert.ok(reminderKinds(manager.id).includes('approval_reminder'));
  assert.ok(reminderKinds(hr.id).includes('approval_escalation'));
  assert.ok(reminderKinds(admin.id).includes('approval_escalation'));
  const before = f.get('SELECT COUNT(*) n FROM notifications').n;
  await runReminders(at());
  assert.equal(f.get('SELECT COUNT(*) n FROM notifications').n, before, 'running again the same day repeats nothing');
  await runReminders(at({ today: '2026-10-24' }));
  assert.equal(reminderKinds(manager.id).filter(kind => kind === 'approval_reminder').length, 2, 'a new day brings a new nudge');
  assert.equal(reminderKinds(hr.id).filter(kind => kind === 'approval_escalation').length, 1, 'HR is escalated to once');
});

test('reminders: a fresh request is not nagged about yet', async () => {
  f.leave('fresh', worker.id, { start_date: '2026-11-20', end_date: '2026-11-20', created_at: '2026-10-23T08:00:00Z' });
  await runReminders(at());
  assert.equal(reminderKinds(manager.id).length, 0);
});

test('reminders: tasks due today, tomorrow or overdue are summarised once a day', async () => {
  f.run("INSERT INTO tasks (id,title,assignee_id,due_date,status,created_by,created_at) VALUES ('t1','Late',?,'2026-10-20','pending',?,'2026-10-01'),('t2','Today',?,'2026-10-23','pending',?,'2026-10-01'),('t3','Later',?,'2026-12-01','pending',?,'2026-10-01'),('t4','Done',?,'2026-10-01','completed',?,'2026-10-01')", worker.id, hr.id, worker.id, hr.id, worker.id, hr.id, worker.id, hr.id);
  await runReminders(at());
  const summary = inboxOf(worker.id).filter(row => row.kind === 'task_due');
  assert.equal(summary.length, 1);
  assert.match(summary[0].title, /1 overdue, 1 due today/);
});

test('reminders: equipment return dates remind the holder and, when late, HR', async () => {
  const stamp = '2026-10-01T00:00:00Z';
  f.run("INSERT INTO assets (id,name,category,tag,status,assigned_to,return_due,created_by,updated_at) VALUES ('a1','Laptop','Laptop','L-1','assigned',?,'2026-10-26',?,?),('a2','Phone','Phone','P-1','assigned',?,'2026-10-23',?,?),('a3','Monitor','Monitor','M-1','assigned',?,'2026-10-10',?,?)", worker.id, hr.id, stamp, worker.id, hr.id, stamp, other.id, hr.id, stamp);
  await runReminders(at());
  const titles = inboxOf(worker.id).map(row => row.title);
  assert.ok(titles.some(title => /Laptop \(L-1\) is due back in 3 days/.test(title)));
  assert.ok(titles.some(title => /Phone \(P-1\) is due back today/.test(title)));
  assert.equal(inboxOf(other.id).length, 0, '13 days overdue is not a reminder day');
  assert.ok(inboxOf(hr.id).some(row => /Phone \(P-1\)/.test(row.title)), 'HR hears about equipment due today');
});

test('reminders: files expiring in 30, 7 or 1 days, or today, tell the owner and HR', async () => {
  f.document('d30', worker.id, { expiry_date: '2026-11-22' });
  f.document('d7', worker.id, { expiry_date: '2026-10-30' });
  f.document('d12', worker.id, { expiry_date: '2026-11-04' });
  await runReminders(at());
  const titles = inboxOf(worker.id).filter(row => row.kind === 'document_expiring').map(row => row.title);
  assert.equal(titles.length, 2);
  assert.ok(inboxOf(hr.id).some(row => row.kind === 'document_expiring'));
});

test('reminders: probation and contract ends tell HR and the manager', async () => {
  f.run("INSERT INTO employee_profiles (employee_id,probation_end,contract_end,updated_at) VALUES (?,?,?,'2026-01-01')", worker.id, '2026-11-06', '');
  await runReminders(at());
  assert.ok(inboxOf(hr.id).some(row => row.kind === 'contract_ending' && /probation ends in 14 days/.test(row.title)));
  assert.ok(inboxOf(manager.id).some(row => row.kind === 'contract_ending'));
  assert.equal(inboxOf(worker.id).some(row => row.kind === 'contract_ending'), false, 'the employee is not alerted');
});

test('reminders: work anniversaries greet the person and tell their manager', async () => {
  f.run("UPDATE employees SET hire_date = '2023-10-23' WHERE id = ?", worker.id);
  f.run("UPDATE employees SET hire_date = '2026-10-23' WHERE id = ?", other.id);
  await runReminders(at());
  assert.ok(inboxOf(worker.id).some(row => /Happy 3 years/.test(row.title)));
  assert.ok(inboxOf(manager.id).some(row => /marks 3 years today/.test(row.title)));
  assert.equal(inboxOf(other.id).some(row => row.kind === 'work_anniversary'), false, 'a first day is not an anniversary');
});

test('reminders: time off starting tomorrow is announced the day before', async () => {
  f.leave('soon', worker.id, { status: 'approved', start_date: '2026-10-24', end_date: '2026-10-26', created_at: '2026-10-01T00:00:00Z' });
  await runReminders(at());
  assert.ok(inboxOf(worker.id).some(row => row.kind === 'leave_upcoming' && /starts tomorrow/.test(row.title)));
});

test('reminders: the Friday timesheet reminder is opt-in and skips people who logged time', async () => {
  await call(worker, { action: 'savePreferences', preferences: [{ kind: 'timesheet_reminder', inApp: true, email: 'off' }] });
  await runReminders(at());
  assert.ok(reminderKinds(worker.id).includes('timesheet_reminder'));
  assert.equal(reminderKinds(other.id).includes('timesheet_reminder'), false, 'not opted in');
  f.run("INSERT INTO time_entries (id,employee_id,date,minutes,status,created_at,updated_at) VALUES ('te',?,'2026-10-21',480,'draft','2026-10-21','2026-10-21')", worker.id);
  f.run('DELETE FROM notifications');
  await runReminders(at());
  assert.equal(reminderKinds(worker.id).includes('timesheet_reminder'), false, 'logged time this week');
});

test('reminders: nothing is created at night, and the day count helper is exact', async () => {
  f.leave('old', worker.id, { created_at: '2026-10-01T00:00:00Z', start_date: '2026-11-20', end_date: '2026-11-20' });
  assert.equal((await runReminders(at({ hour: 22 }))).skipped, 'outside working hours');
  assert.equal(f.get('SELECT COUNT(*) n FROM notifications').n, 0);
  assert.equal(daysUntil('2026-10-30', '2026-10-23'), 7);
  assert.equal(daysUntil('2026-10-20', '2026-10-23'), -3);
});

test('reminders: the 8 am run turns daily-summary choices into one email', async () => {
  enableMail();
  await call(manager, { action: 'savePreferences', preferences: [{ kind: 'approval_reminder', inApp: true, email: 'daily' }] });
  f.leave('old', worker.id, { start_date: '2026-11-20', end_date: '2026-11-20', created_at: '2026-10-19T09:00:00Z' });
  await runReminders(at({ hour: 7 }));
  assert.equal(f.get("SELECT COUNT(*) n FROM email_outbox WHERE to_address = 'manager@example.test'").n, 0, 'summaries wait for 8 am');
  await runReminders(at({ hour: 8 }));
  const mail = f.rows("SELECT * FROM email_outbox WHERE to_address = 'manager@example.test'");
  assert.equal(mail.length, 1);
  assert.match(mail[0].subject, /waiting for your decision|summary/);
});

test('data scopes never mix: live events do not reach test accounts and test accounts are never emailed', async () => {
  enableMail();
  const tester = f.employee('tester', { data_scope: 'qa-bots-v1' });
  const news = await ops(hr, { action: 'saveAnnouncement', title: 'Live news', body: 'For live staff', status: 'published' });
  assert.equal(news.status, 200);
  assert.equal(inboxOf(tester.id).length, 0, 'a live announcement does not reach a test account');
  assert.ok(inboxOf(worker.id).some(row => row.kind === 'announcement'));
  assert.equal(await notify({ scope: 'live', recipients: tester.id, kind: 'task_assigned', title: 'x', dedupeKey: 's1' }), 0, 'wrong scope is skipped');
  assert.equal(await notify({ scope: 'qa-bots-v1', recipients: tester.id, kind: 'task_assigned', title: 'In scope', dedupeKey: 's2' }), 1);
  assert.equal(f.get("SELECT COUNT(*) n FROM email_outbox WHERE to_address = 'tester@example.test'").n, 0, 'test accounts are never emailed');
  assert.equal(inboxOf(tester.id)[0].email_mode, 'off');
});

test('reminders only ever notify live accounts', async () => {
  const tester = f.employee('tester2', { data_scope: 'qa-bots-v1' });
  f.run("INSERT INTO tasks (id,title,assignee_id,due_date,status,created_by,created_at,data_scope) VALUES ('tt','Test task',?,'2026-10-20','pending',?,'2026-10-01','qa-bots-v1')", tester.id, tester.id);
  await runReminders(at());
  assert.equal(inboxOf(tester.id).length, 0);
});
