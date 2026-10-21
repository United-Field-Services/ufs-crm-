// Synthetic server-render coverage, not a browser interaction or visual test.
// Inject test-only initial hook state in the loader; production source is never changed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

const componentURL = new URL('../app/employee-profile.tsx', import.meta.url).href;
const fixtureState = {};
globalThis.__ufsProfileRender = fixtureState;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === componentURL && specifier === './profile.css') return { url: 'ufs-profile-render:css', shortCircuit: true };
    if(specifier === '../lib/auth-fetch') return next(specifier+'.ts', context);
    if(specifier === './employee-avatar') return next(specifier+'.tsx', context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'ufs-profile-render:css') return { format: 'module', source: 'export {};', shortCircuit: true };
    if(url.endsWith('/employee-avatar.tsx'))return {format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};
    if (url !== componentURL) return next(url, context);
    let source = readFileSync(new URL(url), 'utf8');
    const injections = [
      ["useState<ProfileResponse | null>(null)", "useState<ProfileResponse | null>(globalThis.__ufsProfileRender.data)"],
      ["useState<Tab>('Overview')", "useState<Tab>(globalThis.__ufsProfileRender.tab || 'Overview')"],
      ["const [loading, setLoading] = useState(true);", "const [loading, setLoading] = useState(false);"],
      ["const [editing, setEditing] = useState<Item | null>(null);", "const [editing, setEditing] = useState<Item | null>(globalThis.__ufsProfileRender.editing || null);"],
      ["const [adding, setAdding] = useState<'salary' | 'bonus' | null>(null);", "const [adding, setAdding] = useState<'salary' | 'bonus' | null>(globalThis.__ufsProfileRender.adding || null);"],
    ];
    for (const [original, injected] of injections) {
      assert.ok(source.includes(original), `Test fixture injection needs updating: ${original}`);
      source = source.replace(original, injected);
    }
    return { format: 'module', source: ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText, shortCircuit: true };
  },
});
const { EmployeeProfile } = await import(componentURL);
after(() => { hooks.deregister(); delete globalThis.__ufsProfileRender; });

