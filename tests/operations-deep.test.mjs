import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, asUser, jsonRequest, origin } from './harness.mjs';

const api = await import('../app/api/operations/route.ts');
const roles = ['admin', 'hr_manager', 'manager', 'hiring_manager', 'employee'];
let f, actors, employee, other;
beforeEach(() => {
  f = fixture();
  actors = Object.fromEntries(roles.map(role => [role, f.employee(role, { role })]));
  employee = f.employee('subject', { manager_id: actors.manager.id });
  other = f.employee('unrelated');
});
afterEach(() => f.close());
const act = (who, body) => asUser(who, () => api.POST(jsonRequest(body)));
const state = who => asUser(who, () => api.GET());
const template = (extra = {}) => ({ action: 'saveTemplate', name: 'Synthetic checklist', kind: 'Onboarding', steps: [{ title: 'Prepare', assignee: 'employee', offset: 0 }], ...extra });
const asset = (extra = {}) => ({ action: 'saveAsset', name: 'Synthetic laptop', category: 'Laptop', tag: 'SYNTHETIC-001', ...extra });
const notice = (extra = {}) => ({ action: 'saveAnnouncement', title: 'Synthetic notice', body: 'Synthetic internal content', status: 'published', ...extra });
const time = (extra = {}) => ({ action: 'saveTime', date: '2026-01-01', minutes: 60, project: 'Synthetic project', notes: 'Synthetic private work', ...extra });
async function saved(body, who = actors.hr_manager) {
  const result = await act(who, body);
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  return (await result.json()).id;
}
// Mutate fixture state just before the real SQL write, after route authentication and validation.
// This is deterministic TOCTOU injection, not a live account or external database request.
async function atWrite(match, start, change) {
  const prepare = f.env.DB.prepare;
  let hit = false;
  f.env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (match.test(sql)) {
      const run = statement.run;
      statement.run = async () => {
        if (!hit) { hit = true; await change(); }
        return run();
      };
    }
    return statement;
  };
  try {
    const result = await start();
    assert.ok(hit, `Expected SQL write matching ${match}`);
    return result;
  } finally { f.env.DB.prepare = prepare; }
}
const rejected = response => assert.ok([400, 403, 404, 409].includes(response.status), `Unexpected status ${response.status}`);
const noAudit = () => assert.equal(f.get('SELECT COUNT(*) AS n FROM audit').n, 0);

for (const role of roles) {
  test(`${role}: operations workflow, asset, news and acknowledgement read/write isolation`, async () => {
    const actor = actors[role], hr = ['admin', 'hr_manager'].includes(role);
    const templateId = await saved(template());
    const assetId = await saved(asset());
    await act(actors.hr_manager, { action: 'assignAsset', id: assetId, employeeId: employee.id });
    const ownAssetId = await saved(asset({ tag: 'OWN-ASSET' }));
    await act(actors.hr_manager, { action: 'assignAsset', id: ownAssetId, employeeId: actor.id });
    const publishedId = await saved(notice());
    const draftId = await saved(notice({ status: 'draft', title: 'Draft fixture' }));
    f.document('company', actors.admin.id, { visibility: 'company' });
    f.document('private', employee.id);
    await act(employee, { action: 'acknowledgeDocument', id: 'company' });
    const data = await (await state(actor)).json();
    assert.equal(data.templates.some(t => t.id === templateId), hr);
    assert.equal(data.assets.some(a => a.id === assetId), hr);
    assert.ok(data.assets.some(a => a.id === ownAssetId));
    assert.ok(data.announcements.some(a => a.id === publishedId));
    assert.equal(data.announcements.some(a => a.id === draftId), hr);
    assert.equal(data.acknowledgements.some(a => a.employee_id === employee.id), hr);
    for (const body of [
      { action: 'archiveTemplate', id: templateId },
      { action: 'applyTemplate', templateId, employeeId: employee.id, startDate: '2026-01-01' },
      { action: 'returnAsset', id: assetId },
      { action: 'setAssetStatus', id: ownAssetId, status: 'retired' },
    ]) {
      const result = await act(actor, body);
      if (!hr) assert.equal(result.status, 403);
      else assert.notEqual(result.status, 403);
    }
    assert.equal((await act(actor, { action: 'readAnnouncement', id: draftId })).status, 404);
    assert.equal((await act(actor, { action: 'acknowledgeDocument', id: 'private' })).status, 404);
  });
}

