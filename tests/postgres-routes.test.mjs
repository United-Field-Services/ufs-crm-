// The real pages' server code (state, leave, people, tasks, notifications, invites) running on Postgres: the app's database
// object is replaced by the Supabase adapter, whose HTTPS call is answered by an in-process Postgres running
// supabase/executor.sql. Nothing here touches the network or SQLite.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { fixture, asUser, jsonRequest, origin } from './harness.mjs';

const file = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const { createSupabaseDatabase } = await import('../lib/supabase-db.ts');
const action = await import('../app/api/action/route.ts');
const state = await import('../app/api/state/route.ts');
const notifications = await import('../app/api/notifications/route.ts');
const operations = await import('../app/api/operations/route.ts');

let pg, f, site, seeded = 0;
const sent = [];
before(async () => {
  pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role;');
  await pg.exec(file('supabase/schema.sql'));
  await pg.exec(file('supabase/executor.sql'));
  f = fixture(); // only for its request plumbing; its SQLite database is replaced below
  const fetcher = async (url, init) => {
    sent.push(url);
    try {
      const { statements } = JSON.parse(init.body);
      const { rows } = await pg.query('select public.ufs_batch($1::jsonb) r', [JSON.stringify(statements)]);
      return Response.json(rows[0].r);
    } catch (error) { return Response.json({ message: error.message, code: error.code }, { status: 400 }); }
  };
  site = createSupabaseDatabase('https://example-project.supabase.co', 'service-key', fetcher);
  f.env.DB = site;
});
after(() => f.close());