const base = {
  profile: {
    id: 'synthetic-employee', name: 'Taylor Example', title: 'Synthetic coordinator', department: 'Operations', location: 'Review office', employment: 'Full-Time', hire_date: '2026-01-10', active: 1, demo: 1,
    legal_first_name: 'Private First', legal_last_name: 'Private Last', birth_date: '1990-04-02', personal_email: 'synthetic-private@example.invalid', personal_phone: '+15555550100', email: 'taylor@example.invalid', employee_number: 'PRIVATE-NUMBER', employment_status: 'Active', division: 'Field', work_arrangement: 'Remote', manager_id: 'synthetic-manager',
  },
  access: { private: true, employment: true, compensation: true, hr: true, editable: true },
  emergencyContacts: [], identifiers: [], compensation: [], history: [], education: [], benefits: [],
};
const people = [{ id: 'synthetic-manager', name: 'Morgan Example', active: 1 }];
const noop = () => {};
const props = { employeeId: 'synthetic-employee', me: { id: 'synthetic-admin', role: 'admin' }, people, onSaved: async () => {}, onManageAccess: noop, onManageBudget: noop };
const allTabs = ['Overview', 'Personal', 'Contact', 'Emergency', 'Job', 'Education', 'Compensation', 'Benefits', 'Identifiers', 'History'];
function render(tab, data = base, extra = {}) {
  Object.assign(fixtureState, { data, tab, editing: extra.editing || null, adding: extra.adding || null });
  return renderToStaticMarkup(createElement(EmployeeProfile, { ...props, ...extra.props }));
}
for (const tab of allTabs) test(`profile renders ${tab}`, () => {
  const html = render(tab);
  assert.ok(html.includes(`profile-panel-${tab}`));
  assert.ok(html.includes('id="modal-title"'));
  assert.ok(html.includes('Private review build.'));
});
test('private fields stay out of directory view even with an overfull fixture', () => {
  const directory = { ...base, access: { private: false, employment: false, compensation: false, hr: false, editable: false } };
  for (const tab of allTabs) {
    const html = render(tab, directory);
    for (const value of ['synthetic-private@example.invalid', 'Private First', 'PRIVATE-NUMBER', '1990-04-02']) assert.ok(!html.includes(value));
    for (const hidden of ['Personal', 'Contact', 'Emergency', 'Education', 'Compensation', 'Benefits', 'Identifiers', 'History']) assert.ok(!html.includes(`profile-tab-${hidden}`));
  }
});
test('employee job information is read only', () => {
  const html = render('Job', { ...base, access: { ...base.access, hr: false } }, { props: { me: { id: 'synthetic-employee', role: 'employee' } } });
  assert.ok(!html.includes('name="title"'));
  assert.ok(html.includes('PRIVATE-NUMBER'));
  assert.ok(!html.includes('Save job details'));
});
test('HR cannot reassign the approval manager', () => {
  const html = render('Job', base, { props: { me: { id: 'synthetic-hr', role: 'hr_manager' } } });
  assert.match(html, /id="profile-manager"[^>]*disabled/);
});
test('admin can reassign the approval manager and edit arrangement and hours', () => {
  const html = render('Job');
  assert.doesNotMatch(html, /id="profile-manager"[^>]*disabled/);
  assert.ok(html.includes('Working hours per day'));
  assert.ok(html.includes('Work arrangement'));
});
test('personal fields include the requested coverage', () => {
  const html = render('Personal');
  for (const field of ['birth_date', 'legal_first_name', 'legal_last_name', 'preferred_name', 'gender', 'marital_status', 'nationality', 'citizenship', 'languages', 'linkedin']) assert.ok(html.includes(`name="${field}"`));
});
test('contact information separates account email and supports two addresses', () => {
  const html = render('Contact');
  assert.ok(html.includes('taylor@example.invalid'));
  assert.ok(!html.includes('name="email"'));
  for (const field of ['personal_email', 'work_phone_public', 'address_line1', 'secondary_address_line1', 'secondary_country']) assert.ok(html.includes(`name="${field}"`));
});
for (const [tab, field] of [['Emergency', 'priority'], ['Education', 'graduation_date'], ['Benefits', 'cost'], ['Identifiers', 'last4']]) test(`profile ${tab} add form renders`, () => {
  assert.ok(render(tab, base, { editing: {} }).includes(`name="${field}"`));
});
test('identifiers allow only constrained last-four metadata', () => {
  const html = render('Identifiers', base, { editing: {} });
  assert.ok(html.includes('Full identifier collection is disabled.'));
  assert.ok(html.includes('Social Security (SSN)'));
  assert.doesNotMatch(html.match(/<input[^>]*name="last4"[^>]*>/)?.[0] || '', /maxLength=/i);
  assert.match(html, /Longer values are rejected, never shortened/);
  for (const forbidden of ['name="ssn"', 'name="passport_number"', 'name="full_identifier"']) assert.ok(!html.includes(forbidden));
});
test('salary supports pay schedule and overtime classification', () => {
  const html = render('Compensation', base, { adding: 'salary' });
  assert.ok(html.includes('name="pay_schedule"'));
  assert.ok(html.includes('name="overtime_status"'));
  assert.ok(html.includes('Record compensation change'));
});
test('bonus form excludes salary-only fields', () => {
  const html = render('Compensation', base, { adding: 'bonus' });
  assert.ok(html.includes('One-time bonus amount'));
  assert.ok(!html.includes('name="frequency"'));
  assert.ok(!html.includes('name="overtime_status"'));
  assert.ok(html.includes('Record bonus'));
});
test('a bonus never replaces the current base salary', () => {
  const html = render('Compensation', { ...base, compensation: [
    { id: 'salary', record_type: 'Salary', amount: 60000, currency: 'USD', frequency: 'Annual', effective_date: '2020-01-01', reason: 'Synthetic salary' },
    { id: 'bonus', record_type: 'Bonus', amount: 1000, currency: 'USD', frequency: 'One-time', effective_date: '2020-02-01', reason: 'Synthetic bonus' },
  ] });
  assert.ok(html.indexOf('$60,000.00') < html.indexOf('$1,000.00'));
  assert.ok(html.includes('ONE-TIME BONUS'));
});
test('rehired employees show current employment separately from inactive login', () => {
  const html = render('Overview', { ...base, profile: { ...base.profile, active: 0 } }, { props: { people: [...people, { id: 'synthetic-employee', directory_active: 1, active: 0 }] } });
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector('.profile-directory-status').textContent, 'Current employee');
  assert.equal(document.querySelector('.profile-employment-status').textContent, 'Employment status: Active');
  assert.equal(document.querySelector('.profile-login-status').textContent, 'Login: Inactive');
  assert.ok(html.includes('DEMO'));
  assert.doesNotMatch(html, /Inactive account/);
});
for (const status of ['Active', 'Probation', 'On leave', 'Notice period']) test(`${status} status does not imply that login is active`, () => {
  const html = render('Overview', { ...base, profile: { ...base.profile, employment_status: status, active: false } }, { props: { people: [...people, { id: 'synthetic-employee', directory_active: true, active: false }] } });
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector('.profile-directory-status').textContent, 'Current employee');
  assert.equal(document.querySelector('.profile-employment-status').textContent, `Employment status: ${status}`);
  assert.equal(document.querySelector('.profile-login-status').textContent, 'Login: Inactive');
});
for (const status of ['Terminated', 'Inactive', 'Active']) test(`former directory classification is preserved with a ${status} profile status`, () => {
  const html = render('Overview', { ...base, profile: { ...base.profile, employment_status: status, active: 0, imported: true } }, { props: { people: [...people, { id: 'synthetic-employee', directory_active: 0, active: 0, imported: true, source_status: 'Terminated' }] } });
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector('.profile-directory-status').textContent, 'Former employee');
  assert.equal(document.querySelector('.profile-employment-status').textContent, `Employment status: ${status}`);
  assert.equal(document.querySelector('.profile-login-status').textContent, 'Login: Inactive');
  assert.doesNotMatch(html, /Current employee|Not activated|Inactive account/);
});
test('directory profile does not expose private employment status from an overfull fixture', () => {
  const data = { ...base, profile: { ...base.profile, active: 0, employment_status: 'On leave' }, access: { private: false, employment: false, compensation: false, hr: false, editable: false } };
  const html = render('Overview', data, { props: { people: [...people, { id: 'synthetic-employee', directory_active: 1, active: 0 }] } });
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector('.profile-directory-status').textContent, 'Current employee');
  assert.equal(document.querySelector('.profile-login-status').textContent, 'Login: Inactive');
  assert.equal(document.querySelector('.profile-employment-status'), null);
  assert.doesNotMatch(html, /On leave/);
});
test('missing directory classification is not guessed from login or a default profile status', () => {
  for (const active of [0, 1]) {
    const document = new JSDOM(render('Overview', { ...base, profile: { ...base.profile, active } })).window.document;
    assert.equal(document.querySelector('.profile-directory-status'), null);
    assert.equal(document.querySelector('.profile-employment-status').textContent, 'Employment status: Active');
    assert.equal(document.querySelector('.profile-login-status').textContent, active ? 'Login: Active' : 'Login: Inactive');
  }
});
test('imported-record login detail uses the fresh profile login flag rather than a stale directory flag', () => {
  const html = render('Overview', { ...base, profile: { ...base.profile, active: 0, imported: true } }, { props: { people: [...people, { id: 'synthetic-employee', directory_active: 1, active: 1, imported: true }] } });
  const document = new JSDOM(html).window.document;
  const loginLabel = [...document.querySelectorAll('.profile-details dt')].find(element => element.textContent === 'Login access');
  assert.equal(loginLabel.nextElementSibling.textContent, 'Inactive');
  assert.equal(document.querySelector('.profile-login-status').textContent, 'Login: Inactive');
});
test('missing login metadata does not invent an inactive login state', () => {
  const html = render('Overview', { ...base, profile: { ...base.profile, active: undefined } });
  assert.equal(new JSDOM(html).window.document.querySelector('.profile-login-status'), null);
});
test('rendered control IDs are unique in every profile tab', () => {
  for (const tab of allTabs) {
    const html = render(tab, base, { editing: {}, adding: 'salary' });
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size);
  }
});
test('identifier values display as masked metadata without full number fields', () => {
  const html = render('Identifiers', { ...base, identifiers: [{ id: 'meta', type: 'Passport', country: 'Fictionland', last4: 'A123', status: 'Recorded', expiry_date: '2027-02-01' }] });
  assert.ok(html.includes('•••• A123'));
  assert.ok(!html.includes('name="number"'));
});
test('embedded profile accepts a distinct title ID for modal accessibility', () => {
  const html = render('Overview', base, { props: { titleId: 'my-profile-title' } });
  assert.ok(html.includes('id="my-profile-title"'));
  assert.ok(!html.includes('id="modal-title"'));
});
test('employment history includes the effective-dated approval-manager snapshot', () => {
  const html = render('History', { ...base, history: [{ id: 'history', effective_date: '2026-01-01', reason: 'Synthetic team transfer', created_at: '2026-01-01', snapshot: { ...base.profile, manager_id: 'synthetic-manager' } }] });
  assert.ok(html.includes('Assigned leave approver at this change'));
  assert.ok(html.includes('Morgan Example'));
});
test('sparse imported job fields do not require invented title, department or location', () => {
 const html=render('Job',{...base,profile:{...base.profile,title:'',department:'',location:''}});
 for(const field of ['title','department','location']){const input=html.match(new RegExp('<input[^>]*name="'+field+'"[^>]*>'))?.[0]||'';assert.ok(input);assert.doesNotMatch(input,/ required(?:="")?/)}
});
test('imported manager history labels source reporting separately from app approvals', () => {
 const html=render('History',{...base,history:[{id:'source-history',effective_date:'2025-01-01',reason:'Imported TalentHR reporting manager history',created_at:'2026-10-11',snapshot:{source_kind:'manager',source_manager_name:'Synthetic historical supervisor'}}]});
 assert.match(html,/Source reporting manager at this change/);assert.match(html,/Synthetic historical supervisor/);assert.doesNotMatch(html,/Assigned leave approver at this change/);
});
test('profile photos use only the protected application image endpoint', () => {
 const html=render('Overview',{...base,profile:{...base.profile,has_photo:true,photo_version:'synthetic-version'}});
 assert.match(html,/src="\/api\/photos\/synthetic-employee\?v=synthetic-version"/);assert.match(html,/referrerPolicy="no-referrer"/);assert.ok(!html.includes('talenthr.io/photo'));
});
test('profiles without a photo keep initials without requesting a missing image', () => {
 const html=render('Overview',{...base,profile:{...base.profile,has_photo:false,photo_version:null}});assert.doesNotMatch(html,/src="\/api\/photos\//);assert.match(html,/profile-avatar-image employee-avatar/);
});

for (const name of ['Alexandra Montgomery Montgomery', 'Alexandria Catherine Montgomery-Wellington', 'A'.repeat(120), '김 지민', 'Taylor <Example> & Morgan']) test(`profile header preserves the complete display name: ${name.slice(0, 45)}`, () => {
 const html = render('Overview', { ...base, profile: { ...base.profile, name } }, { props: { me: { id: 'synthetic-employee', role: 'employee' } } });
 const document = new JSDOM(html).window.document;
 const header = document.querySelector('.profile-header');
 const heading = header.querySelector('.profile-name-row h2');
 assert.equal(heading.textContent, name);
 assert.equal(header.querySelectorAll('h2').length, 1);
 assert.equal(heading.id, 'modal-title');
 assert.equal(heading.closest('[aria-hidden="true"]'), null);
 assert.deepEqual([...header.children].map(element => element.className), ['profile-avatar', 'profile-identity', 'profile-header-status']);
 assert.equal(header.querySelector('.profile-header-status').parentElement, header);
 assert.equal(header.querySelector('.profile-name-row .profile-you').textContent, 'YOU');
});
