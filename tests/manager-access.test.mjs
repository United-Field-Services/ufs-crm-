import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, asUser, jsonRequest, uploadRequest, fileContext, fileRequest } from './harness.mjs';

const server = await import('../lib/server.ts');
const action = await import('../app/api/action/route.ts');
const state = await import('../app/api/state/route.ts');
const files = await import('../app/api/files/route.ts');
const file = await import('../app/api/files/[id]/route.ts');
let f, owner, manager, otherManager, hr, alice, bob;
beforeEach(() => {
  f = fixture();
  owner = f.employee('owner', { role: 'admin' });
  manager = f.employee('manager',{role:'manager'});
  otherManager = f.employee('other-manager',{role:'manager'});
  hr = f.employee('hr', { role: 'hr_manager' });
  alice = f.employee('alice', { manager_id: manager.id });
  bob = f.employee('bob', { manager_id: otherManager.id });
});
afterEach(() => f.close());
const act = (who, body) => asUser(who, () => action.POST(jsonRequest(body)));
const leaveBody = overrides => ({ action: 'requestLeave', type: 'Vacation', startDate: '2026-11-02', endDate: '2026-11-02', hours: 8, ...overrides });
const access = (person, overrides = {}) => ({ action: 'updateAccess', employeeId: person.id, role: person.role, active: Boolean(person.active), managerId: person.manager_id, ...overrides });
const review = (who, id, status = 'approved') => act(who, { action: 'reviewLeave', id, status });
const download = (who, id) => asUser(who, () => file.GET(fileRequest(id), fileContext(id)));

test('new leave snapshots the employee manager and ignores submitted manager identity', async () => {
  assert.equal((await act(alice, leaveBody({ managerId: owner.id, required_manager_id: owner.id }))).status, 200);
  assert.equal(f.get('SELECT required_manager_id FROM leave_requests').required_manager_id, manager.id);
});

test('only the assigned manager can approve or reject, including when others are HR or admin', async () => {
  f.leave('assigned', alice.id);
  for (const actor of [alice, bob, otherManager, hr, owner]) {
    for (const status of ['approved', 'rejected']) assert.equal((await review(actor, 'assigned', status)).status, 403);
  }
  assert.equal((await review(manager, 'assigned')).status, 200);
  assert.equal(f.get('SELECT reviewer_id FROM leave_requests').reviewer_id, manager.id);
});

test('ordinary manager sees only own and specifically assigned requests', async () => {
  f.leave('assigned', alice.id);
  f.leave('unrelated', bob.id);
  f.leave('own', manager.id, { required_manager_id: otherManager.id });
  const response = await asUser(manager, () => state.GET());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.requests.map(row => row.id).sort(), ['assigned', 'own']);
  assert.deepEqual(data.employeeBudgets, []);
  assert.deepEqual(data.activity, []);
  assert.equal(data.people.find(p => p.id === alice.id).email, undefined);
});

test('unassigned requests cannot be reviewed until an administrator assigns a manager', async () => {
  f.run('UPDATE employees SET manager_id = NULL WHERE id = ?', alice.id);
  f.leave('unassigned', alice.id);
  for (const actor of [owner, hr, manager]) assert.equal((await review(actor, 'unassigned')).status, 403);
  assert.equal((await act(owner, access(alice, { managerId: manager.id }))).status, 200);
  assert.equal(f.get('SELECT required_manager_id FROM leave_requests').required_manager_id, manager.id);
  assert.equal((await review(manager, 'unassigned')).status, 200);
});

test('manager transfers route pending requests but preserve already-reviewed history', async () => {
  f.leave('pending', alice.id);
  f.leave('approved', alice.id, { status: 'approved' });
  assert.equal((await act(owner, access(alice, { managerId: otherManager.id }))).status, 200);
  assert.equal(f.get('SELECT manager_id FROM employees WHERE id = ?', alice.id).manager_id, otherManager.id);
  assert.equal(f.get('SELECT required_manager_id FROM leave_requests WHERE id = ?', 'pending').required_manager_id, otherManager.id);
  assert.equal(f.get('SELECT required_manager_id FROM leave_requests WHERE id = ?', 'approved').required_manager_id, manager.id);
  assert.equal((await review(manager, 'pending')).status, 403);
  assert.equal((await review(otherManager, 'pending')).status, 200);
});

