// One-command local setup: npm run setup
//   npm run setup                 install dependencies, create .env, create the local database
//   npm run setup -- --reset      also wipe local data (.wrangler/state) first
//   npm run setup -- --skip-install
// Everything it creates is local and ignored by git. It never contacts Supabase or sends email.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = new Set(process.argv.slice(2));
const known = new Set(["--reset", "--skip-install", "--help"]);
const unknown = [...args].filter((arg) => !known.has(arg));
if (args.has("--help") || unknown.length) {
  console.log("Usage: npm run setup -- [--reset] [--skip-install]");
  process.exit(unknown.length ? 1 : 0);
}

const step = (message) => console.log(`\n▸ ${message}`);
const fail = (message) => { console.error(`\n✖ ${message}`); process.exit(1); };
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", ...options });
  if (result.error) fail(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${commandArgs.join(" ")} exited with code ${result.status}.`);
}

// 1. Node version (package.json "engines").
const required = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).engines?.node ?? ">=22.13.0";
const [major, minor] = process.versions.node.split(".").map(Number);
const [needMajor, needMinor] = required.replace(/[^\d.]/g, "").split(".").map(Number);
if (major < needMajor || (major === needMajor && minor < needMinor)) {
  fail(`Node ${required} is required; this is ${process.versions.node}. Install a newer Node (https://nodejs.org) and run again.`);
}
console.log(`Node ${process.versions.node} OK`);

// 2. Dependencies.
if (args.has("--skip-install") || existsSync(path.join(root, "node_modules", ".bin"))) {
  step("Dependencies already installed (use a fresh checkout or delete node_modules to reinstall)");
} else {
  step("Installing dependencies (a few minutes the first time)");
  // npm_execpath is set when this runs through `npm run`; it avoids Windows .cmd shims.
  if (process.env.npm_execpath) run(process.execPath, [process.env.npm_execpath, "install"]);
  else run(process.platform === "win32" ? "npm.cmd" : "npm", ["install"], { shell: process.platform === "win32" });
}

// 3. Local settings. .env is ignored by git; the owner email is the dev server's fake sign-in.
step("Local settings");
const envFile = path.join(root, ".env");
if (existsSync(envFile)) console.log(".env already exists; left unchanged.");
else {
  const example = path.join(root, ".env.example");
  if (!existsSync(example)) fail(".env.example is missing from the project.");
  writeFileSync(envFile, readFileSync(example));
  console.log("Created .env from .env.example.");
}

// 4. Local database. The dev server keeps D1 in .wrangler/state; migrations are applied
// with a throwaway wrangler config that points at drizzle/ and the same placeholder
// database id that vite.config.ts uses for local development.
step("Local database");
const state = path.join(root, ".wrangler", "state");
if (args.has("--reset")) { rmSync(state, { recursive: true, force: true }); console.log("Removed existing local data."); }
const hosting = JSON.parse(readFileSync(path.join(root, ".openai", "hosting.json"), "utf8"));
const binding = hosting.d1;
if (!binding) fail(".openai/hosting.json has no d1 binding.");
const configDir = path.join(root, ".wrangler", "setup");
mkdirSync(configDir, { recursive: true });
const configPath = path.join(configDir, "wrangler.toml");
const migrations = path.join(root, "drizzle").replaceAll("\\", "/");
writeFileSync(configPath, [
  'name = "ufs-people-local"',
  'compatibility_date = "2026-05-01"',
  "[[d1_databases]]",
  `binding = "${binding}"`,
  'database_name = "site-creator-d1"',
  'database_id = "00000000-0000-4000-8000-000000000000"',
  `migrations_dir = "${migrations}"`,
  "",
].join("\n"));
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
if (!existsSync(wrangler)) fail("wrangler is not installed. Run again without --skip-install.");
run(process.execPath, [
  "--import", "./scripts/sites-env.mjs", wrangler,
  "d1", "migrations", "apply", binding, "--local", "--config", configPath, "--persist-to", state,
], { env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });

console.log(`
✔ Local setup finished.

  Start the app:   npm run dev      (then open http://localhost:5173)
  Run the tests:   node --test tests/*.test.mjs
  Start over:      npm run setup -- --reset

The dev server signs you in as the owner (seedy@sites.test) with fictional demo data.
Real sign-in, password reset email and file storage need hosted services and are not part of local setup.`);