for (const offset of [null, false, true, [], {}, '', ' ', 'abc', 1.5, -91, 366]) {
  test(`workflow refuses invalid offset ${JSON.stringify(offset)}`, async () => {
    assert.equal((await act(actors.hr_manager, template({ steps: [{ title: 'Synthetic', assignee: 'employee', offset }] }))).status, 400);
    assert.equal(f.get('SELECT COUNT(*) AS n FROM workflow_templates').n, 0);
    noAudit();
  });
}
for (const [startDate, offset] of [['0000-01-01', -1], ['9999-12-31', 1]]) {
  test(`workflow prevents due-date year overflow from ${startDate}`, async () => {
    const templateId = await saved(template({ steps: [{ title: 'Synthetic', assignee: 'employee', offset }] }));
    f.run('DELETE FROM audit');
    assert.equal((await act(actors.hr_manager, { action: 'applyTemplate', templateId, employeeId: employee.id, startDate })).status, 400);
    assert.equal(f.get('SELECT COUNT(*) AS n FROM workflow_runs').n, 0);
    assert.equal(f.get('SELECT COUNT(*) AS n FROM tasks').n, 0);
    noAudit();
  });
}
for (const [label, change] of [
  ['employee deactivation', () => f.run('UPDATE employees SET active=0 WHERE id=?', employee.id)],
  ['template archival', id => f.run('UPDATE workflow_templates SET active=0 WHERE id=?', id)],
  ['template edit', id => f.run("UPDATE workflow_templates SET steps='[]' WHERE id=?", id)],
  ['manager demotion', () => f.run("UPDATE employees SET role='employee' WHERE id=?", actors.manager.id)],
  ['manager reassignment', () => f.run('UPDATE employees SET manager_id=? WHERE id=?', actors.admin.id, employee.id)],
]) {
  test(`workflow apply fails without partial tasks after concurrent ${label}`, async () => {
    const templateId = await saved(template({ steps: [{ title: 'Manager action', assignee: 'manager', offset: 0 }] }));
    f.run('DELETE FROM audit');
    const result = await atWrite(/^INSERT INTO workflow_runs/, () => act(actors.hr_manager, { action: 'applyTemplate', templateId, employeeId: employee.id, startDate: '2026-01-01' }), () => change(templateId));
    rejected(result);
    assert.equal(f.get('SELECT COUNT(*) AS n FROM workflow_runs').n, 0);
    assert.equal(f.get('SELECT COUNT(*) AS n FROM tasks').n, 0);
    noAudit();
  });
}
for (const mode of ['demoted', 'inactive']) for (const kind of ['saveTemplate', 'archiveTemplate', 'applyTemplate', 'saveAsset', 'assignAsset', 'returnAsset', 'setAssetStatus', 'saveAnnouncement']) {
  test(`HR ${kind} is blocked when actor is ${mode} before write`, async () => {
    const templateId = await saved(template());
    const assetId = await saved(asset());
    if (kind === 'returnAsset') await act(actors.hr_manager, { action: 'assignAsset', id: assetId, employeeId: employee.id });
    const requests = {
      saveTemplate: [template({ name: 'Changed template' }), /^INSERT INTO workflow_templates/],
      archiveTemplate: [{ action: kind, id: templateId }, /^UPDATE workflow_templates/],
      applyTemplate: [{ action: kind, templateId, employeeId: employee.id, startDate: '2026-01-01' }, /^INSERT INTO workflow_runs/],
      saveAsset: [asset({ tag: 'SECOND' }), /^INSERT INTO assets/],
      assignAsset: [{ action: kind, id: assetId, employeeId: employee.id }, /^UPDATE assets SET status=/],
      returnAsset: [{ action: kind, id: assetId }, /^UPDATE assets SET status=/],
      setAssetStatus: [{ action: kind, id: assetId, status: 'retired' }, /^UPDATE assets SET status=/],
      saveAnnouncement: [notice(), /^INSERT INTO announcements/],
    };
    const [body, match] = requests[kind];
    f.run('DELETE FROM audit');
    const before = JSON.stringify(Object.fromEntries(['workflow_templates', 'workflow_runs', 'tasks', 'assets', 'asset_history', 'announcements'].map(table => [table, f.rows(`SELECT * FROM ${table}`)])));
    rejected(await atWrite(match, () => act(actors.hr_manager, body), () => f.run(`UPDATE employees SET ${mode === 'inactive' ? 'active=0' : "role='employee'"} WHERE id=?`, actors.hr_manager.id)));
    const after = JSON.stringify(Object.fromEntries(['workflow_templates', 'workflow_runs', 'tasks', 'assets', 'asset_history', 'announcements'].map(table => [table, f.rows(`SELECT * FROM ${table}`)])));
    assert.equal(after, before);
    noAudit();
  });
}