test('an in-flight old-manager review cannot commit after a manager transfer', async () => {
  f.leave('racing', alice.id);
  const batch = f.env.DB.batch;
  let atUpdate;
  let release;
  const reachedUpdate = new Promise(resolve => { atUpdate = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  // Pause before entering the serialized transaction. Another committed batch
  // cannot interleave inside D1's atomic write+audit transaction.
  f.env.DB.batch = async statements => {
    if (statements.some(statement => /^UPDATE leave_requests SET status = \?, reviewer_id = \?/i.test(statement.sql))) { atUpdate(); await released; }
    return batch(statements);
  };
  const inFlight = review(manager, 'racing');
  await reachedUpdate;
  try { assert.equal((await act(owner, access(alice, { managerId: otherManager.id }))).status, 200); }
  finally { release(); }
  const result = await inFlight;
  assert.ok([403, 409].includes(result.status), `Former manager still reviewed with ${result.status}`);
  assert.equal(f.get('SELECT status FROM leave_requests').status, 'pending');
});

test('an in-flight leave submission uses the manager current when the request is saved', async () => {
  const batch = f.env.DB.batch;
  let atInsert;
  let release;
  const reachedInsert = new Promise(resolve => { atInsert = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  // Pause before entering the serialized transaction. Another committed batch
  // cannot interleave inside D1's atomic write+audit transaction.
  f.env.DB.batch = async statements => {
    if (statements.some(statement => /^INSERT INTO leave_requests/i.test(statement.sql))) { atInsert(); await released; }
    return batch(statements);
  };
  const inFlight = act(alice, leaveBody());
  await reachedInsert;
  try { assert.equal((await act(owner, access(alice, { managerId: otherManager.id }))).status, 200); }
  finally { release(); }
  assert.equal((await inFlight).status, 200);
  assert.equal(f.get('SELECT required_manager_id FROM leave_requests').required_manager_id, otherManager.id);
  assert.equal((await review(manager, f.get('SELECT id FROM leave_requests').id)).status, 403);
});

test('self-approval stays blocked even for corrupted self-manager snapshots', async () => {
  for (const actor of [owner, hr, manager]) {
    f.leave(`self-${actor.id}`, actor.id, { required_manager_id: actor.id });
    assert.equal((await review(actor, `self-${actor.id}`)).status, 403);
  }
});

test('inactive subjects cannot have their pending leave approved', async () => {
  f.leave('inactive-subject', alice.id);
  assert.equal((await act(owner, access(alice, { active: false }))).status, 200);
  assert.equal((await review(manager, 'inactive-subject')).status, 409);
  assert.equal(f.get('SELECT status FROM leave_requests').status, 'pending');
});

test('an in-flight review cannot commit after the reviewer is deactivated', async () => {
  f.leave('racing-revoke', alice.id);
  const batch = f.env.DB.batch;
  let atUpdate;
  let release;
  const reachedUpdate = new Promise(resolve => { atUpdate = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  // Pause before entering the serialized transaction. Another committed batch
  // cannot interleave inside D1's atomic write+audit transaction.
  f.env.DB.batch = async statements => {
    if (statements.some(statement => /^UPDATE leave_requests SET status = \?, reviewer_id = \?/i.test(statement.sql))) { atUpdate(); await released; }
    return batch(statements);
  };
  const inFlight = review(manager, 'racing-revoke');
  await reachedUpdate;
  try { assert.equal((await act(owner, access(manager, { active: false }))).status, 200); }
  finally { release(); }
  assert.equal((await inFlight).status, 409);
  assert.equal(f.get('SELECT status FROM leave_requests').status, 'pending');
});

test('employees may attach only their own unarchived private document', async () => {
  f.document('own-private', alice.id, { category: 'Leave attachment' });
  f.document('other-private', bob.id);
  f.document('own-company', alice.id, { visibility: 'company' });
  f.document('own-archived', alice.id, { archived: 1 });
  for (const attachmentId of ['missing', 'other-private', 'own-company', 'own-archived']) {
    assert.equal((await act(alice, leaveBody({ attachmentId }))).status, 403);
  }
  assert.equal((await act(alice, leaveBody({ attachmentId: 'own-private' }))).status, 200);
  assert.equal(f.get('SELECT attachment_id FROM leave_requests').attachment_id, 'own-private');
});

test('ordinary managers can download linked attachments but no unrelated private files', async () => {
  f.document('linked', alice.id);
  f.document('same-employee-unlinked', alice.id);
  f.document('other-linked', bob.id);
  f.leave('assigned', alice.id, { attachment_id: 'linked' });
  f.leave('not-assigned', bob.id, { attachment_id: 'other-linked' });
  assert.equal((await download(manager, 'linked')).status, 200);
  for (const id of ['same-employee-unlinked', 'other-linked']) assert.equal((await download(manager, id)).status, 404);
  const response = await asUser(manager, () => state.GET());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).documents.map(d => d.id), ['linked']);
});

test('manager transfer removes old manager access to pending-request attachments', async () => {
  f.document('linked', alice.id);
  f.leave('pending', alice.id, { attachment_id: 'linked' });
  assert.equal((await download(manager, 'linked')).status, 200);
  assert.equal((await act(owner, access(alice, { managerId: otherManager.id }))).status, 200);
  assert.equal((await download(manager, 'linked')).status, 404);
  assert.equal((await download(otherManager, 'linked')).status, 200);
  const previousState = await asUser(manager, () => state.GET());
  const data = await previousState.json();
  assert.deepEqual(data.requests, []);
  assert.deepEqual(data.documents, []);
});

test('attachment permission never permits archiving another employee document', async () => {
  f.document('linked', alice.id);
  f.leave('assigned', alice.id, { attachment_id: 'linked' });
  assert.equal((await asUser(manager, () => file.DELETE(fileRequest('linked', 'DELETE'), fileContext('linked')))).status, 404);
  assert.equal(f.get('SELECT archived FROM documents').archived, 0);
  f.run('UPDATE documents SET archived = 1');
  assert.equal((await download(manager, 'linked')).status, 404);
});

test('HR employees bind preregistered accounts without gaining admin access', async () => {
  const unbound = f.employee('new-hr', { role: 'hr_manager', user_id: null });
  const signedIn = await asUser({ userId: 'new-hr-identity', email: unbound.email }, () => server.currentEmployee());
  assert.equal(signedIn.id, unbound.id);
  assert.equal(signedIn.role, 'hr_manager');
  assert.equal((await act(signedIn, access(signedIn, { role: 'admin' }))).status, 403);
});

test('HR can manage budgets, company documents, checklist tasks, and employee profiles', async () => {
  assert.equal((await act(hr, { action: 'updateBudgets', employeeId: alice.id, year: 2026, vacation: 12, sick: 5, wfh: 25, bereavement: 3 })).status, 200);
  assert.equal((await asUser(hr, () => files.POST(uploadRequest('policy.txt', 'Synthetic policy', { visibility: 'company', category: 'Policy' })))).status, 200);
  assert.equal((await act(hr, { action: 'createTask', assigneeId: alice.id, title: 'Test task', dueDate: '2026-11-02' })).status, 200);
  assert.equal((await act(hr, { action: 'createEmployee', name: 'New Person', email: 'new-person@example.test', title: 'Tester', department: 'Test', location: 'United States', hireDate: '2026-11-02', role: 'admin', user_id: 'injected-id', managerId: owner.id })).status, 200);
  const person = f.get('SELECT * FROM employees WHERE email = ?', 'new-person@example.test');
  assert.equal(person.role, 'employee');
  assert.equal(person.user_id, null);
  assert.equal(person.manager_id, hr.id);
});

test('HR cannot alter roles, managers, or active status, including its own privileges', async () => {
  for (const person of [hr, alice, owner]) {
    assert.equal((await act(hr, access(person, { role: 'hr_manager', active: false, managerId: hr.id }))).status, 403);
  }
  assert.equal(f.get('SELECT active FROM employees WHERE id = ?', alice.id).active, 1);
  assert.equal(f.get('SELECT role FROM employees WHERE id = ?', hr.id).role, 'hr_manager');
});

test('employees cannot change their own role, manager, or account status', async () => {
  assert.equal((await act(alice, access(alice, { role: 'hr_manager', managerId: bob.id }))).status, 403);
  assert.equal(f.get('SELECT role FROM employees WHERE id = ?', alice.id).role, 'employee');
  assert.equal(f.get('SELECT manager_id FROM employees WHERE id = ?', alice.id).manager_id, manager.id);
});

test('only the owner can promote HR and cannot create additional administrators', async () => {
  assert.equal((await act(owner, access(alice, { role: 'admin' }))).status, 400);
  assert.equal((await act(owner, access(alice, { role: 'hr_manager' }))).status, 200);
  assert.equal(f.get('SELECT role FROM employees WHERE id = ?', alice.id).role, 'hr_manager');
  assert.equal((await act(owner, access(alice, { role: 'employee' }))).status, 200);
  assert.equal((await act(alice, { action: 'updateBudgets' })).status, 403);
});

test('owner cannot demote or deactivate self but can assign an active second reviewer', async () => {
  assert.equal((await act(owner, access(owner, { role: 'employee' }))).status, 403);
  assert.equal((await act(owner, access(owner, { active: false }))).status, 403);
  assert.equal((await act(owner, access(owner, { managerId: otherManager.id }))).status, 200);
  assert.equal((await act(owner, leaveBody())).status, 200);
  const request = f.get('SELECT id,required_manager_id FROM leave_requests');
  assert.equal(request.required_manager_id, otherManager.id);
  assert.equal((await review(otherManager, request.id)).status, 200);
});

test('manager assignment rejects self, missing, and inactive managers', async () => {
  f.run('UPDATE employees SET active = 0 WHERE id = ?', otherManager.id);
  for (const managerId of [alice.id, 'missing', otherManager.id]) assert.equal((await act(owner, access(alice, { managerId }))).status, 400);
  assert.equal(f.get('SELECT manager_id FROM employees WHERE id = ?', alice.id).manager_id, manager.id);
});

test('deactivated users are denied every direct API path and reactivation preserves records', async () => {
  f.document('own', alice.id);
  f.leave('own-leave', alice.id);
  assert.equal((await act(owner, access(alice, { active: false }))).status, 200);
  assert.equal((await asUser(alice, () => state.GET())).status, 403);
  assert.equal((await act(alice, leaveBody())).status, 403);
  assert.equal((await asUser(alice, () => files.POST(uploadRequest()))).status, 403);
  assert.equal((await download(alice, 'own')).status, 403);
  assert.equal((await asUser(alice, () => file.DELETE(fileRequest('own', 'DELETE'), fileContext('own')))).status, 403);
  assert.equal(f.get('SELECT count(*) n FROM documents').n, 1);
  assert.equal(f.get('SELECT count(*) n FROM leave_requests').n, 1);
  assert.equal((await act(owner, access(alice, { active: true }))).status, 200);
  assert.equal((await asUser(alice, () => state.GET())).status, 200);
});

const newHire = (overrides = {}) => ({ action: 'createEmployee', name: 'New Hire', email: 'new-hire@example.test', title: 'Tester', department: 'Test', location: 'United States', hireDate: '2026-11-02', ...overrides });
const hireRow = () => f.get('SELECT * FROM employees WHERE email = ?', 'new-hire@example.test');

test('a super admin can choose the required approver of a new employee', async () => {
  assert.equal((await act(owner, newHire({ managerId: manager.id }))).status, 200);
  assert.equal(hireRow().manager_id, manager.id);
});

test('without a choice the creator stays the approver, for admin and HR alike', async () => {
  assert.equal((await act(owner, newHire())).status, 200);
  assert.equal(hireRow().manager_id, owner.id);
  f.run('DELETE FROM employee_profiles WHERE employee_id IN (SELECT id FROM employees WHERE email = ?)', 'new-hire@example.test');
  f.run('DELETE FROM employees WHERE email = ?', 'new-hire@example.test');
  assert.equal((await act(hr, newHire({ managerId: '' }))).status, 200);
  assert.equal(hireRow().manager_id, hr.id);
});

test('HR cannot pick another approver when creating an employee; the choice is ignored', async () => {
  assert.equal((await act(hr, newHire({ managerId: manager.id }))).status, 200);
  assert.equal(hireRow().manager_id, hr.id);
});

for (const [label, id] of [['an ordinary employee', 'alice'], ['an unknown id', 'no-such-person'], ['an inactive manager', 'retired-manager']]) {
  test(`a new employee cannot be assigned ${label} as approver`, async () => {
    f.employee('retired-manager', { role: 'manager', active: 0 });
    const before = f.get('SELECT COUNT(*) n FROM employees').n;
    const result = await act(owner, newHire({ managerId: id }));
    assert.equal(result.status, 400);
    assert.equal(f.get('SELECT COUNT(*) n FROM employees').n, before);
    assert.equal(f.get("SELECT COUNT(*) n FROM audit WHERE action = 'Added employee profile'").n, 0);
  });
}
