// The app's SQL is written for SQLite. These tests prove it also runs on Postgres (Supabase) through the translation in
// lib/pg-dialect.ts and the executor function in supabase/executor.sql, using an in-process Postgres (no network).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { toPostgres } from '../lib/pg-dialect.ts';

const file = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
let db;
before(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(file('supabase/schema.sql'));
  await db.exec(file('supabase/executor.sql'));
});
const batch = async statements => (await db.query('select public.ufs_batch($1::jsonb) r', [JSON.stringify(statements)])).rows[0].r;
const run = (sql, ...params) => batch([{ sql: toPostgres(sql), params }]).then(result => result[0]);
const DATA_ERRORS = new Set(['23505', '23503', '23502', 'P0001', '23514']);

test('every statement the app runs is valid Postgres', async () => {
  const corpus = JSON.parse(file('tests/fixtures/sql-corpus.json'));
  assert.ok(corpus.length > 300, 'the statement list is present');
  const problems = [];
  for (const { sql, samples } of corpus) {
    for (const args of samples) {
      try { await batch([{ sql: toPostgres(sql), params: args.map(value => (typeof value === 'boolean' ? Number(value) : value ?? null)) }]); }
      catch (error) { if (!DATA_ERRORS.has(error.code)) problems.push(`[${error.code}] ${error.message}\n  ${toPostgres(sql).replace(/\s+/g, ' ').slice(0, 220)}`); }
    }
  }
  assert.deepEqual(problems, []);
});

test('the translation rewrites SQLite-only syntax and leaves quoted text alone', () => {
  assert.equal(toPostgres('SELECT * FROM t WHERE a = ? AND b IS ? AND c IS NOT ?'), 'SELECT * FROM t WHERE a = $1 AND b IS NOT DISTINCT FROM $2 AND c IS DISTINCT FROM $3');
  assert.equal(toPostgres("INSERT OR IGNORE INTO t (a) VALUES (?)"), 'INSERT INTO t (a) VALUES ($1) ON CONFLICT DO NOTHING');
  assert.equal(toPostgres('INSERT INTO a SELECT ? WHERE changes()>0'), 'INSERT INTO a SELECT $1 WHERE ufs.changes()>0');
  assert.equal(toPostgres("SELECT '? IS ? changes()' AS text, x LIKE ? FROM t"), "SELECT '? IS ? changes()' AS text, x ILIKE $1 FROM t");
  assert.equal(toPostgres('UPDATE t SET n=MAX(t.n,excluded.n)'), 'UPDATE t SET n=GREATEST(t.n,excluded.n)');
  assert.match(toPostgres('INSERT OR IGNORE INTO a (x) SELECT ? FROM b'), /WHERE true ON CONFLICT DO NOTHING$/);
});

test('a batch is all-or-nothing and changes() sees the previous statement', async () => {
  await run("INSERT INTO employees (id,email,name,title,department,location,employment,hire_date,created_at) VALUES (?,?,?,?,?,?,?,?,?)", 'pg1', 'pg1@example.test', 'Pg One', 't', 'd', 'l', 'Full-Time', '2026-01-01', '2026-01-01');
  await assert.rejects(batch([
    { sql: toPostgres('INSERT INTO audit (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)'), params: ['pa1', 'pg1', 'x', 'pg1', '2026-01-01'] },
    { sql: toPostgres("INSERT INTO employees (id,email,name,title,department,location,employment,hire_date,created_at) VALUES ('pg2','pg1@example.test','dup','t','d','l','f','2026','2026')"), params: [] },
  ]), /UNIQUE constraint failed: employees\.data_scope, employees\.email/);
  assert.equal((await db.query("select count(*)::int n from ufs.audit where id = 'pa1'")).rows[0].n, 0, 'nothing from the failed batch was kept');
  const results = await batch([
    { sql: toPostgres('UPDATE employees SET title = ? WHERE id = ?'), params: ['New title', 'pg1'] },
    { sql: toPostgres('INSERT INTO audit (id,actor_id,action,target_id,created_at) SELECT ?,?,?,?,? WHERE changes() > 0'), params: ['pa2', 'pg1', 'edited', 'pg1', '2026-01-01'] },
    { sql: toPostgres('UPDATE employees SET title = ? WHERE id = ?'), params: ['Nothing', 'no-such-person'] },
    { sql: toPostgres('INSERT INTO audit (id,actor_id,action,target_id,created_at) SELECT ?,?,?,?,? WHERE changes() > 0'), params: ['pa3', 'pg1', 'missed', 'pg1', '2026-01-01'] },
  ]);
  assert.deepEqual(results.map(result => result.changes), [1, 1, 0, 0]);
  assert.equal((await db.query("select count(*)::int n from ufs.audit where id in ('pa2','pa3')")).rows[0].n, 1, 'an audit row is written only when the change happened');
});