test('asset cannot be assigned to an employee deactivated immediately before write', async () => {
  const id = await saved(asset());
  f.run('DELETE FROM audit');
  rejected(await atWrite(/^UPDATE assets SET status=/, () => act(actors.hr_manager, { action: 'assignAsset', id, employeeId: employee.id }), () => f.run('UPDATE employees SET active=0 WHERE id=?', employee.id)));
  assert.equal(f.get('SELECT status FROM assets').status, 'available');
  assert.equal(f.get('SELECT COUNT(*) AS n FROM asset_history').n, 0);
  noAudit();
});
test('concurrent duplicate asset tag receives a conflict instead of an internal error', async () => {
  const result = await atWrite(/^INSERT INTO assets/, () => act(actors.hr_manager, asset()), () => f.run('INSERT INTO assets (id,name,category,tag,created_by,updated_at) VALUES (?,?,?,?,?,?)', 'competitor', 'Synthetic competing asset', 'Laptop', 'SYNTHETIC-001', actors.hr_manager.id, '2026-01-01'));
  assert.equal(result.status, 409);
  assert.equal(f.get('SELECT COUNT(*) AS n FROM assets').n, 1);
  noAudit();
});
test('asset movement and history roll back together if history persistence fails', async () => {
  const id = await saved(asset());
  f.run('DELETE FROM audit');
  const result = await atWrite(/^INSERT INTO asset_history/, () => act(actors.hr_manager, { action: 'assignAsset', id, employeeId: employee.id }), () => { throw new Error('Synthetic storage failure'); });
  assert.equal(result.status, 500);
  assert.equal(f.get('SELECT status FROM assets').status, 'available');
  assert.equal(f.get('SELECT assigned_to FROM assets').assigned_to, null);
  noAudit();
});
test('asset stale return cannot clear a newer employee assignment', async () => {
  const id = await saved(asset());
  await act(actors.hr_manager, { action: 'assignAsset', id, employeeId: employee.id });
  f.run('DELETE FROM audit');
  const result = await atWrite(/^UPDATE assets SET status=/, () => act(actors.hr_manager, { action: 'returnAsset', id }), () => f.run('UPDATE assets SET assigned_to=? WHERE id=?', other.id, id));
  assert.equal(result.status, 409);
  assert.equal(f.get('SELECT assigned_to FROM assets').assigned_to, other.id);
  assert.equal(f.get('SELECT COUNT(*) AS n FROM asset_history').n, 1);
  noAudit();
});

for (const [kind, match] of [['saveTime', /^INSERT INTO time_entries/], ['deleteTime', /^UPDATE time_entries SET status='cancelled'/]]) {
  test(`${kind} rejects employee deactivation immediately before write`, async () => {
    const id = await saved(time(), employee);
    const before = f.get('SELECT * FROM time_entries WHERE id=?', id);
    f.run('DELETE FROM audit');
    rejected(await atWrite(match, () => act(employee, kind === 'saveTime' ? time({ id, minutes: 90 }) : { action: kind, id }), () => f.run('UPDATE employees SET active=0 WHERE id=?', employee.id)));
    assert.deepEqual(f.get('SELECT * FROM time_entries WHERE id=?', id), before);
    noAudit();
  });
}
test('a time edit racing submission never turns submitted work back into draft', async () => {
  const id = await saved(time(), employee);
  f.run('DELETE FROM audit');
  const result = await atWrite(/^INSERT INTO time_entries/, () => act(employee, time({ id, minutes: 90 })), () => f.run("UPDATE time_entries SET status='submitted',required_manager_id=? WHERE id=?", actors.manager.id, id));
  assert.equal(result.status, 409);
  assert.equal(f.get('SELECT status FROM time_entries').status, 'submitted');
  assert.equal(f.get('SELECT minutes FROM time_entries').minutes, 60);
  noAudit();
});
test('cancelled time is excluded from daily total and cannot be edited or resubmitted', async () => {
  const id = await saved(time({ minutes: 1440 }), employee);
  assert.equal((await act(employee, { action: 'deleteTime', id })).status, 200);
  assert.equal((await act(employee, time({ id }))).status, 403);
  assert.equal((await act(employee, { action: 'submitTime', id })).status, 403);
  assert.equal((await act(employee, time({ minutes: 1440 }))).status, 200);
  assert.equal(f.get("SELECT SUM(minutes) AS n FROM time_entries WHERE status<>'cancelled'").n, 1440);
});
test('moving a time entry into a full day is rejected without changing either date', async () => {
  const id = await saved(time({ date: '2026-01-01', minutes: 90 }), employee);
  await saved(time({ date: '2026-01-02', minutes: 1400 }), employee);
  assert.equal((await act(employee, time({ id, date: '2026-01-02', minutes: 90 }))).status, 409);
  assert.equal(f.get('SELECT date FROM time_entries WHERE id=?', id).date, '2026-01-01');
});

