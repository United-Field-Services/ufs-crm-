// Checks and first-time setup for the Supabase project. Run it on your own computer; the service key is read from the
// environment and never printed, saved or sent anywhere except to your own Supabase project.
//
//   PowerShell:  $env:UFS_SUPABASE_SERVICE_KEY = Read-Host "Service key"      (type it at the prompt; it is not stored)
//   Then:        node scripts/supabase-setup.mjs check
//                node scripts/supabase-setup.mjs first-admin --email you@company.com
//
// check        confirms the database function, the private file bucket and Supabase Auth work, and that the public
//              (publishable) key can read NOTHING.
// first-admin  creates the first administrator's sign-in in Supabase Auth (no password) and binds it to the existing
//              administrator profile in the database. They then choose a password with "Forgot your password?".
import { toPostgres } from "../lib/pg-dialect.ts";

const url = process.env.UFS_SUPABASE_URL || "https://ycswaipyuonxwyalkits.supabase.co";
const serviceKey = process.env.UFS_SUPABASE_SERVICE_KEY;
const publishableKey = process.env.UFS_SUPABASE_PUBLISHABLE_KEY;
const [command, ...rest] = process.argv.slice(2);
const option = (name) => { const at = rest.indexOf(`--${name}`); return at >= 0 ? rest[at + 1] : undefined; };
const fail = (message) => { console.error(`\n✖ ${message}`); process.exit(1); };
const pass = (message) => console.log(`✔ ${message}`);
const expect = (condition, good, bad) => { if (condition) pass(good); else fail(bad); };
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && !(process.env.UFS_SETUP_TEST === "1" && /^http:\/\/127\.0\.0\.1:\d+$/.test(url))) fail("UFS_SUPABASE_URL must look like https://<project>.supabase.co");
if (!serviceKey) fail("Set UFS_SUPABASE_SERVICE_KEY in this terminal first (see the top of this file). Never paste it into a chat.");

const headers = { "Content-Type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
async function sql(statements) {
  const response = await fetch(`${url}/rest/v1/rpc/ufs_batch`, { method: "POST", headers, body: JSON.stringify({ statements: statements.map((statement) => ({ sql: toPostgres(statement.sql), params: statement.params })) }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
  return body;
}

if (command === "check") {
  try {
    const [counts] = await sql([{ sql: "SELECT (SELECT COUNT(*) FROM employees) AS employees, (SELECT COUNT(*) FROM notifications) AS notifications", params: [] }]);
    pass(`database function works (${counts.rows[0].employees} employees, ${counts.rows[0].notifications} notifications)`);
  } catch (error) { fail(`database: ${error.message}. Run supabase/schema.sql and supabase/executor.sql in the SQL editor first.`); }

  const bucket = await fetch(`${url}/storage/v1/bucket/ufs-files`, { headers });
  if (bucket.ok) { const info = await bucket.json(); expect(info.public === false, "file bucket 'ufs-files' exists and is private", "the file bucket is PUBLIC: run supabase/storage.sql"); }
  else fail("file bucket 'ufs-files' is missing: run supabase/storage.sql");

  const users = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1`, { headers });
  expect(users.ok, "Supabase Auth admin access works", `Supabase Auth admin access failed (HTTP ${users.status}). Check the service key.`);

  const relay = await fetch(`${url}/functions/v1/send-mail`, { method: "POST", headers, body: "{}" });
  if (relay.status === 400) pass("email function 'send-mail' is deployed");
  else if (relay.status === 404) console.log("• email function 'send-mail' is not deployed yet (optional until you want emails)");
  else console.log(`• email function answered HTTP ${relay.status}`);

  // The public key must get nothing: not the data, not the executor.
  const anonKey = publishableKey || serviceKey;
  if (!publishableKey) console.log("• skipped the public-key test: set UFS_SUPABASE_PUBLISHABLE_KEY to run it");
  else {
    const read = await fetch(`${url}/rest/v1/employees?select=*`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } });
    const call = await fetch(`${url}/rest/v1/rpc/ufs_batch`, { method: "POST", headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${anonKey}` }, body: JSON.stringify({ statements: [] }) });
    const readBody = await read.text();
    expect(read.status >= 400 && !/"id"/.test(readBody), "the public key cannot read employee data", "The PUBLIC key can read employee data! Do not go live until this is fixed.");
    expect(call.status >= 400, "the public key cannot call the database function", "The PUBLIC key can call the database function! Do not go live.");
  }
} else if (command === "first-admin") {
  const email = (option("email") || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Add --email you@company.com");
  const profile = (await sql([{ sql: "SELECT id FROM employees WHERE lower(email) = ? AND role = 'admin' AND data_scope = 'live' LIMIT 1", params: [email] }]))[0].rows[0];
  if (!profile) fail(`No administrator profile with ${email} in the database. Load supabase/data.sql first.`);
  let userId;
  const created = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers, body: JSON.stringify({ email, email_confirm: true }) });
  if (created.ok) userId = (await created.json()).id;
  else {
    const listed = await (await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1000`, { headers })).json();
    userId = listed.users?.find((user) => user.email?.toLowerCase() === email)?.id;
    if (!userId) fail(`Supabase Auth refused to create ${email} (HTTP ${created.status}).`);
    console.log("• this address already had a Supabase account; linking to it");
  }
  await sql([{
    sql: "INSERT OR IGNORE INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) VALUES (?,?,?,?,1,?,?)",
    params: [crypto.randomUUID(), `${url}/auth/v1`, userId, profile.id, new Date().toISOString(), "first-administrator-setup"],
  }]);
  pass(`${email} is the first administrator. Open the site, choose "Forgot your password?" and set a password.`);
} else fail("Usage: node scripts/supabase-setup.mjs check | first-admin --email <address>");
