// Test accounts and sample data for hands-on testing (see docs/test-data.md).
//   node scripts/seed-test-data.mjs accounts     create the six test sign-ins in Convex (invite + password, no email), write test-accounts.local.json
//   node scripts/seed-test-data.mjs sql          write .wrangler/test-data.sql (people, leave, tasks, events, ...) from that file
//   node scripts/seed-test-data.mjs cleanup      write .wrangler/test-data-cleanup.sql (removes everything the seed added)
// Every row is tagged: ids start with "test-" and emails end with @ufs-test.example. Nothing here contacts Cloudflare.
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const DOMAIN = "ufs-test.example";
const ACCOUNTS_FILE = path.join(root, "test-accounts.local.json");
const ADMIN_EMAIL = "venakat@unitedffs.com";
const TODAY = "2026-10-21";
const fail = (message) => { console.error(`\n✖ ${message}`); process.exit(1); };
const q = (value) => (value === null || value === undefined ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replace(/'/g, "''")}'`);
const insert = (table, row) => `INSERT OR IGNORE INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.values(row).map(q).join(",")});`;

// Six sign-ins, one per kind of user (the real administrator is separate).
const LOGINS = [
  { key: "admin", name: "Avery Admin", role: "admin", title: "Operations Director", department: "Administration & Operations", managerKey: "REAL_ADMIN" },
  { key: "hr", name: "Harper Quinn", role: "hr_manager", title: "HR Manager", department: "Human Resources", managerKey: "admin" },
  { key: "manager", name: "Morgan Blake", role: "manager", title: "Operations Manager", department: "Administration & Operations", managerKey: "admin" },
  { key: "hiring", name: "Hunter Reyes", role: "hiring_manager", title: "Hiring Manager", department: "Human Resources", managerKey: "hr" },
  { key: "employee", name: "Evan Carter", role: "employee", title: "Operations Coordinator", department: "Administration & Operations", managerKey: "manager" },
  { key: "employee2", name: "Eliza Nguyen", role: "employee", title: "Accounts Coordinator", department: "Accounting & Finance", managerKey: "fin" },
];
const loginEmail = (key) => `test.${key}@${DOMAIN}`;

// People without a sign-in. Four team leads (role manager) plus staff spread over the teams.
const LEADS = [
  { key: "fin", name: "Fiona Marsh", title: "Finance Manager", department: "Accounting & Finance", location: "United States" },
  { key: "sales", name: "Sanjay Rao", title: "Sales Manager", department: "Marketing & Sales", location: "Asia" },
  { key: "vendor", name: "Valeria Costa", title: "Vendor Manager", department: "Vendor Management", location: "Europe" },
  { key: "orders", name: "Omar Haddad", title: "Order Processing Lead", department: "Order processing", location: "Asia" },
];
const STAFF = [
  ["Aiden Brooks", "fin", "Accountant"], ["Bianca Lopez", "fin", "Payroll Specialist"], ["Caleb Ward", "fin", "Accounts Payable Clerk"], ["Dana Kim", "fin", "Financial Analyst"],
  ["Elias Novak", "sales", "Account Manager"], ["Freya Olsen", "sales", "Marketing Specialist"], ["Gabriel Silva", "sales", "Sales Representative"], ["Hana Sato", "sales", "Sales Representative"],
  ["Isaac Moreau", "vendor", "Field Coordinator"], ["Jade Turner", "vendor", "Vendor Onboarding Specialist"], ["Kofi Mensah", "vendor", "Field Coordinator"], ["Lena Fischer", "vendor", "Compliance Analyst"],
  ["Mateo Ruiz", "orders", "Order Specialist"], ["Nia Patel", "orders", "Order Specialist"], ["Oscar Lindqvist", "orders", "Dispatcher"], ["Priya Shah", "orders", "Order Specialist"],
  ["Quinn Murphy", "manager", "Operations Coordinator"], ["Rosa Delgado", "manager", "Logistics Planner"], ["Sam Okafor", "manager", "Operations Analyst"], ["Tara Jensen", "manager", "Facilities Coordinator"],
  ["Uma Reddy", "hr", "HR Specialist"], ["Victor Hale", "hr", "Recruiter"], ["Wendy Zhao", "hr", "Benefits Administrator"], ["Xavier Boyd", "hr", "HR Coordinator"],
  ["Yara Haddad", "admin", "Executive Assistant"], ["Zane Cooper", "admin", "Office Administrator"],
];
const EMPLOYMENT = ["Full-Time", "Full-Time", "Full-Time", "Part-Time", "Contractor", "Full-Time", "Intern", "Full-Time"];

let seed = 20261021;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const pick = (list) => list[Math.floor(rand() * list.length)];
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isWeekday = (date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
const nextWeekday = (date) => { let d = date; while (!isWeekday(d)) d = addDays(d, 1); return d; };
const weekdaysBetween = (from, to) => { let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) if (isWeekday(d)) n++; return n; };
const slug = (name) => name.toLowerCase().replace(/[^a-z]+/g, ".");

// Windows runs these through cmd.exe, which needs the JSON wrapped in double quotes.
const arg = (value) => `"${JSON.stringify(value).replace(/"/g, '\\"')}"`;
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim().slice(0, 300)}`);
  return result.stdout;
}

async function accounts() {
  const convexDir = process.env.CONVEX_DIR || path.join(root, "auth-convex"); // a folder where `npx convex` is logged in and configured
  const envFile = path.join(root, "cloudflare-deploy.json");
  if (!existsSync(envFile)) fail("cloudflare-deploy.json is missing.");
  const { vars } = JSON.parse(readFileSync(envFile, "utf8"));
  const site = vars.UFS_CONVEX_SITE_URL;
  const existing = existsSync(ACCOUNTS_FILE) ? JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8")) : {};
  const result = {};
  for (const login of LOGINS) {
    const email = loginEmail(login.key);
    if (existing[login.key]) { result[login.key] = existing[login.key]; console.log(`kept ${email}`); continue; }
    const password = `Test-${randomBytes(9).toString("base64url")}-${randomBytes(3).toString("hex")}`;
    run("npx", ["convex", "run", "invites:addWithPassword", arg({ email, password })], convexDir);
    const who = run("npx", ["convex", "run", "invites:whoIs", arg({ email })], convexDir);
    const subject = JSON.parse(who).userId;
    result[login.key] = { email, password, role: login.role, name: login.name, subject, issuer: site };
    console.log(`created ${email} (${login.role})`);
  }
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(result, null, 2));
  console.log(`\nWrote ${path.basename(ACCOUNTS_FILE)} (git-ignored). Passwords are only in that file.`);
}

function sql() {
  if (!existsSync(ACCOUNTS_FILE)) fail("Run `node scripts/seed-test-data.mjs accounts` first.");
  const accountsByKey = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
  const stamp = `${TODAY}T09:00:00.000Z`;
  const realAdmin = `(SELECT id FROM employees WHERE email=${q(ADMIN_EMAIL)} AND role='admin' LIMIT 1)`;
  const out = ["-- Test data. Safe to run twice (INSERT OR IGNORE). Remove with: node scripts/seed-test-data.mjs cleanup"];
  const people = []; // { id, key, name, role, managerKey, department, ... }
  const idOf = (key) => `test-${key}`;

  for (const login of LOGINS) people.push({ ...login, id: idOf(login.key), email: loginEmail(login.key), location: "United States", userId: `test-user-${login.key}`, login: true });
  for (const lead of LEADS) people.push({ ...lead, id: idOf(lead.key), role: "manager", email: `${slug(lead.name)}@${DOMAIN}`, managerKey: "admin" });
  STAFF.forEach(([name, teamKey, title], index) => {
    const team = people.find((p) => p.key === teamKey);
    people.push({ key: `staff${index + 1}`, id: `test-staff-${index + 1}`, name, title, role: "employee", department: team.department, location: pick(["United States", "Asia", "Europe"]), email: `${slug(name)}@${DOMAIN}`, managerKey: teamKey });
  });

  people.forEach((p, index) => {
    const hire = addDays("2021-01-04", Math.floor(rand() * 1700));
    p.hire = hire;
    out.push(insert("employees", {
      id: p.id, user_id: p.userId ?? null, email: p.email, name: p.name, title: p.title, department: p.department, location: p.location,
      employment: p.login ? "Full-Time" : pick(EMPLOYMENT), hire_date: hire, role: p.role, active: 1, annual_allowance: 15, sick_allowance: 5, wfh_allowance: 30,
      bereavement_allowance: 3, demo: 0, created_at: stamp, manager_id: null, data_scope: "live",
    }));
    const [first, ...rest] = p.name.split(" ");
    out.push(insert("employee_profiles", {
      employee_id: p.id, legal_first_name: first, legal_last_name: rest.join(" "), preferred_name: first, employee_number: `T-${String(1001 + index)}`,
      legal_entity: "United Field Services (test)", division: p.department, timezone: p.location === "Asia" ? "Asia/Kolkata" : p.location === "Europe" ? "Europe/Berlin" : "America/Los_Angeles",
      work_arrangement: pick(["On-site", "Hybrid", "Remote"]), hours_per_day: 8, employment_status: "Active", bio: `Sample profile for ${p.name} (test data).`,
      city: p.location === "Asia" ? "Hyderabad" : p.location === "Europe" ? "Berlin" : "Los Angeles", country: p.location === "Asia" ? "India" : p.location === "Europe" ? "Germany" : "United States",
      updated_at: stamp, data_scope: "live",
    }));
  });
  // Managers are set after every row exists.
  for (const p of people) {
    const manager = p.managerKey === "REAL_ADMIN" ? realAdmin : q(idOf(p.managerKey));
    out.push(`UPDATE employees SET manager_id=${manager} WHERE id=${q(p.id)} AND manager_id IS NULL;`);
  }
  // Sign-in bindings for the six test logins.
  for (const login of LOGINS) {
    const account = accountsByKey[login.key];
    if (!account) fail(`No account for ${login.key} in test-accounts.local.json.`);
    out.push(insert("employee_identities", { id: `test-identity-${login.key}`, issuer: account.issuer, subject: account.subject, employee_id: idOf(login.key), enabled: 1, created_at: stamp, approved_by: "test-data-seed" }));
  }

  // Leave: sequential, non-overlapping ranges per person, kept inside each yearly allowance.
  const budget = { Vacation: 15, "Sick Leave": 5, WFH: 30, Bereavement: 3 };
  let leaveCount = 0;
  for (const p of people.filter((x) => x.key !== "admin")) {
    const left = { ...budget };
    let cursor = nextWeekday(addDays("2026-03-02", Math.floor(rand() * 30)));
    // The first requests are in the past; the last one or two are upcoming so approvals have something to act on.
    const count = 3 + Math.floor(rand() * 2);
    for (let i = 0; i < count; i++) {
      const type = pick(["Vacation", "Vacation", "Sick Leave", "WFH", "WFH", "Bereavement"]);
      const length = type === "Bereavement" ? 1 + Math.floor(rand() * 2) : type === "Sick Leave" ? 1 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 4);
      const upcoming = i >= count - 2;
      if (upcoming) cursor = addDays(TODAY, 4 + Math.floor(rand() * 20) + (i === count - 1 ? 18 : 0));
      const start = nextWeekday(addDays(cursor, upcoming ? 0 : 3 + Math.floor(rand() * 18)));
      let end = start; while (weekdaysBetween(start, end) < length) end = addDays(end, 1);
      const days = weekdaysBetween(start, end);
      cursor = addDays(end, 1);
      if (days > left[type] || start > "2026-12-18") continue;
      left[type] -= days;
      const past = end < TODAY;
      const status = past ? (rand() < 0.85 ? "approved" : "rejected") : rand() < 0.6 ? "pending" : "approved";
      const manager = p.managerKey === "REAL_ADMIN" ? realAdmin : q(idOf(p.managerKey));
      const decided = status !== "pending";
      leaveCount++;
      out.push(`INSERT OR IGNORE INTO leave_requests (id,employee_id,type,start_date,end_date,days,year,note,status,created_at,reviewed_at,reviewer_id,review_note,required_manager_id,data_scope) VALUES (${q(`test-leave-${leaveCount}`)},${q(p.id)},${q(type)},${q(start)},${q(end)},${days},2026,${q(type === "Sick Leave" ? "Feeling unwell." : type === "Bereavement" ? "Family matter." : type === "WFH" ? "Working from home." : "Planned time off.")},${q(status)},${q(`${addDays(start, -10)}T10:00:00.000Z`)},${decided ? q(`${addDays(start, -5)}T10:00:00.000Z`) : "NULL"},${decided ? manager : "NULL"},${q(status === "rejected" ? "Team coverage needed." : "")},${manager},'live');`);
    }
  }

  // Tasks.
  const taskTitles = ["Collect signed handbook acknowledgement", "Schedule quarterly 1:1s", "Review open leave requests", "Update emergency contact list", "Order laptops for new starters", "Prepare Q4 headcount report", "Confirm holiday calendar", "Finish safety training", "Reconcile expense reports", "Update vendor insurance certificates", "Plan team offsite", "Audit shared drive access", "Send onboarding welcome pack", "Review probation period dates", "Archive closed vendor files"];
  taskTitles.forEach((title, i) => {
    const assignee = people[Math.floor(rand() * people.length)];
    out.push(insert("tasks", { id: `test-task-${i + 1}`, title, assignee_id: assignee.id, due_date: addDays(TODAY, -5 + i * 3), status: i % 4 === 0 ? "completed" : "pending", created_by: idOf("hr"), created_at: stamp, demo: 0, description: "Sample task (test data).", data_scope: "live" }));
  });

  // Events and announcements.
  [["Monthly all-hands", "2026-10-30", "Company event"], ["Safety workshop", "2026-11-05", "Company event"], ["Thanksgiving", "2026-11-26", "Holiday"], ["Q4 planning day", "2026-12-02", "Company event"], ["Holiday party", "2026-12-17", "Company event"], ["Christmas Day", "2026-12-25", "Holiday"], ["New Year's Day", "2027-01-01", "Holiday"], ["Benefits enrollment closes", "2026-11-15", "Company event"]].forEach(([title, date, kind], i) => {
    out.push(insert("events", { id: `test-event-${i + 1}`, title, date, kind, location: "All locations", created_by: idOf("hr"), demo: 0, data_scope: "live" }));
  });
  [["Welcome to the UFS People test site", "This is sample data for testing. Nothing here is real.", "Company news", 1], ["Open enrollment reminder", "Benefits enrollment closes on November 15 (sample).", "HR", 0], ["Office closed for Thanksgiving", "The office is closed on November 26 (sample).", "Company news", 0], ["New starters this month", "Please welcome our newest team members (sample).", "People", 0]].forEach(([title, body, category, pinned], i) => {
    out.push(insert("announcements", { id: `test-announcement-${i + 1}`, title, body, category, status: "published", pinned, created_by: idOf("hr"), created_at: stamp, published_at: stamp, data_scope: "live" }));
  });
  out.push(insert("announcements", { id: "test-announcement-5", title: "Draft: year-end schedule", body: "Draft for review (sample).", category: "HR", status: "draft", pinned: 0, created_by: idOf("hr"), created_at: stamp, published_at: null, data_scope: "live" }));

  // Equipment.
  ["Laptop", "Laptop", "Laptop", "Phone", "Phone", "Monitor", "Monitor", "Headset", "Laptop", "Phone", "Dock", "Laptop"].forEach((category, i) => {
    const holder = i % 3 === 2 ? null : people[4 + i].id;
    out.push(insert("assets", { id: `test-asset-${i + 1}`, name: `${category} ${i + 1}`, category, tag: `TST-${String(100 + i)}`, serial: `SN${String(7000 + i)}`, status: holder ? "assigned" : "available", assigned_to: holder, assigned_at: holder ? "2026-06-01" : null, return_due: null, notes: "Sample equipment (test data).", created_by: idOf("admin"), updated_at: stamp, data_scope: "live" }));
  });

  // Timesheets: the last ten weekdays for the sign-in accounts and a few others.
  let entry = 0;
  for (const p of people.filter((x) => x.login || x.key.startsWith("staff")).slice(0, 14)) {
    const manager = p.managerKey === "REAL_ADMIN" ? realAdmin : q(idOf(p.managerKey));
    let day = TODAY, written = 0;
    while (written < 10) {
      day = addDays(day, -1);
      if (!isWeekday(day)) continue;
      written++; entry++;
      const status = written > 5 ? "approved" : written > 2 ? "submitted" : "draft";
      out.push(`INSERT OR IGNORE INTO time_entries (id,employee_id,date,minutes,project,notes,status,required_manager_id,review_note,reviewed_by,created_at,updated_at,data_scope) VALUES (${q(`test-time-${entry}`)},${q(p.id)},${q(day)},${pick([420, 450, 480, 480, 510])},${q(pick(["Operations", "Vendor onboarding", "Order backlog", "Month-end close", "Recruiting"]))},'Sample entry.',${q(status)},${manager},'',${status === "approved" ? manager : "NULL"},${q(stamp)},${q(stamp)},'live');`);
    }
  }

  mkdirSync(path.join(root, ".wrangler"), { recursive: true });
  writeFileSync(path.join(root, ".wrangler/test-data.sql"), out.join("\n") + "\n");
  console.log(`Wrote .wrangler/test-data.sql: ${people.length} people, ${leaveCount} leave requests, ${taskTitles.length} tasks, ${entry} timesheet days.`);
}

function cleanup() {
  const like = `'test-%'`;
  const sqlLines = [
    "-- Removes everything seed-test-data.mjs added (rows tagged test-...).",
    `DELETE FROM employee_identities WHERE id LIKE ${like};`,
    `DELETE FROM time_entries WHERE id LIKE ${like};`,
    `DELETE FROM leave_requests WHERE id LIKE ${like};`,
    `DELETE FROM tasks WHERE id LIKE ${like};`,
    `DELETE FROM events WHERE id LIKE ${like};`,
    `DELETE FROM announcements WHERE id LIKE ${like};`,
    `DELETE FROM assets WHERE id LIKE ${like};`,
    `DELETE FROM employee_profiles WHERE employee_id LIKE ${like};`,
    `DELETE FROM audit WHERE actor_id LIKE ${like} OR target_id LIKE ${like};`,
    `DELETE FROM auth_session_tokens WHERE session_id IN (SELECT session_id FROM auth_sessions WHERE employee_id LIKE ${like});`,
    `DELETE FROM auth_sessions WHERE employee_id LIKE ${like};`,
    `UPDATE employees SET manager_id=NULL WHERE manager_id LIKE ${like};`,
    `DELETE FROM employees WHERE id LIKE ${like};`,
  ];
  mkdirSync(path.join(root, ".wrangler"), { recursive: true });
  writeFileSync(path.join(root, ".wrangler/test-data-cleanup.sql"), sqlLines.join("\n") + "\n");
  console.log("Wrote .wrangler/test-data-cleanup.sql. Also remove the six Convex sign-ins with `npx convex run invites:remove` (in auth-convex).");
}

const command = process.argv[2];
if (command === "accounts") await accounts();
else if (command === "sql") sql();
else if (command === "cleanup") cleanup();
else fail("Usage: node scripts/seed-test-data.mjs accounts | sql | cleanup");