for (const [action, table, match, prepare, withdraw] of [
  ['readAnnouncement', 'announcement_reads', /^INSERT OR IGNORE INTO announcement_reads/, async () => saved(notice()), id => f.run("UPDATE announcements SET status='draft' WHERE id=?", id)],
  ['acknowledgeDocument', 'document_acknowledgements', /^INSERT OR IGNORE INTO document_acknowledgements/, async () => { f.document('company', actors.admin.id, { visibility: 'company' }); return 'company'; }, id => f.run("UPDATE documents SET visibility='hr' WHERE id=?", id)],
]) {
  test(`${action} checks publication at the write after withdrawal`, async () => {
    const id = await prepare();
    f.run('DELETE FROM audit');
    assert.equal((await atWrite(match, () => act(employee, { action, id }), () => withdraw(id))).status, 404);
    assert.equal(f.get(`SELECT COUNT(*) AS n FROM ${table}`).n, 0);
    noAudit();
  });
  test(`${action} rejects actor deactivation immediately before write`, async () => {
    const id = await prepare();
    f.run('DELETE FROM audit');
    rejected(await atWrite(match, () => act(employee, { action, id }), () => f.run('UPDATE employees SET active=0 WHERE id=?', employee.id)));
    assert.equal(f.get(`SELECT COUNT(*) AS n FROM ${table}`).n, 0);
    noAudit();
  });
}
test('document acknowledgement retries preserve one original receipt and one audit event', async () => {
  f.document('company', actors.admin.id, { visibility: 'company' });
  await act(employee, { action: 'acknowledgeDocument', id: 'company' });
  const first = f.get('SELECT * FROM document_acknowledgements');
  await act(employee, { action: 'acknowledgeDocument', id: 'company' });
  assert.deepEqual(f.get('SELECT * FROM document_acknowledgements'), first);
  assert.equal(f.get('SELECT COUNT(*) AS n FROM document_acknowledgements').n, 1);
  assert.equal(f.get('SELECT COUNT(*) AS n FROM audit').n, 1);
});
test('ordinary employees do not receive company-wide announcement read counts', async () => {
  const id = await saved(notice());
  await act(employee, { action: 'readAnnouncement', id });
  const data = await (await state(other)).json();
  assert.equal('read_count' in data.announcements[0], false);
  assert.equal((await (await state(actors.hr_manager)).json()).announcements[0].read_count, 1);
});
test('malformed JSON, arrays, oversized bodies, and cross-site fetches fail without writes', async () => {
  for (const body of ['{', 'null', '[]', JSON.stringify({ action: 'saveAnnouncement', body: 'x'.repeat(21000) })]) {
    const request = new Request(`${origin}/api/operations`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body });
    assert.ok([400, 413].includes((await asUser(actors.hr_manager, () => api.POST(request))).status));
  }
  assert.equal((await asUser(actors.hr_manager, () => api.POST(jsonRequest(notice(), { 'Sec-Fetch-Site': 'cross-site' })))).status, 403);
  noAudit();
});