test('values are placed safely: quotes, dollar signs and injection attempts stay plain text', async () => {
  const nasty = "x'); DROP TABLE employees; -- $1 \\ $2";
  await run('INSERT INTO announcements (id,title,body,created_by,created_at) VALUES (?,?,?,?,?)', 'an1', nasty, '$1 and $2', 'pg1', '2026-01-01');
  const [answer] = await batch([{ sql: toPostgres('SELECT title,body FROM announcements WHERE id = ?'), params: ['an1'] }]);
  assert.deepEqual(answer.rows[0], { title: nasty, body: '$1 and $2' });
  assert.equal((await db.query("select count(*)::int n from ufs.employees")).rows[0].n >= 1, true);
});

test('null-safe comparison, booleans and missing values behave like SQLite', async () => {
  const [answer] = await batch([{ sql: toPostgres('SELECT id FROM employees WHERE user_id IS ? AND id = ?'), params: [null, 'pg1'] }]);
  assert.equal(answer.rows.length, 1);
  const [flag] = await batch([{ sql: toPostgres('SELECT COUNT(*) n FROM employees WHERE active = ?'), params: [true] }]);
  assert.ok(Number(flag.rows[0].n) >= 1, 'true is sent as 1');
  await assert.rejects(batch([{ sql: 'SELECT $2', params: ['only one'] }]), /Missing value/);
});

test('the data-scope rules still stop a cross-scope reference', async () => {
  await assert.rejects(run("INSERT INTO leave_requests (id,employee_id,type,start_date,end_date,days,year,created_at,data_scope) VALUES (?,?,?,?,?,?,?,?,?)", 'lr1', 'pg1', 'Vacation', '2026-11-02', '2026-11-02', 1, 2026, '2026-01-01', 'qa-bots-v1'), /Data scope boundary/);
});

test('the public roles can neither read the data nor call the executor (the publishable key alone gets nothing)', async () => {
  await db.exec("insert into ufs.employees (id,email,name,title,department,location,employment,hire_date,created_at) values ('sec1','sec1@example.test','Sec','t','d','l','Full-Time','2026-01-01','2026-01-01')");
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query('select * from ufs.employees'), /permission denied/i, `${role} cannot read tables`);
      await assert.rejects(db.query('select * from ufs.compensation_records'), /permission denied/i);
      await assert.rejects(db.query("insert into ufs.employees (id,email,name,title,department,location,employment,hire_date,created_at) values ('x','x@x','x','x','x','x','x','x','x')"), /permission denied/i);
      await assert.rejects(db.query("select public.ufs_batch('[]'::jsonb)"), /permission denied/i, `${role} cannot call the executor`);
    } finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try { assert.equal((await db.query("select jsonb_array_length(public.ufs_batch('[]'::jsonb)) n")).rows[0].n, 0); } finally { await db.exec('reset role'); }
});

test('every table has row-level security switched on and no policy', async () => {
  const tables = (await db.query("select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'ufs' and c.relkind = 'r'")).rows;
  assert.ok(tables.length >= 36);
  assert.deepEqual(tables.filter(table => !table.relrowsecurity).map(table => table.relname), []);
  assert.equal((await db.query("select count(*)::int n from pg_policies where schemaname = 'ufs'")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from information_schema.tables where table_schema = 'public'")).rows[0].n, 0, 'no data tables in the exposed schema');
});

test('negative and large numbers cannot merge with the text before them or change the statement', async () => {
  const [answer] = await batch([{ sql: 'SELECT 5-$1 AS a, 5- $2 AS b, $3 AS c', params: [-3, -2.5, 12345678901234] }]);
  assert.deepEqual(answer.rows[0], { a: 8, b: 7.5, c: 12345678901234 });
  const [second] = await batch([{ sql: 'SELECT $1 AS first -- comment, $2 AS second', params: [-1, -2] }]);
  assert.deepEqual(second.rows[0], { first: -1 });
});
