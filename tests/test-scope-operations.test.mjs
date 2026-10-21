import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, asUser, jsonRequest } from './harness.mjs';

// These are synthetic in-memory route sessions, not real sign-ins or hosted tests.
const api = await import('../app/api/operations/route.ts');
const scopes = ['live', 'qa-bots-v1'];
const roles = ['admin', 'hr_manager', 'manager', 'hiring_manager', 'employee'];
const tables = ['workflow_templates', 'workflow_runs', 'tasks', 'assets', 'asset_history', 'announcements', 'announcement_reads', 'time_entries', 'document_acknowledgements', 'audit'];
let f, users;
beforeEach(() => {
  f = fixture();
  users = Object.fromEntries(scopes.map((scope, i) => {
    const group = Object.fromEntries(roles.map(role => [role, f.employee(`scope-${i}-${role}`, { role, data_scope: scope })]));
    f.run('UPDATE employees SET manager_id=? WHERE id=?', group.manager.id, group.employee.id);
    group.employee.manager_id = group.manager.id;
    return [scope, group];
  }));
});
afterEach(() => f.close());
const act = (who, body) => asUser(who, () => api.POST(jsonRequest(body)));
const state = who => asUser(who, () => api.GET());
const template = (extra = {}) => ({ action: 'saveTemplate', name: 'Synthetic checklist', kind: 'Onboarding', steps: [{ title: 'Employee step', assignee: 'employee', offset: 0 }, { title: 'Manager step', assignee: 'manager', offset: 1 }, { title: 'HR step', assignee: 'hr', offset: -1 }], ...extra });
const asset = (extra = {}) => ({ action: 'saveAsset', name: 'Synthetic laptop', category: 'Laptop', tag: 'SYNTHETIC-001', ...extra });
const notice = (extra = {}) => ({ action: 'saveAnnouncement', title: 'Synthetic announcement', body: 'Synthetic scope-specific content', status: 'published', ...extra });
const time = (extra = {}) => ({ action: 'saveTime', date: '2026-01-01', minutes: 60, project: 'Synthetic project', notes: 'Synthetic fixture', ...extra });
async function saved(who, body) {
  const result = await act(who, body);
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  return (await result.json()).id;
}
const rejected = response => assert.ok([400, 403, 404, 409].includes(response.status), `Unexpected ${response.status}`);
const snapshot = () => JSON.stringify(Object.fromEntries(tables.map(table => [table, f.rows(`SELECT * FROM ${table} ORDER BY id`)])));
// Route guards must still fail closed on corrupt historical rows and in-flight changes.
// Only remove scope triggers from this disposable SQLite fixture to test that layer
// independently; production code never removes or disables database constraints.
function disableFixtureScopeTriggers() {
  for (const { name } of f.rows("SELECT name FROM sqlite_master WHERE type='trigger' AND sql LIKE '%data_scope%'")) {
    f.run(`DROP TRIGGER "${name.replaceAll('"', '""')}"`);
  }
}
function insert(table, values) {
  assert.ok(scopes.includes(values.data_scope), 'Every manually inserted scoped fixture must declare its scope');
  f.run(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`, ...Object.values(values));
}
async function atWrite(match, start, change) {
  const prepare = f.env.DB.prepare;
  let hit = false, changedSnapshot;
  f.env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (match.test(sql)) {
      const run = statement.run;
      statement.run = async () => {
        if (!hit) { hit = true; await change(); changedSnapshot = snapshot(); }
        return run();
      };
    }
    return statement;
  };
  try {
    const result = await start();
    assert.ok(hit, `Expected write ${match}`);
    return { result, changedSnapshot };
  } finally { f.env.DB.prepare = prepare; }
}
async function seed(scope) {
  const u = users[scope];
  const templateId = await saved(u.hr_manager, template());
  const workflowId = await saved(u.hr_manager, { action: 'applyTemplate', templateId, employeeId: u.employee.id, startDate: '2026-01-05' });
  const assetId = await saved(u.hr_manager, asset());
  assert.equal((await act(u.hr_manager, { action: 'assignAsset', id: assetId, employeeId: u.employee.id })).status, 200);
  const inventoryId = await saved(u.hr_manager, asset({ tag: 'SYNTHETIC-002' }));
  const noticeId = await saved(u.hr_manager, notice());
  const draftId = await saved(u.hr_manager, notice({ status: 'draft' }));
  const timeId = await saved(u.employee, time());
  assert.equal((await act(u.employee, { action: 'submitTime', id: timeId })).status, 200);
  const draftTimeId = await saved(u.employee, time({ date: '2026-01-02' }));
  const documentId = `company-${scope}`;
  f.document(documentId, u.admin.id, { visibility: 'company', data_scope: scope, object_key: `${scope === 'live' ? '' : 'test/qa-bots-v1/'}documents/${u.admin.id}/${documentId}` });
  assert.equal((await act(u.employee, { action: 'acknowledgeDocument', id: documentId })).status, 200);
  assert.equal((await act(u.employee, { action: 'readAnnouncement', id: noticeId })).status, 200);
  return { templateId, workflowId, assetId, inventoryId, noticeId, draftId, timeId, draftTimeId, documentId };
}

for (const scope of scopes) {
  test(`${scope}: all roles see only scoped operational rows and original role permissions`, async () => {
    const mine = await seed(scope), otherScope = scopes.find(s => s !== scope), other = await seed(otherScope);
    for (const role of roles) {
      const result = await state(users[scope][role]);
      assert.equal(result.status, 200);
      const data = await result.json(), hr = ['admin', 'hr_manager'].includes(role), employee = role === 'employee', manager = role === 'manager';
      assert.equal(data.templates.length, hr ? 1 : 0);
      assert.equal(data.workflows.length, hr || employee || manager ? 1 : 0);
      assert.equal(data.assets.length, hr ? 2 : employee ? 1 : 0);
      assert.equal(data.announcements.length, hr ? 2 : 1);
      assert.equal(data.timeEntries.length, hr || employee ? 2 : manager ? 1 : 0);
      assert.equal(data.acknowledgements.length, hr || employee ? 1 : 0);
      for (const id of Object.values(other)) assert.equal(JSON.stringify(data).includes(id), false, `${role} leaked ${id}`);
      if (data.workflows.length) assert.equal(data.workflows[0].total, 3);
      if (hr) assert.equal(data.announcements.find(n => n.id === mine.noticeId).read_count, 1);
      else assert.equal('read_count' in data.announcements[0], false);
    }
    for (const table of tables) {
      assert.ok(f.rows(`SELECT * FROM ${table} WHERE data_scope=?`, scope).length, `${table} has inherited ${scope}`);
      assert.equal(f.get(`SELECT COUNT(*) n FROM ${table} WHERE data_scope NOT IN (?,?)`, ...scopes).n, 0);
    }
  });

  test(`${scope}: direct foreign-scope IDs cannot update, assign, acknowledge, or review`, async () => {
    const mine = await seed(scope), foreign = await seed(scopes.find(s => s !== scope)), u = users[scope], foreignUser = users[scopes.find(s => s !== scope)].employee;
    const requests = [
      [u.hr_manager, template({ id: foreign.templateId, name: 'Changed' })],
      [u.hr_manager, { action: 'archiveTemplate', id: foreign.templateId }],
      [u.hr_manager, { action: 'applyTemplate', templateId: foreign.templateId, employeeId: u.employee.id, startDate: '2026-01-01' }],
      [u.hr_manager, { action: 'applyTemplate', templateId: mine.templateId, employeeId: foreignUser.id, startDate: '2026-01-01' }],
      [u.hr_manager, asset({ id: foreign.assetId, name: 'Changed' })],
      [u.hr_manager, { action: 'assignAsset', id: foreign.inventoryId, employeeId: u.employee.id }],
      [u.hr_manager, { action: 'assignAsset', id: mine.inventoryId, employeeId: foreignUser.id }],
      [u.hr_manager, { action: 'returnAsset', id: foreign.assetId }],
      [u.hr_manager, { action: 'setAssetStatus', id: foreign.inventoryId, status: 'retired' }],
      [u.hr_manager, notice({ id: foreign.noticeId, body: 'Changed' })],
      [u.employee, { action: 'readAnnouncement', id: foreign.noticeId }],
      [u.employee, { action: 'acknowledgeDocument', id: foreign.documentId }],
      [u.employee, time({ id: foreign.draftTimeId })],
      [u.employee, { action: 'submitTime', id: foreign.draftTimeId }],
      [u.employee, { action: 'deleteTime', id: foreign.draftTimeId }],
      [u.manager, { action: 'reviewTime', id: foreign.timeId, status: 'approved' }],
    ];
    const before = snapshot();
    for (const [actor, body] of requests) rejected(await act(actor, body));
    assert.equal(snapshot(), before);
  });

  test(`${scope}: browser-supplied scope cannot choose a row partition`, async () => {
    const actor = users[scope].hr_manager;
    for (const key of ['data_scope', 'dataScope', 'scope', 'test_scope', 'testMode']) {
      assert.equal((await act(actor, notice({ [key]: scopes.find(s => s !== scope) }))).status, 400);
    }
    assert.equal(f.get('SELECT COUNT(*) n FROM announcements').n, 0);
    assert.equal(f.get('SELECT COUNT(*) n FROM audit').n, 0);
  });

  test(`${scope}: workflow manager and time manager must belong to the actor's scope`, async () => {
    disableFixtureScopeTriggers();
    const u = users[scope], foreign = users[scopes.find(s => s !== scope)];
    const templateId = await saved(u.hr_manager, template());
    const timeId = await saved(u.employee, time());
    f.run('UPDATE employees SET manager_id=? WHERE id=?', foreign.manager.id, u.employee.id);
    const before = snapshot();
    rejected(await act(u.hr_manager, { action: 'applyTemplate', templateId, employeeId: u.employee.id, startDate: '2026-01-01' }));
    rejected(await act(u.employee, { action: 'submitTime', id: timeId }));
    assert.equal(snapshot(), before);
  });

  test(`${scope}: aggregates and idempotent receipt lookups ignore foreign-scope rows`, async () => {
    const mine = await seed(scope), u = users[scope], foreignScope = scopes.find(s => s !== scope), foreign = users[foreignScope];
    disableFixtureScopeTriggers();
    insert('tasks', { id: 'foreign-task', title: 'Synthetic other scope', description: '', assignee_id: foreign.employee.id, related_employee_id: foreign.employee.id, due_date: '2026-01-01', status: 'completed', created_by: foreign.hr_manager.id, created_at: '2026-01-01', workflow_id: mine.workflowId, data_scope: foreignScope });
    insert('announcement_reads', { id: 'foreign-read', announcement_id: mine.noticeId, employee_id: foreign.employee.id, read_at: '2026-01-01', data_scope: foreignScope });
    const data = await (await state(u.hr_manager)).json();
    assert.equal(data.workflows[0].total, 3);
    assert.equal(data.workflows[0].completed, 0);
    assert.equal(data.announcements.find(n => n.id === mine.noticeId).read_count, 1);
    f.run('UPDATE announcement_reads SET data_scope=? WHERE id=?', foreignScope, `${mine.noticeId}:${u.employee.id}`);
    f.run('UPDATE document_acknowledgements SET data_scope=? WHERE id=?', foreignScope, `${mine.documentId}:${u.employee.id}`);
    assert.equal((await act(u.employee, { action: 'readAnnouncement', id: mine.noticeId })).status, 404);
    assert.equal((await act(u.employee, { action: 'acknowledgeDocument', id: mine.documentId })).status, 404);
    const own = await (await state(u.employee)).json();
    assert.equal(own.announcements.find(n => n.id === mine.noticeId).read_at, null);
    assert.deepEqual(own.acknowledgements, []);
  });

  test(`${scope}: mismatched referenced owners, assignees, and managers stay hidden`, async () => {
    const mine = await seed(scope), u = users[scope], foreign = users[scopes.find(s => s !== scope)];
    disableFixtureScopeTriggers();
    f.run('UPDATE workflow_runs SET employee_id=? WHERE id=?', foreign.employee.id, mine.workflowId);
    f.run('UPDATE assets SET assigned_to=? WHERE id=?', foreign.employee.id, mine.assetId);
    f.run('UPDATE announcements SET created_by=? WHERE id=?', foreign.hr_manager.id, mine.noticeId);
    f.run('UPDATE time_entries SET required_manager_id=? WHERE id=?', foreign.manager.id, mine.timeId);
    f.run('UPDATE documents SET owner_id=? WHERE id=?', foreign.admin.id, mine.documentId);
    const data = await (await state(u.hr_manager)).json();
    assert.equal(data.workflows.length, 0);
    assert.deepEqual(data.assets.map(a => a.id), [mine.inventoryId]);
    assert.deepEqual(data.announcements.map(a => a.id), [mine.draftId]);
    assert.deepEqual(data.timeEntries.map(t => t.id), [mine.draftTimeId]);
    assert.deepEqual(data.acknowledgements, []);
    rejected(await act(u.employee, { action: 'readAnnouncement', id: mine.noticeId }));
    rejected(await act(u.employee, { action: 'acknowledgeDocument', id: mine.documentId }));
    rejected(await act(u.hr_manager, { action: 'returnAsset', id: mine.assetId }));
  });
}

