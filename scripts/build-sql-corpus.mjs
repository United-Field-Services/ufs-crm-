// Rebuilds tests/fixtures/sql-corpus.json: every distinct SQL statement the app ran during the test suite, with sample values.
//   UFS_CAPTURE_SQL=/tmp/statements.jsonl node --test tests/*.test.mjs
//   node scripts/build-sql-corpus.mjs /tmp/statements.jsonl
// tests/postgres-translation.test.mjs replays these on Postgres so a statement that SQLite accepts but Postgres rejects is caught.
import { readFileSync, writeFileSync } from "node:fs";
const input = process.argv[2];
if (!input) { console.error("Usage: node scripts/build-sql-corpus.mjs <captured.jsonl>"); process.exit(1); }
const seen = new Map();
for (const line of readFileSync(input, "utf8").split("\n")) {
  if (!line) continue;
  const { sql, args } = JSON.parse(line);
  if (/nonexistent_test_table/.test(sql)) continue;
  const entry = seen.get(sql) || { sql, samples: [] };
  if (entry.samples.length < 3) entry.samples.push(args.map((value) => (typeof value === "string" && value.length > 200 ? value.slice(0, 200) : value)));
  seen.set(sql, entry);
}
const corpus = [...seen.values()].sort((a, b) => a.sql.localeCompare(b.sql));
writeFileSync(new URL("../tests/fixtures/sql-corpus.json", import.meta.url), JSON.stringify(corpus));
console.log(`Wrote tests/fixtures/sql-corpus.json with ${corpus.length} statements.`);
