// Copies every row from the live Cloudflare D1 database into a SQL file for Supabase Postgres.
//   node scripts/migrate-d1-data.mjs [--config dist/server/wrangler.deploy.json] [--out supabase/data.sql]
// Then run the file once in the Supabase SQL editor (after schema.sql, executor.sql and storage.sql). It is safe to run twice
// (rows that already exist are skipped). The file contains real HR data: it is git-ignored, so keep it private and delete it
// after the move. Nothing is deleted from D1.
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

// Tables in an order where every row's references already exist (parents before children).
export function tableOrder() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(path.join(root, "drizzle")).filter((file) => file.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(path.join(root, "drizzle", name), "utf8").split("--> statement-breakpoint")) if (statement.trim()) sqlite.exec(statement);
  }
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  const parents = new Map(tables.map((table) => [table, new Set(sqlite.prepare(`PRAGMA foreign_key_list("${table}")`).all().map((fk) => fk.table).filter((parent) => parent !== table))]));
  const ordered = [];
  while (ordered.length < tables.length) {
    const next = tables.find((table) => !ordered.includes(table) && [...parents.get(table)].every((parent) => ordered.includes(parent)));
    if (!next) throw new Error("Foreign keys form a cycle");
    ordered.push(next);
  }
  return ordered;
}

const literal = (value) => (value === null || value === undefined ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replace(/'/g, "''")}'`);

// rowsByTable: { tableName: [ {column: value, ...}, ... ] }  ->  one INSERT per row, in dependency order.
export function buildInsertSql(rowsByTable) {
  const out = ["-- Data copied from Cloudflare D1. Contains real HR data: keep private and delete after the move.", "begin;"];
  for (const table of tableOrder()) {
    for (const row of rowsByTable[table] || []) {
      const columns = Object.keys(row);
      out.push(`insert into ufs."${table}" (${columns.map((column) => `"${column}"`).join(", ")}) values (${columns.map((column) => literal(row[column])).join(", ")}) on conflict do nothing;`);
    }
  }
  out.push("commit;", "");
  return out.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at >= 0 ? process.argv[at + 1] : fallback; };
  const config = option("config", "dist/server/wrangler.deploy.json");
  const outFile = path.join(root, option("out", "supabase/data.sql"));
  const rowsByTable = {};
  let total = 0;
  // Records that only mean something to the OLD sign-in service or to the old test emails are left behind: sessions, tokens,
  // rate limits, reset cut-offs, the old account bindings and the email queue. The first administrator is bound again in
  // Supabase by scripts/supabase-setup.mjs. Add --include-sign-in-history to copy them anyway.
  const leftBehind = new Set(process.argv.includes("--include-sign-in-history") ? [] : ["auth_sessions", "auth_session_tokens", "auth_rate_limits", "auth_password_resets", "employee_identities", "email_outbox"]);
  for (const table of tableOrder()) {
    if (leftBehind.has(table)) { console.log(`${table}: left behind (old sign-in data)`); continue; }
    // Run wrangler directly with node (no shell), so the SQL text is passed through untouched on Windows too.
    const run = spawnSync(process.execPath, [path.join(root, "node_modules/wrangler/bin/wrangler.js"), "d1", "execute", "DB", "--remote", "--config", config, "--json", "--command", `SELECT * FROM "${table}"`], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    let parsed;
    try { parsed = JSON.parse(run.stdout.slice(run.stdout.indexOf("["))); } catch {
      console.error(`Could not read ${table} from D1.\n${(run.stderr || run.stdout || "").trim().split("\n").slice(-6).join("\n")}\nRun \`node scripts/cloudflare.mjs config\` first and check you are signed in to Cloudflare (npx wrangler whoami).`);
      process.exit(1);
    }
    rowsByTable[table] = parsed[0]?.results ?? [];
    total += rowsByTable[table].length;
    if (rowsByTable[table].length) console.log(`${table}: ${rowsByTable[table].length} rows`);
  }
  writeFileSync(outFile, buildInsertSql(rowsByTable));
  console.log(`\nWrote ${path.relative(root, outFile)} with ${total} rows. It is git-ignored. Run it in the Supabase SQL editor, then delete it.`);
}