test('concurrent scoped writes permit identical asset tags but enforce scoped duplicates', async () => {
  const results = await Promise.all(scopes.map(scope => act(users[scope].hr_manager, asset())));
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  assert.equal(f.get('SELECT COUNT(*) n FROM assets').n, 2);
  for (const scope of scopes) assert.equal((await act(users[scope].hr_manager, asset())).status, 409);
});

test('time daily totals exclude deliberately mismatched-scope records', async () => {
  const scope = 'qa-bots-v1', employee = users[scope].employee;
  disableFixtureScopeTriggers();
  insert('time_entries', { id: 'foreign-time', employee_id: employee.id, date: '2026-01-01', minutes: 1440, status: 'draft', created_at: '2026-01-01', updated_at: '2026-01-01', data_scope: 'live' });
  assert.equal((await act(employee, time({ minutes: 1440 }))).status, 200);
  assert.equal((await act(employee, time({ minutes: 1 }))).status, 409);
});

const mutationCases = {
  saveTemplate: u => [u.hr_manager, template({ name: 'New checklist' }), /^INSERT INTO workflow_templates/],
  editTemplate: (u, m) => [u.hr_manager, template({ id: m.templateId, name: 'Changed' }), /^INSERT INTO workflow_templates/, 'workflow_templates', m.templateId],
  archiveTemplate: (u, m) => [u.hr_manager, { action: 'archiveTemplate', id: m.templateId }, /^UPDATE workflow_templates/, 'workflow_templates', m.templateId],
  applyTemplate: (u, m) => [u.hr_manager, { action: 'applyTemplate', templateId: m.templateId, employeeId: u.employee.id, startDate: '2026-01-01' }, /^INSERT INTO workflow_runs/, 'workflow_templates', m.templateId],
  saveAsset: u => [u.hr_manager, asset({ tag: 'THIRD' }), /^INSERT INTO assets/],
  editAsset: (u, m) => [u.hr_manager, asset({ id: m.inventoryId, name: 'Changed', tag: 'CHANGED' }), /^UPDATE assets SET name=/, 'assets', m.inventoryId],
  assignAsset: (u, m) => [u.hr_manager, { action: 'assignAsset', id: m.inventoryId, employeeId: u.employee.id }, /^UPDATE assets SET status=/, 'assets', m.inventoryId],
  returnAsset: (u, m) => [u.hr_manager, { action: 'returnAsset', id: m.assetId }, /^UPDATE assets SET status=/, 'assets', m.assetId],
  setAssetStatus: (u, m) => [u.hr_manager, { action: 'setAssetStatus', id: m.inventoryId, status: 'retired' }, /^UPDATE assets SET status=/, 'assets', m.inventoryId],
  saveAnnouncement: u => [u.hr_manager, notice(), /^INSERT INTO announcements/],
  editAnnouncement: (u, m) => [u.hr_manager, notice({ id: m.noticeId, title: 'Changed' }), /^INSERT INTO announcements/, 'announcements', m.noticeId],
  readAnnouncement: (u, m) => [u.employee, { action: 'readAnnouncement', id: m.noticeId }, /^INSERT OR IGNORE INTO announcement_reads/, 'announcements', m.noticeId],
  saveTime: u => [u.employee, time({ date: '2026-01-03' }), /^INSERT INTO time_entries/],
  editTime: (u, m) => [u.employee, time({ id: m.draftTimeId }), /^INSERT INTO time_entries/, 'time_entries', m.draftTimeId],
  submitTime: (u, m) => [u.employee, { action: 'submitTime', id: m.draftTimeId }, /^UPDATE time_entries SET status='submitted'/, 'time_entries', m.draftTimeId],
  reviewTime: (u, m) => [u.manager, { action: 'reviewTime', id: m.timeId, status: 'approved' }, /^UPDATE time_entries SET status=\?/, 'time_entries', m.timeId],
  deleteTime: (u, m) => [u.employee, { action: 'deleteTime', id: m.draftTimeId }, /^UPDATE time_entries SET status='cancelled'/, 'time_entries', m.draftTimeId],
  acknowledgeDocument: (u, m) => [u.employee, { action: 'acknowledgeDocument', id: m.documentId }, /^INSERT OR IGNORE INTO document_acknowledgements/, 'documents', m.documentId],
};
for (const [kind, prepareCase] of Object.entries(mutationCases)) {
  for (const change of (['saveTemplate', 'saveAsset', 'saveAnnouncement', 'saveTime'].includes(kind) ? ['actor'] : ['actor', 'target'])) test(`${kind}: ${change} scope change immediately before mutation fails closed`, async () => {
    const scope = 'qa-bots-v1', u = users[scope], mine = await seed(scope);
    const [actor, body, match, table, id] = prepareCase(u, mine);
    disableFixtureScopeTriggers();
    f.run('DELETE FROM audit');
    const { result, changedSnapshot } = await atWrite(match, () => act(actor, body), () => {
      f.run(`UPDATE ${change === 'actor' ? 'employees' : table} SET data_scope=? WHERE id=?`, 'live', change === 'actor' ? actor.id : id);
    });
    rejected(result);
    assert.equal(snapshot(), changedSnapshot);
    assert.equal(f.get('SELECT COUNT(*) n FROM audit').n, 0);
  });
}

