// Cloudflare deployment helper (see docs/deploy-cloudflare.md).
//   node scripts/cloudflare.mjs config                       write dist/server/wrangler.deploy.json from cloudflare-deploy.json
//   node scripts/cloudflare.mjs admin-sql --email <e> --name <n> --issuer <convex site url> --subject <convex user id>
//                                                            write the first-administrator SQL to .wrangler/first-admin.sql
// Nothing here talks to Cloudflare; wrangler does that. No secrets are read or written.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [command, ...rest] = process.argv.slice(2);
const fail = (message) => { console.error(`\n✖ ${message}`); process.exit(1); };
const option = (name) => { const at = rest.indexOf(`--${name}`); return at >= 0 ? rest[at + 1] : undefined; };
const sqlText = (value) => `'${String(value).replace(/'/g, "''")}'`;

if (command === "config") {
  const settingsFile = path.join(root, "cloudflare-deploy.json");
  if (!existsSync(settingsFile)) fail("cloudflare-deploy.json is missing. Copy cloudflare-deploy.example.json and fill it in.");
  const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  const built = path.join(root, "dist/server/wrangler.json");
  if (!existsSync(built)) fail("Run `npm run build` first.");
  if (!/^[0-9a-f-]{36}$/i.test(settings.d1?.id ?? "")) fail("cloudflare-deploy.json: d1.id must be the real database id.");
  for (const key of ["UFS_CONVEX_URL", "UFS_CONVEX_SITE_URL"]) {
    if (settings.vars?.UFS_AUTH_PROVIDER === "convex" && !/^https:\/\/[a-z0-9-]+\.convex\.(cloud|site)$/.test(settings.vars[key] ?? "")) fail(`cloudflare-deploy.json: ${key} must be the https Convex address.`);
  }
  const config = JSON.parse(readFileSync(built, "utf8"));
  config.name = settings.workerName;
  config.topLevelName = settings.workerName;
  config.d1_databases = [{
    binding: "DB", database_name: settings.d1.name, database_id: settings.d1.id,
    migrations_dir: path.join(root, "drizzle"),
  }];
  config.r2_buckets = [{ binding: "BUCKET", bucket_name: settings.r2Bucket }];
  // UFS_SELF_HOSTED makes the worker discard forged ChatGPT identity headers.
  config.vars = { ...settings.vars, UFS_SELF_HOSTED: "true" };
  const target = path.join(root, "dist/server/wrangler.deploy.json");
  writeFileSync(target, JSON.stringify(config, null, 2));
  console.log(`Wrote ${path.relative(root, target)}`);
} else if (command === "admin-sql") {
  const email = (option("email") ?? "").trim().toLowerCase();
  const name = (option("name") ?? "").trim();
  const issuer = option("issuer") ?? "";
  const subject = option("subject") ?? "";
  if (!/^[^\s@']+@[^\s@']+\.[^\s@']+$/.test(email)) fail("--email must be a valid address.");
  if (!name || name.length > 100) fail("--name is required.");
  if (!/^https:\/\/[a-z0-9-]+\.convex\.site$/.test(issuer)) fail("--issuer must be the Convex site address (UFS_CONVEX_SITE_URL).");
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(subject)) fail("--subject must be the Convex user id from `invites:whoIs`.");
  const id = randomUUID(), now = new Date().toISOString();
  const sql = [
    "-- First administrator. Run once: npx wrangler d1 execute DB --remote --config dist/server/wrangler.deploy.json --file .wrangler/first-admin.sql",
    `INSERT INTO employees (id,user_id,email,name,title,department,location,employment,hire_date,role,active,annual_allowance,sick_allowance,demo,created_at) SELECT ${sqlText(id)},${sqlText(`admin-${id}`)},${sqlText(email)},${sqlText(name)},'Administrator','Administration & Operations','United States','Full-Time',${sqlText(now.slice(0, 10))},'admin',1,15,5,0,${sqlText(now)} WHERE NOT EXISTS (SELECT 1 FROM employees WHERE role='admin');`,
    `INSERT OR IGNORE INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) SELECT ${sqlText(randomUUID())},${sqlText(issuer)},${sqlText(subject)},e.id,1,${sqlText(now)},'first-administrator-setup' FROM employees e WHERE e.email=${sqlText(email)} AND e.role='admin' AND e.data_scope='live';`,
    "",
  ].join("\n");
  mkdirSync(path.join(root, ".wrangler"), { recursive: true });
  writeFileSync(path.join(root, ".wrangler/first-admin.sql"), sql);
  console.log("Wrote .wrangler/first-admin.sql");
} else {
  fail("Usage: node scripts/cloudflare.mjs config | admin-sql --email --name --issuer --subject");
}
