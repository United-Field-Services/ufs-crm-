// The single file people paste into the Supabase SQL editor must be the three parts, in order, and its database part must load cleanly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const file = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('setup-all.sql is the schema, the executor and the bucket, in that order, and is up to date', () => {
  const bundle = file('supabase/setup-all.sql');
  const order = ['1. Tables', '2. Database function', '3. Private file bucket'].map(label => bundle.indexOf(label));
  assert.ok(order.every(position => position >= 0) && order[0] < order[1] && order[1] < order[2]);
  for (const part of ['schema.sql', 'executor.sql', 'storage.sql']) assert.ok(bundle.includes(file(`supabase/${part}`).trimEnd()), `${part} is inside the bundle (run node scripts/make-postgres-schema.mjs)`);
});

test('the tables and function in the bundle load into Postgres and stay locked down', async () => {
  const bundle = file('supabase/setup-all.sql');
  const withoutBucket = bundle.slice(0, bundle.indexOf('-- ===== 3.'));
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(withoutBucket);
  assert.equal((await db.query("select count(*)::int n from information_schema.tables where table_schema = 'ufs'")).rows[0].n, 36);
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from ufs.employees'), /permission denied/i);
});