for (const [label, kind, reference] of [
  ['workflow employee', 'applyTemplate', u => u.employee.id],
  ['workflow manager', 'applyTemplate', u => u.manager.id],
  ['template author', 'applyTemplate', u => u.hr_manager.id],
  ['asset assignee', 'assignAsset', u => u.employee.id],
  ['previous asset assignee', 'returnAsset', u => u.employee.id],
  ['time manager', 'submitTime', u => u.manager.id],
  ['review subject', 'reviewTime', u => u.employee.id],
  ['document owner', 'acknowledgeDocument', u => u.admin.id],
]) test(`${label}: cross-scope reference introduced at mutation prevents any write`, async () => {
  const u = users['qa-bots-v1'], mine = await seed('qa-bots-v1');
  const [actor, body, match] = mutationCases[kind](u, mine);
  disableFixtureScopeTriggers();
  f.run('DELETE FROM audit');
  const { result, changedSnapshot } = await atWrite(match, () => act(actor, body), () => f.run('UPDATE employees SET data_scope=? WHERE id=?', 'live', reference(u)));
  rejected(result);
  assert.equal(snapshot(), changedSnapshot);
});

test('foreign-scope asset history cannot interfere with a scoped movement version', async () => {
  const u = users['qa-bots-v1'], mine = await seed('qa-bots-v1');
  disableFixtureScopeTriggers();
  const { result } = await atWrite(/^UPDATE assets SET status=/, () => act(u.hr_manager, { action: 'returnAsset', id: mine.assetId }), () => insert('asset_history', { id: 'foreign-history', asset_id: mine.assetId, employee_id: users.live.employee.id, action: 'synthetic', actor_id: users.live.hr_manager.id, created_at: '2026-01-01', data_scope: 'live' }));
  assert.equal(result.status, 200);
  assert.equal(f.get('SELECT status FROM assets WHERE id=?', mine.assetId).status, 'available');
  assert.equal(f.get("SELECT COUNT(*) n FROM asset_history WHERE data_scope='qa-bots-v1'").n, 2);
});

test('operations response is withheld if actor scope changes after private reads', async () => {
  await seed('qa-bots-v1');
  const actor = users['qa-bots-v1'].hr_manager, prepare = f.env.DB.prepare;
  disableFixtureScopeTriggers();
  let hit = false;
  f.env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (/SELECT a.document_id,a.employee_id,a.acknowledged_at/.test(sql)) {
      const all = statement.all;
      statement.all = async () => {
        const result = await all();
        if (!hit) { hit = true; f.run("UPDATE employees SET data_scope='live' WHERE id=?", actor.id); }
        return result;
      };
    }
    return statement;
  };
  try {
    const result = await state(actor);
    assert.ok(hit);
    assert.equal(result.status, 403);
    assert.equal('templates' in await result.json(), false);
  } finally { f.env.DB.prepare = prepare; }
});
