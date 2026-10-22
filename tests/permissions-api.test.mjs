// Server-side permission checks, called directly (not through the screen), as the QA report asked.
// Each privileged action is sent with a session of a role that must not use it and has to be refused with 403
// without changing any record.
import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, asUser, origin } from './harness.mjs';

const action = await import('../app/api/action/route.ts');
const operations = await import('../app/api/operations/route.ts');
let f, admin, hr, manager, hiring, employee;
beforeEach(() => {
  f = fixture();
  admin = f.employee('admin', { role: 'admin' });
  hr = f.employee('hr', { role: 'hr_manager' });
  manager = f.employee('manager', { role: 'manager' });
  hiring = f.employee('hiring', { role: 'hiring_manager' });
  employee = f.employee('worker', { manager_id: manager.id });
});
afterEach(() => f.close());

const post = (route, who, path, body) => asUser(who, () => route.POST(new Request(`${origin}${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })));
const act = (who, body) => post(action, who, '/api/action', body);
const ops = (who, body) => post(operations, who, '/api/operations', body);
const snapshot = () => JSON.stringify(['employees', 'events', 'tasks', 'workflow_templates', 'assets', 'announcements', 'entitlements'].map(table => f.get(`SELECT COUNT(*) n FROM ${table}`).n));

const step = { title: 'Step', assignee: 'employee', offset: 0, description: '' };
// Needs HR or Super admin.
const HR_ONLY = [
  ['createEmployee', act, { action: 'createEmployee', name: 'X Y', email: 'x@example.test', title: 'T', department: 'D', location: 'United States', hireDate: '2026-11-02' }],
  ['addEvent', act, { action: 'addEvent', title: 'Event', date: '2026-11-02', kind: 'Company event', location: 'All locations' }],
  ['createTask', act, () => ({ action: 'createTask', title: 'Task', assigneeId: employee.id, dueDate: '2026-11-02' })],
  ['updateBudgets', act, () => ({ action: 'updateBudgets', employeeId: employee.id, year: 2026, budgets: { Vacation: 20 } })],
  ['saveTemplate', ops, { action: 'saveTemplate', name: 'T', kind: 'Onboarding', steps: [step] }],
  ['applyTemplate', ops, () => ({ action: 'applyTemplate', templateId: 'x', employeeId: employee.id, startDate: '2026-11-02' })],
  ['archiveTemplate', ops, { action: 'archiveTemplate', id: 'x' }],
  ['restoreTemplate', ops, { action: 'restoreTemplate', id: 'x' }],
  ['saveAsset', ops, { action: 'saveAsset', name: 'Laptop', tag: 'T-1', category: 'Laptop' }],
  ['assignAsset', ops, () => ({ action: 'assignAsset', id: 'x', employeeId: employee.id })],
  ['returnAsset', ops, { action: 'returnAsset', id: 'x' }],
  ['setAssetStatus', ops, { action: 'setAssetStatus', id: 'x', status: 'retired' }],
  ['saveAnnouncement', ops, { action: 'saveAnnouncement', title: 'News', body: 'Body', status: 'published' }],
];
const body = value => (typeof value === 'function' ? value() : value);

for (const role of ['employee', 'manager', 'hiring']) {
  test(`HR-only actions are refused for a ${role} session and change nothing`, async () => {
    const who = { employee, manager, hiring }[role];
    const before = snapshot();
    for (const [name, route, payload] of HR_ONLY) {
      const response = await route(who, body(payload));
      assert.equal(response.status, 403, `${name} as ${role} returned ${response.status}`);
    }
    assert.equal(snapshot(), before);
  });
}

test('only a Super admin can change roles and access; HR cannot', async () => {
  const change = { action: 'updateAccess', employeeId: employee.id, role: 'admin', active: true, managerId: manager.id };
  for (const who of [employee, manager, hiring, hr]) assert.equal((await act(who, change)).status, 403);
  assert.equal(f.get('SELECT role FROM employees WHERE id = ?', employee.id).role, 'employee');
});

test('leave can only be reviewed by managers, and only the assigned one', async () => {
  f.leave('pending-1', employee.id);
  for (const who of [employee, hiring]) assert.equal((await act(who, { action: 'reviewLeave', id: 'pending-1', status: 'approved' })).status, 403);
  assert.equal(f.get("SELECT status FROM leave_requests WHERE id = 'pending-1'").status, 'pending');
});

test('time entries can only be reviewed by their assigned manager', async () => {
  const stamp = '2026-10-01T00:00:00.000Z';
  f.run("INSERT INTO time_entries (id,employee_id,date,minutes,status,required_manager_id,created_at,updated_at) VALUES ('t1',?,'2026-10-01',480,'submitted',?,?,?)", employee.id, manager.id, stamp, stamp);
  for (const who of [employee, hiring, hr, admin]) assert.equal((await ops(who, { action: 'reviewTime', id: 't1', status: 'approved' })).status, 403, who.id);
  assert.equal(f.get("SELECT status FROM time_entries WHERE id = 't1'").status, 'submitted');
});

test('no session at all is refused before anything is read or written', async () => {
  for (const [name, route, payload] of HR_ONLY) assert.equal((await route(null, body(payload))).status, 401, name);
});

test('operations records are not readable without a session', async () => {
  const response = await asUser(null, () => operations.GET(new Request(`${origin}/api/operations?section=assets`)));
  assert.equal(response.status, 401);
});