async function person(id, role = 'employee', overrides = {}) {
  const values = { id, user_id: `identity-${id}`, email: `${id}@example.test`, name: `Test ${id}`, title: 'Tester', department: 'Operations', location: 'United States', employment: 'Full-Time', hire_date: '2025-01-01', role, active: 1, annual_allowance: 15, sick_allowance: 5, wfh_allowance: 30, bereavement_allowance: 3, demo: 0, created_at: '2026-01-01T00:00:00Z', ...overrides };
  const keys = Object.keys(values);
  await site.prepare(`INSERT INTO employees (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map(key => values[key])).run();
  seeded++;
  return values;
}
const act = (who, body) => asUser(who, () => action.POST(jsonRequest(body)));
const ops = (who, body) => asUser(who, () => operations.POST(new Request(`${origin}/api/operations`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })));
const one = async (sql, ...args) => (await site.prepare(sql).bind(...args).first());

let admin, manager, worker;
test('people can be created in Postgres and the signed-in person is found', async () => {
  admin = await person('admin', 'admin');
  manager = await person('manager', 'manager', { manager_id: 'admin' });
  worker = await person('worker', 'employee', { manager_id: 'manager' });
  const response = await asUser(worker, () => state.GET(new Request(`${origin}/api/state`)));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.me.id, 'worker');
  assert.equal(typeof body.me.annual_allowance, 'number', 'numbers stay numbers');
  assert.ok(Array.isArray(body.people) && body.people.length >= 1);
  assert.deepEqual(body.balances.map(entry => [entry.type, entry.total, entry.used, entry.pending]), [['Vacation', 15, 0, 0], ['Sick Leave', 5, 0, 0], ['WFH', 30, 0, 0], ['Bereavement', 3, 0, 0]]);
});

test('time off: request, notify the approver, approve, balances and audit trail', async () => {
  const request = await act(worker, { action: 'requestLeave', type: 'Vacation', startDate: '2026-11-09', endDate: '2026-11-10', hours: 8 });
  assert.equal(request.status, 200, await request.clone().text());
  const { id } = await request.json();
  assert.equal((await one('SELECT status,days,required_manager_id FROM leave_requests WHERE id=?', id)).required_manager_id, 'manager');
  const inbox = await (await asUser(manager, () => notifications.GET())).json();
  assert.equal(inbox.unread, 1);
  assert.match(inbox.items[0].title, /asked for 2 days of Vacation/);

  assert.equal((await act(worker, { action: 'reviewLeave', id, status: 'approved' })).status, 403, 'only the assigned manager can approve');
  const approved = await act(manager, { action: 'reviewLeave', id, status: 'approved' });
  assert.equal(approved.status, 200, await approved.clone().text());
  assert.equal((await one('SELECT status FROM leave_requests WHERE id=?', id)).status, 'approved');
  const body = await (await asUser(worker, () => state.GET(new Request(`${origin}/api/state`)))).json();
  assert.deepEqual(body.balances[0], { type: 'Vacation', total: 15, used: 2, pending: 0 });
  assert.equal((await one("SELECT COUNT(*) n FROM audit WHERE target_id = ?", id)).n, 2, 'one audit row for the request and one for the decision');
  assert.match((await (await asUser(worker, () => notifications.GET())).json()).items[0].title, /was approved/);
  const again = await act(manager, { action: 'reviewLeave', id, status: 'rejected' });
  assert.equal(again.status, 409, 'a decided request cannot be decided twice');
});

test('overlapping requests are refused by the database', async () => {
  const clash = await act(worker, { action: 'requestLeave', type: 'Vacation', startDate: '2026-11-10', endDate: '2026-11-11', hours: 8 });
  assert.equal(clash.status, 409);
});

test('adding an employee: profile row, duplicate email message, and the admin-only role choice', async () => {
  const hire = overrides => ({ action: 'createEmployee', name: 'Pat Hire', email: 'pat@example.test', title: 'Clerk', department: 'Finance', location: 'United States', hireDate: new Date().toISOString().slice(0, 10), role: 'manager', ...overrides });
  const created = await act(admin, hire());
  assert.equal(created.status, 200, await created.clone().text());
  const row = await one("SELECT id,role,manager_id FROM employees WHERE email = 'pat@example.test'");
  assert.equal(row.role, 'manager');
  assert.equal((await one('SELECT division FROM employee_profiles WHERE employee_id = ?', row.id)).division, 'Finance');
  const duplicate = await act(admin, hire());
  assert.equal(duplicate.status, 409);
  assert.match((await duplicate.json()).error, /already uses that email/);
});

test('tasks, announcements and the unread counts work on Postgres', async () => {
  const task = await act(admin, { action: 'createTask', title: 'Collect handbook', assigneeId: 'worker', dueDate: '2026-11-20' });
  assert.equal(task.status, 200, await task.clone().text());
  const taskId = (await one("SELECT id FROM tasks WHERE title = 'Collect handbook'")).id;
  assert.equal((await act(worker, { action: 'toggleTask', id: taskId, status: 'completed' })).status, 200);
  assert.equal((await one('SELECT status FROM tasks WHERE id = ?', taskId)).status, 'completed');
  const news = await ops(admin, { action: 'saveAnnouncement', title: 'Office closed Friday', body: 'See you Monday.', status: 'published' });
  assert.equal(news.status, 200, await news.clone().text());
  const list = await (await asUser(worker, () => notifications.GET())).json();
  assert.ok(list.items.some(item => item.kind === 'announcement'));
  const mark = await asUser(worker, () => notifications.POST(new Request(`${origin}/api/notifications`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'markAllRead' }) })));
  assert.equal(mark.status, 200);
  assert.equal((await (await asUser(worker, () => notifications.GET())).json()).unread, 0);
});

test('role rules still hold: an employee cannot use HR actions', async () => {
  const before = (await one('SELECT COUNT(*) n FROM employees')).n;
  const refused = await act(worker, { action: 'createEmployee', name: 'No Way', email: 'noway@example.test', title: 't', department: 'd', location: 'United States', hireDate: '2026-11-02' });
  assert.equal(refused.status, 403);
  assert.equal((await one('SELECT COUNT(*) n FROM employees')).n, before);
});

test('the whole run used the Postgres function and nothing else', () => {
  assert.ok(sent.length > 50);
  assert.ok(sent.every(url => url === 'https://example-project.supabase.co/rest/v1/rpc/ufs_batch'));
  assert.ok(seeded >= 3);
});
