// Moving the data: rows copied from the SQLite (D1) database load into the Postgres schema unchanged, in the right order,
// and loading the same file twice does not duplicate anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { fixture } from './harness.mjs';
import { buildInsertSql, tableOrder } from '../scripts/migrate-d1-data.mjs';

const file = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('every table is copied, parents before children, and a second run changes nothing', async () => {
  const f = fixture();
  const manager = f.employee('manager', { role: 'manager', name: "O'Brien \"Boss\" $1" });
  const worker = f.employee('worker', { manager_id: manager.id });
  f.leave('l1', worker.id, { note: "line one\nline two ; DROP TABLE x; --" });
  f.run("INSERT INTO tasks (id,title,assignee_id,due_date,status,created_by,created_at) VALUES ('t1','Task',?,'2026-11-01','pending',?,'2026-10-01')", worker.id, manager.id);
  f.run("INSERT INTO notifications (id,recipient_id,kind,title,body,link,dedupe_key,created_at) VALUES ('n1',?,'test','Hello','é ü 日本','/x','k','2026-10-01')", worker.id);
  f.run("INSERT INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) VALUES ('i1','https://p.supabase.co/auth/v1','sub-1',?,1,'2026-01-01','admin')", worker.id);
  f.run("INSERT INTO file_chunks (object_key,idx,data) VALUES ('k',0,'QUJD')");
  const rowsByTable = Object.fromEntries(tableOrder().map(table => [table, f.rows(`SELECT * FROM "${table}"`)]));
  const total = Object.values(rowsByTable).reduce((sum, rows) => sum + rows.length, 0);
  assert.ok(total >= 7);

  const pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role;');
  await pg.exec(file('supabase/schema.sql'));
  const sql = buildInsertSql(rowsByTable);
  await pg.exec(sql);
  await pg.exec(sql); // again: nothing is duplicated and nothing fails
  for (const [table, rows] of Object.entries(rowsByTable)) {
    assert.equal((await pg.query(`select count(*)::int n from ufs."${table}"`)).rows[0].n, rows.length, table);
  }
  const copied = (await pg.query("select name from ufs.employees where id = 'manager'")).rows[0].name;
  assert.equal(copied, "O'Brien \"Boss\" $1");
  assert.equal((await pg.query("select note from ufs.leave_requests where id = 'l1'")).rows[0].note, "line one\nline two ; DROP TABLE x; --");
  assert.equal((await pg.query("select body from ufs.notifications where id = 'n1'")).rows[0].body, 'é ü 日本');
  assert.equal(tableOrder().indexOf('employees') < tableOrder().indexOf('leave_requests'), true);
  f.close();
});