for (const [field, values] of [['kind', ['Invalid', null, false, [], {}]], ['status', ['Invalid', null, false, [], {}]]]) {
  for (const value of values) test(`explicit invalid ${field} ${JSON.stringify(value)} never silently changes operation intent`, async () => {
    const body = field === 'kind' ? template({ [field]: value }) : notice({ [field]: value });
    assert.equal((await act(actors.hr_manager, body)).status, 400);
    noAudit();
  });
}
for (const status of [null, false, ['retired'], {}, 'assigned']) {
  test(`asset refuses malformed inventory status ${JSON.stringify(status)}`, async () => {
    const id = await saved(asset());
    f.run('DELETE FROM audit');
    assert.equal((await act(actors.hr_manager, { action: 'setAssetStatus', id, status })).status, 400);
    assert.equal(f.get('SELECT status FROM assets').status, 'available');
    noAudit();
  });
}
for (const returnDue of [false, 0, [], {}, '2026-02-30']) {
  test(`asset refuses malformed return date ${JSON.stringify(returnDue)}`, async () => {
    const id = await saved(asset());
    f.run('DELETE FROM audit');
    assert.equal((await act(actors.hr_manager, { action: 'assignAsset', id, employeeId: employee.id, returnDue })).status, 400);
    assert.equal(f.get('SELECT status FROM assets').status, 'available');
    noAudit();
  });
}
test('stale return cannot undo a later return and reassignment to the same employee', async () => {
  const id = await saved(asset());
  await act(actors.hr_manager, { action: 'assignAsset', id, employeeId: employee.id });
  f.run('DELETE FROM audit');
  const result = await atWrite(/^UPDATE assets SET status=/, () => act(actors.hr_manager, { action: 'returnAsset', id }), () => {
    // The later assignment intentionally has the same employee and timestamp,
    // proving that state/employee/timestamp comparison alone is not a version.
    for (const action of ['returnAsset', 'assignAsset']) f.run('INSERT INTO asset_history (id,asset_id,employee_id,action,actor_id,created_at) VALUES (?,?,?,?,?,?)', `competing-${action}`, id, employee.id, action, actors.hr_manager.id, '2026-01-01');
  });
  assert.equal(result.status, 409);
  assert.equal(f.get('SELECT status FROM assets').status, 'assigned');
  assert.equal(f.get('SELECT assigned_to FROM assets').assigned_to, employee.id);
  assert.equal(f.get('SELECT COUNT(*) AS n FROM asset_history').n, 3);
  noAudit();
});
test('concurrent asset assignments have exactly one winner and one movement record', async () => {
  const id = await saved(asset());
  f.run('DELETE FROM audit');
  const results = await Promise.all([employee, other].map(person => act(actors.hr_manager, { action: 'assignAsset', id, employeeId: person.id })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.get('SELECT COUNT(*) AS n FROM asset_history').n, 1);
  assert.equal(f.get('SELECT COUNT(*) AS n FROM audit').n, 1);
  assert.ok([employee.id, other.id].includes(f.get('SELECT assigned_to FROM assets').assigned_to));
});
test('a duplicate tag racing an asset edit returns conflict and preserves original fields', async () => {
  const id = await saved(asset());
  f.run('DELETE FROM audit');
  const result = await atWrite(/^UPDATE assets SET name=/, () => act(actors.hr_manager, asset({ id, tag: 'TAKEN' })), () => f.run('INSERT INTO assets (id,name,category,tag,created_by,updated_at) VALUES (?,?,?,?,?,?)', 'competitor', 'Synthetic asset', 'Laptop', 'TAKEN', actors.hr_manager.id, '2026-01-01'));
  assert.equal(result.status, 409);
  assert.equal(f.get('SELECT tag FROM assets WHERE id=?', id).tag, 'SYNTHETIC-001');
  noAudit();
});
test('template edit racing archival never restores or changes an archived template', async () => {
  const id = await saved(template());
  f.run('DELETE FROM audit');
  const result = await atWrite(/^INSERT INTO workflow_templates/, () => act(actors.hr_manager, template({ id, name: 'Changed' })), () => f.run('UPDATE workflow_templates SET active=0 WHERE id=?', id));
  assert.equal(result.status, 409);
  assert.equal(f.get('SELECT name FROM workflow_templates').name, 'Synthetic checklist');
  assert.equal(f.get('SELECT active FROM workflow_templates').active, 0);
  noAudit();
});
test('workflow task storage failure rolls back the run, all tasks and audit', async () => {
  const templateId = await saved(template({ steps: [{ title: 'First', assignee: 'employee', offset: 0 }, { title: 'Second', assignee: 'hr', offset: 1 }] }));
  f.run('DELETE FROM audit');
  const prepare = f.env.DB.prepare; let writes = 0;
  f.env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (/^INSERT INTO tasks/.test(sql)) { const run = statement.run; statement.run = async () => { if (++writes === 2) throw new Error('Synthetic second-task failure'); return run(); }; }
    return statement;
  };
  try {
    assert.equal((await act(actors.hr_manager, { action: 'applyTemplate', templateId, employeeId: employee.id, startDate: '2026-01-01' })).status, 500);
    assert.equal(f.get('SELECT COUNT(*) AS n FROM workflow_runs').n, 0);
    assert.equal(f.get('SELECT COUNT(*) AS n FROM tasks').n, 0);
    noAudit();
  } finally { f.env.DB.prepare = prepare; }
});
for (const action of ['saveTemplate', 'archiveTemplate', 'applyTemplate', 'saveAsset', 'assignAsset', 'saveAnnouncement', 'saveTime', 'submitTime', 'reviewTime', 'deleteTime', 'acknowledgeDocument']) {
  test(`${action} rolls back its state change if audit persistence fails`, async () => {
    const templateId = await saved(template());
    const assetId = await saved(asset());
    const timeId = await saved(time(), employee);
    if (action === 'reviewTime') await act(employee, { action: 'submitTime', id: timeId });
    f.document('company', actors.admin.id, { visibility: 'company' });
    const operations = {
      saveTemplate: [actors.hr_manager, template({ id: templateId, name: 'Changed' })],
      archiveTemplate: [actors.hr_manager, { action, id: templateId }],
      applyTemplate: [actors.hr_manager, { action, templateId, employeeId: employee.id, startDate: '2026-01-01' }],
      saveAsset: [actors.hr_manager, asset({ id: assetId, name: 'Changed' })],
      assignAsset: [actors.hr_manager, { action, id: assetId, employeeId: employee.id }],
      saveAnnouncement: [actors.hr_manager, notice()],
      saveTime: [employee, time({ id: timeId, minutes: 90 })],
      submitTime: [employee, { action, id: timeId }],
      reviewTime: [actors.manager, { action, id: timeId, status: 'approved' }],
      deleteTime: [employee, { action, id: timeId }],
      acknowledgeDocument: [employee, { action, id: 'company' }],
    };
    const tables = ['workflow_templates', 'workflow_runs', 'tasks', 'assets', 'asset_history', 'announcements', 'time_entries', 'document_acknowledgements'];
    const snapshot = () => JSON.stringify(Object.fromEntries(tables.map(table => [table, f.rows(`SELECT * FROM ${table}`)])));
    const before = snapshot();
    f.run('DELETE FROM audit');
    const [actor, body] = operations[action];
    const result = await atWrite(/^INSERT INTO audit/, () => act(actor, body), () => { throw new Error('Synthetic audit persistence failure'); });
    assert.equal(result.status, 500);
    assert.equal(snapshot(), before);
    noAudit();
  });
}
test('time submission uses the latest eligible manager when reporting line changes in flight', async () => {
  const id = await saved(time(), employee);
  const result = await atWrite(/^UPDATE time_entries SET status='submitted'/, () => act(employee, { action: 'submitTime', id }), () => f.run('UPDATE employees SET manager_id=? WHERE id=?', actors.hr_manager.id, employee.id));
  assert.equal(result.status, 200);
  assert.equal(f.get('SELECT required_manager_id FROM time_entries').required_manager_id, actors.hr_manager.id);
  assert.equal((await act(actors.manager, { action: 'reviewTime', id, status: 'approved' })).status, 403);
  assert.equal((await act(actors.hr_manager, { action: 'reviewTime', id, status: 'approved' })).status, 200);
});
test('two time reviews have exactly one winner without duplicate audit', async () => {
  const id = await saved(time(), employee);
  await act(employee, { action: 'submitTime', id });
  f.run('DELETE FROM audit');
  const results = await Promise.all(['approved', 'rejected'].map(status => act(actors.manager, { action: 'reviewTime', id, status })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 403]);
  assert.equal(f.get('SELECT COUNT(*) AS n FROM audit').n, 1);
});
test('simultaneous document acknowledgement retries keep one receipt and one audit', async () => {
  f.document('company', actors.admin.id, { visibility: 'company' });
  const results = await Promise.all(Array.from({ length: 4 }, () => act(employee, { action: 'acknowledgeDocument', id: 'company' })));
  assert.ok(results.every(r => r.status === 200));
  assert.equal(f.get('SELECT COUNT(*) AS n FROM document_acknowledgements').n, 1);
  assert.equal(f.get('SELECT COUNT(*) AS n FROM audit').n, 1);
});
