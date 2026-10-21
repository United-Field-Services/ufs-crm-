// Standalone-auth integration/policy tests. Real pinned @supabase/supabase-js SDK,
// real locally signed ES256 JWTs and JWKS verification, SQLite-backed real SQL.
// The HTTP transport is synthetic and deny-by-default: no provider calls, users,
// credentials, emails, factors, or sessions are created in any live project.
// This does not prove deployed Supabase settings, RPC SQL, or production revocation.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, origin, asUser } from './harness.mjs';

const auth = await import('../lib/standalone-auth.ts');
const server = await import('../lib/server.ts');
const login = await import('../app/api/auth/login/route.ts');
const logout = await import('../app/api/auth/logout/route.ts');
const refresh = await import('../app/api/auth/refresh/route.ts');
const sessionRoute = await import('../app/api/auth/session/route.ts');
const action = await import('../app/api/action/route.ts');
const policy = await import('../lib/policy.ts');
const signingKey = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', signingKey.publicKey), kid: 'ufs-synthetic-es256', alg: 'ES256', use: 'sig' };
const encoder = new TextEncoder();
const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const authKeys = ['UFS_QA_TEST_ACCESS','UFS_QA_EMPLOYEE_SUB','UFS_QA_HR_MANAGER_SUB','UFS_AUTH_MODE', 'UFS_SUPABASE_URL', 'UFS_SUPABASE_PUBLISHABLE_KEY', 'UFS_SUPABASE_SESSION_CHECK', 'UFS_SUPABASE_OWNER_SUB', 'UFS_SUPABASE_OWNER_EMPLOYEE_ID', 'UFS_SUPABASE_ADDITIONAL_ADMIN_SUB', 'UFS_SUPABASE_ADDITIONAL_ADMIN_EMPLOYEE_ID', 'UFS_AUTH_PUBLIC_PILOT_UNTIL'];
const roles = ['admin', 'hr_manager', 'manager', 'hiring_manager', 'employee'];
let f, originalFetch, previousEnv, transport;

async function signedToken(claims) {
  const input = `${b64({ alg: 'ES256', typ: 'JWT', kid: jwk.kid })}.${b64(claims)}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey.privateKey, encoder.encode(input));
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const failed = (message = 'Synthetic invalid credentials', status = 401) => json({ message, msg: message, code: 'invalid_credentials' }, status);
const bodyOf = async response => { const body = await response.json(); assert.equal(response.headers.get('cache-control')?.includes('no-store'), true); return body; };
const request = (path, body = {}, headers = {}) => new Request(`${origin}/api/auth/${path}`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...headers }, body: JSON.stringify(body),
});
const cookies = actor => `${auth.ACCESS_COOKIE}=${actor.access}; ${auth.REFRESH_COOKIE}=${actor.refresh}`;
const reqFor = (path, actor, body = {}, headers = {}) => request(path, body, { cookie: cookies(actor), ...headers });
const status = actor => sessionRoute.GET(new Request(`${origin}/api/auth/session`, { headers: { cookie: cookies(actor) } }));
const asCookies = (actor, callback, headers = {}) => globalThis.__ufsSecurityTest.context.run(new Headers({ cookie: cookies(actor), ...headers }), callback);
const rejectsStatus = (promise, expected) => assert.rejects(promise, error => error instanceof policy.AppError && error.status === expected);
const loginAs = (actor, overrides = {}) => login.POST(request('login', { email: actor.user.email, password: 'synthetic-test-value-only', ...overrides }));
const tokenCalls = () => transport.calls.filter(call => call.path === '/auth/v1/token');

function localSession(actor, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const row = { session_id: actor.claims.session_id, issuer: auth.SUPABASE_ISSUER, subject: actor.user.id, employee_id: actor.employee.id, created_at: now, last_seen: now, ...overrides };
  f.run(`INSERT INTO auth_sessions (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, ...Object.values(row));
}
async function issue(actor, claims = {}, makeCurrent = false) {
  const value = { ...actor.claims, ...claims };
  const access = await signedToken(value);
  transport.tokens.set(access, { actor, claims: value });
  if (makeCurrent) { actor.access = access; actor.claims = value; }
  return access;
}
async function actor(id = 'employee', options = {}) {
  const now = Math.floor(Date.now() / 1000), subject = crypto.randomUUID(), sessionId = crypto.randomUUID();
  const employee = f.employee(id, { user_id: null, ...options.employee });
  const result = {
    employee,
    user: { id: subject, aud: 'authenticated', role: 'authenticated', email: `${id}@example.test`, email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false, created_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, factors: [], ...options.user },
    claims: { iss: auth.SUPABASE_ISSUER, aud: 'authenticated', role: 'authenticated', sub: subject, session_id: sessionId, iat: now, exp: now + 3600, is_anonymous: false, aal: 'aal1', amr: [{ method: 'password', timestamp: now }], ...options.claims },
    refresh: `synthetic-refresh-${crypto.randomUUID()}`, live: true, userError: false,
  };
  if (options.mapping !== false) f.run('INSERT INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) VALUES (?,?,?,?,?,?,?)', crypto.randomUUID(), options.issuer ?? auth.SUPABASE_ISSUER, options.subject ?? subject, employee.id, options.enabled ?? 1, '2026-01-01T00:00:00Z', 'synthetic-reviewer');
  await issue(result, {}, true);
  transport.users.set(result.user.email.toLowerCase(), result);
  transport.refreshes.set(result.refresh, result);
  if (options.local !== false) localSession(result);
  return result;
}
function sessionData(actor, access = actor.access, refreshToken = actor.refresh) {
  return { access_token: access, refresh_token: refreshToken, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: actor.user };
}
function installTransport() {
  const state = { calls: [], unexpected: [], tokens: new Map(), users: new Map(), refreshes: new Map(), failRpc: false, failUser: false, failLogout: false, loginError: false, delay: null };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    const method = init.method ?? (input instanceof Request ? input.method : 'GET');
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : null;
    const bearer = headers.get('authorization')?.replace(/^Bearer /, '');
    const known = state.tokens.get(bearer), who = known?.actor;
    const call = { url: url.href, path: url.pathname, method, headers, body, cache: init.cache, subject: known?.claims.sub };
    state.calls.push(call);
    if (url.origin !== auth.SUPABASE_URL) { state.unexpected.push(url.href); return failed('Unexpected test request', 400); }
    if (state.delay) await state.delay(call);
    if (url.pathname === '/auth/v1/.well-known/jwks.json') return json({ keys: [jwk] });
    if (url.pathname === '/auth/v1/user') return !who || who.userError || state.failUser ? failed() : json(who.user);
    if (url.pathname === '/rest/v1/rpc/ufs_session_is_active') return state.failRpc ? json({ message: 'Synthetic RPC unavailable' }, 503) : json(!!who?.live);
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const user = state.users.get(body?.email);
      return !user || state.loginError || body.password !== 'synthetic-test-value-only' ? failed() : json(sessionData(user));
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const user = state.refreshes.get(body?.refresh_token);
      if (!user || !user.live) return failed('Synthetic invalid refresh token', 400);
      state.refreshes.delete(body.refresh_token);
      const nextRefresh = `synthetic-rotated-${crypto.randomUUID()}`;
      const nextAccess = await issue(user, { iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, synthetic_rotation: nextRefresh });
      state.refreshes.set(nextRefresh, user);
      return json(sessionData(user, nextAccess, nextRefresh));
    }
    if (url.pathname === '/auth/v1/logout') {
      if (state.failLogout) return failed('Synthetic logout unavailable', 400);
      if (who) { who.live = false; for (const [key, value] of state.refreshes) if (value === who) state.refreshes.delete(key); }
      return new Response(null, { status: 204 });
    }
    state.unexpected.push(url.href); return failed('Unexpected test request', 400);
  };
  return state;
}
beforeEach(() => {
  f = fixture(); previousEnv = Object.fromEntries(authKeys.map(key => [key, f.env[key]]));
  Object.assign(f.env, { UFS_AUTH_MODE: 'pilot', UFS_SUPABASE_URL: auth.SUPABASE_URL, UFS_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic', UFS_SUPABASE_SESSION_CHECK: 'enabled' });
  originalFetch = globalThis.fetch; transport = installTransport();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of authKeys) if (previousEnv[key] === undefined) delete f.env[key]; else f.env[key] = previousEnv[key];
  f.close(); assert.deepEqual(transport.unexpected, [], 'No unexpected or real HTTP requests are permitted');
});

for (const [label, change] of [
  ['disabled mode', { UFS_AUTH_MODE: undefined }], ['unknown mode', { UFS_AUTH_MODE: 'public' }],
  ['wrong project', { UFS_SUPABASE_URL: 'https://untrusted.example.test' }],
  ['project URL suffix', { UFS_SUPABASE_URL: `${auth.SUPABASE_URL}/` }],
  ['missing public key', { UFS_SUPABASE_PUBLISHABLE_KEY: undefined }],
  ['legacy secret instead of publishable key', { UFS_SUPABASE_PUBLISHABLE_KEY: 'synthetic-legacy-secret' }],
  ['missing online revocation prerequisite', { UFS_SUPABASE_SESSION_CHECK: undefined }],
]) test(`configuration fails closed: ${label}`, async () => {
  Object.assign(f.env, change); assert.equal(auth.standaloneConfigured(), false);
  assert.deepEqual(await bodyOf(await sessionRoute.GET(new Request(`${origin}/api/auth/session`))), { enabled: false, authenticated: false });
  assert.equal((await login.POST(request('login', { email: 'synthetic@example.test', password: 'synthetic-test-value-only' }))).status, 503);
  assert.equal(transport.calls.length, 0);
});

for (const [name, route] of [['login', login], ['logout', logout], ['refresh', refresh]]) {
  for (const [reason, headers] of [['missing origin', { origin: '' }], ['foreign origin', { origin: 'https://attacker.example.test' }], ['cross-site fetch', { 'sec-fetch-site': 'cross-site' }]]) {
    test(`${name} rejects CSRF: ${reason} before provider or database changes`, async () => {
      assert.equal((await route.POST(request(name, {}, headers))).status, 403);
      assert.equal(transport.calls.length, 0); assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 0); assert.equal(f.get('SELECT COUNT(*) n FROM auth_rate_limits').n, 0);
    });
  }
}

test('real SDK validates ES256 signature; payload or signature tampering never reaches user/RPC checks', async () => {
  const a = await actor(); assert.equal((await auth.verifyIdentity(a.access)).employee.id, a.employee.id);
  const [header, payload, signature] = a.access.split('.');
  const altered = `${header}.${b64({ ...JSON.parse(Buffer.from(payload, 'base64url')), sub: crypto.randomUUID() })}.${signature}`;
  const bytes = Buffer.from(signature, 'base64url'); bytes[0] ^= 1;
  for (const token of [altered, `${header}.${payload}.${bytes.toString('base64url')}`]) {
    transport.calls.length = 0; await rejectsStatus(auth.verifyIdentity(token), 401);
    assert.equal(transport.calls.some(call => call.path === '/auth/v1/user' || call.path.startsWith('/rest/')), false);
  }
});

for (const [label, claims] of [
  ['wrong issuer', { iss: 'https://wrong.example.test/auth/v1' }], ['issuer suffix', { iss: `${auth.SUPABASE_ISSUER}/` }],
  ['wrong audience', { aud: 'anon' }], ['audience array', { aud: ['authenticated'] }], ['service-role JWT', { role: 'service_role' }],
  ['non-UUID subject', { sub: 'synthetic-subject' }], ['non-UUID session', { session_id: 'synthetic-session' }],
  ['anonymous JWT', { is_anonymous: true }], ['missing anonymous claim', { is_anonymous: undefined }],
  ['expired JWT', { exp: 1 }], ['non-numeric expiry', { exp: '9999999999' }],
  ['future issued-at', { iat: Math.floor(Date.now() / 1000) + 600 }], ['missing issued-at', { iat: undefined }],
  ['unsupported assurance level', { aal: 'aal3' }], ['missing authentication methods', { amr: undefined }],
  ['email OTP-only AMR', { amr: [{ method: 'otp', timestamp: 1 }] }], ['OAuth-only AMR', { amr: [{ method: 'oauth', timestamp: 1 }] }],
  ['string AMR', { amr: 'password' }],
]) test(`signed but unacceptable claims are rejected: ${label}`, async () => {
  const a = await actor(); const token = await issue(a, claims); await rejectsStatus(auth.verifyIdentity(token), 401);
  assert.equal(transport.calls.some(call => call.path.startsWith('/rest/')), false);
});

test('aal2 requires authenticator AMR, not just a signed aal2 label', async () => {
  const a = await actor('admin', { employee: { role: 'admin' }, claims: { aal: 'aal2' } });
  await rejectsStatus(auth.verifyIdentity(a.access), 401);
});

for (const [label, mutate] of [
  ['unconfirmed', a => { a.user.email_confirmed_at = null; }], ['deleted upstream', a => { a.userError = true; }],
  ['anonymous upstream', a => { a.user.is_anonymous = true; }], ['subject mismatch', a => { a.user.id = crypto.randomUUID(); }],
  ['revoked upstream session', a => { a.live = false; }],
]) test(`fresh provider state fails closed: ${label}`, async () => {
  const a = await actor(); mutate(a); await rejectsStatus(auth.verifyIdentity(a.access), 401);
});

test('banned user object is rejected even if the provider returns HTTP 200', async () => {
  const a = await actor('banned', { user: { banned_until: new Date(Date.now() + 86400000).toISOString() } }); await rejectsStatus(auth.verifyIdentity(a.access), 401);
});
test('deleted user object is rejected even if the provider returns HTTP 200', async () => {
  const a = await actor('deleted', { user: { deleted_at: '2026-01-01T00:00:00Z' } }); await rejectsStatus(auth.verifyIdentity(a.access), 401);
});
test('online self-session RPC uses the exact function and user token, and outage fails closed', async () => {
  const a = await actor(); await auth.verifyIdentity(a.access);
  const rpc = transport.calls.find(call => call.path.startsWith('/rest/'));
  assert.equal(rpc.path, '/rest/v1/rpc/ufs_session_is_active'); assert.equal(rpc.method, 'POST'); assert.equal(rpc.headers.get('authorization'), `Bearer ${a.access}`);
  transport.failRpc = true; await rejectsStatus(auth.verifyIdentity(a.access), 503);
  assert.equal(transport.calls.every(call => call.cache === 'no-store'), true);
});

for (const [label, options] of [['no approved mapping', { mapping: false }], ['disabled mapping', { enabled: 0 }], ['wrong immutable issuer', { issuer: 'https://other.example.test/auth/v1' }], ['wrong immutable subject', { subject: crypto.randomUUID() }]]) {
  test(`no email auto-linking: ${label}`, async () => {
    const a = await actor('same-email', options); await rejectsStatus(auth.verifyIdentity(a.access), 403);
    assert.equal(f.get('SELECT user_id FROM employees WHERE id=?', a.employee.id).user_id, null);
    assert.equal(f.get('SELECT COUNT(*) n FROM employee_identities').n, options.mapping === false ? 0 : 1);
  });
}
test('changed provider email still uses the approved issuer+subject mapping', async () => {
  const a = await actor(); a.user.email = 'renamed-synthetic@example.test'; assert.equal((await auth.verifyIdentity(a.access)).employee.id, a.employee.id);
});
test('employee role comes only from D1; forged auth metadata and request fields cannot promote it', async () => {
  const a = await actor('employee', { user: { user_metadata: { role: 'admin', employee_id: 'admin' }, app_metadata: { role: 'admin', roles: ['admin'] } }, claims: { user_metadata: { role: 'admin' }, app_metadata: { role: 'admin' } } });
  const verified = await auth.verifyIdentity(a.access); assert.equal(verified.employee.role, 'employee');
  const response = await asCookies(a, () => action.POST(new Request(`${origin}/api/action`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'addEvent', title: 'Synthetic event', date: '2026-12-01', role: 'admin', user_id: 'admin' }) })));
  assert.equal(response.status, 403); assert.equal(f.get('SELECT COUNT(*) n FROM events').n, 0);
});

for (const role of roles) test(`role ${role}: server authority comes only from D1 and no authenticator is required`, async () => {
  const a = await actor(role, { employee: { role } });
  const verified = await auth.verifyIdentity(a.access); assert.equal(verified.employee.role, role);
  const body = await auth.authStatus(verified); assert.equal(body.authenticated, true); });
for (const [label, options] of [['inactive employee', { employee: { active: 0 } }], ['demo employee', { employee: { demo: 1 } }], ['unknown role', { employee: { role: 'super_admin' } }]]) test(`employee eligibility denies ${label}`, async () => { const a = await actor('ineligible', options); await rejectsStatus(auth.verifyIdentity(a.access), 403); });
for (const state of ['inactive', 'terminated', 'archived']) {
  test(`former profile ${state} denied even when employees.active=1`, async () => {
    const a = await actor(); f.run('INSERT INTO employee_profiles (employee_id,employment_status,updated_at) VALUES (?,?,?)', a.employee.id, ` ${state.toUpperCase()} `, '2026-01-01'); await rejectsStatus(auth.verifyIdentity(a.access), 403);
  });
  test(`imported former ${state} denied even when employees.active=1`, async () => {
    const a = await actor(); f.run('INSERT INTO source_employee_links (source_id,employee_id,source_email,source_status,imported_at) VALUES (?,?,?,?,?)', 'synthetic-source', a.employee.id, a.employee.email, ` ${state.toUpperCase()} `, '2026-01-01'); await rejectsStatus(auth.verifyIdentity(a.access), 403);
  });
}

test('pilot legacy fallback admits only an already-bound eligible admin and never binds by email', async () => {
  const admin = f.employee('legacy-admin', { role: 'admin' }); assert.equal((await asUser(admin, () => server.currentEmployee())).id, admin.id);
  const ordinary = f.employee('legacy-employee'); await rejectsStatus(asUser(ordinary, () => server.currentEmployee()), 401);
  const unbound = f.employee('legacy-unbound', { role: 'admin', user_id: null });
  await rejectsStatus(asUser({ user_id: 'new-synthetic-identity', email: unbound.email }, () => server.currentEmployee()), 401);
  assert.equal(f.get('SELECT user_id FROM employees WHERE id=?', unbound.id).user_id, null);
  f.env.UFS_AUTH_MODE = 'standalone'; await rejectsStatus(asUser(admin, () => server.currentEmployee()), 401);
});
test('an invalid standalone cookie never falls back to a legacy administrator', async () => {
  const admin = f.employee('legacy-admin', { role: 'admin' });
  await rejectsStatus(globalThis.__ufsSecurityTest.context.run(new Headers({ cookie: `${auth.ACCESS_COOKIE}=bad-token`, 'oai-authenticated-user-id': admin.user_id, 'oai-authenticated-user-email': admin.email }), () => server.currentEmployee()), 401);
});

test('login issues exactly secure HttpOnly host-only cookies and no tokens or employee data in JSON', async () => {
  const a = await actor('login', { local: false }); const response = await loginAs(a, { email: `  ${a.user.email.toUpperCase()}  ` }); assert.equal(response.status, 200);
  const setCookies = response.headers.getSetCookie(); assert.equal(setCookies.length, 2);
  for (const [index, name] of [auth.ACCESS_COOKIE, auth.REFRESH_COOKIE].entries()) {
    assert.ok(setCookies[index].startsWith(`${name}=`));
    for (const attribute of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict', 'Max-Age=43200']) assert.ok(setCookies[index].includes(attribute));
    assert.equal(/domain=/i.test(setCookies[index]), false);
  }
  const body = await bodyOf(response); assert.deepEqual(body, { ok: true, enabled: true, authenticated: true });
  assert.equal(JSON.stringify(body).includes(a.access), false); assert.equal(JSON.stringify(body).includes(a.refresh), false);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.equal(response.headers.get('vary'), 'Cookie');
  assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 1); assert.equal(tokenCalls()[0].body.email, a.user.email);
});
for (const [label, body, headers, expected] of [
  ['form content type', {}, { 'content-type': 'application/x-www-form-urlencoded' }, 415], ['invalid email', { email: 'invalid', password: 'x' }, {}, 400],
  ['empty password', { email: 'synthetic@example.test', password: '' }, {}, 400], ['oversized password', { email: 'synthetic@example.test', password: 'x'.repeat(1025) }, {}, 400],
  ['array input', [], {}, 400], ['oversized JSON', { pad: 'x'.repeat(21000) }, {}, 413],
]) test(`login input validation: ${label}`, async () => { assert.equal((await login.POST(request('login', body, headers))).status, expected); assert.equal(transport.calls.length, 0); });
test('failed credentials and unmapped accounts never set authentication cookies', async () => {
  const a = await actor('unmapped', { mapping: false, local: false });
  let response = await loginAs(a, { password: 'synthetic-wrong-value' }); assert.equal(response.status, 401); assert.equal(response.headers.getSetCookie().length, 0);
  response = await loginAs(a); assert.equal(response.status, 403); assert.equal(response.headers.getSetCookie().length, 0); assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 0);
});

test('identity throttling normalizes emails and blocks the eleventh password request', async () => {
  const a = await actor(); transport.loginError = true;
  for (let i = 0; i < 10; i++) assert.equal((await loginAs(a, { email: i % 2 ? ` ${a.user.email.toUpperCase()} ` : a.user.email })).status, 401);
  assert.equal((await loginAs(a)).status, 429); assert.equal(tokenCalls().length, 10);
  const rows = f.rows('SELECT key FROM auth_rate_limits'); assert.ok(rows.length > 0); assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.key))); assert.equal(JSON.stringify(rows).includes(a.user.email), false);
});
test('network throttling blocks distributed-email attempts and allows the next window', async () => {
  for (let i = 0; i < 40; i++) await auth.rateLimit(request('login'), `synthetic-${i}@example.test`);
  await rejectsStatus(auth.rateLimit(request('login'), 'synthetic-over-limit@example.test'), 429);
  f.run('UPDATE auth_rate_limits SET window_start=window_start-900'); await auth.rateLimit(request('login'), 'synthetic-next-window@example.test');
});
test('concurrent failed logins cannot overrun the per-identity limit', async () => {
  const a = await actor(); transport.loginError = true; const responses = await Promise.all(Array.from({ length: 20 }, () => loginAs(a)));
  assert.ok(responses.every(response => [401, 429].includes(response.status))); assert.ok(responses.some(response => response.status === 429)); assert.ok(tokenCalls().length <= 10);
});

for (const value of [`${auth.ACCESS_COOKIE}=a; ${auth.ACCESS_COOKIE}=b`, `${auth.ACCESS_COOKIE}=%2e`, `${auth.ACCESS_COOKIE}=a b`, `${auth.REFRESH_COOKIE}=${'x'.repeat(8193)}`]) test(`reject ambiguous or malformed auth cookie (${value.slice(0, 55)})`, () => { assert.throws(() => auth.readAuthCookies(new Headers({ cookie: value })), error => error.status === 401); });
test('cookie serializer rejects injection and oversized token values', () => { for (const token of ['a;b', 'x'.repeat(3801), 'a\r\nb']) assert.throws(() => auth.authCookieHeaders({ access_token: token, refresh_token: 'synthetic' }), error => error.status === 503); });
test('session endpoint reveals no authentication tokens and immediately rechecks role/eligibility', async () => {
  const a = await actor(); const response = await status(a); assert.equal(response.status, 200); const body = await bodyOf(response); assert.equal(body.authenticated, true); assert.equal('user' in body, false); assert.equal('access_token' in body, false);
  f.run('UPDATE employees SET active=0 WHERE id=?', a.employee.id); assert.equal((await status(a)).status, 403);
});

test('refresh rotates both HttpOnly cookies; consumed refresh token cannot be replayed', async () => {
  const a = await actor(); const response = await refresh.POST(reqFor('refresh', a)); assert.equal(response.status, 200);
  const setCookies = response.headers.getSetCookie(); assert.equal(setCookies.length, 2); assert.equal(setCookies.some(value => value.startsWith(`${auth.REFRESH_COOKIE}=${a.refresh};`)), false);
  const nextAccess = setCookies.find(value => value.startsWith(`${auth.ACCESS_COOKIE}=`)).split(';')[0].split('=')[1]; assert.notEqual(nextAccess, a.access);
  assert.equal((await bodyOf(response)).authenticated, true); assert.equal((await refresh.POST(reqFor('refresh', a))).status, 401);
  assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 1);
});
for (const [label, mutate] of [
  ['missing local session', a => f.run('DELETE FROM auth_sessions WHERE session_id=?', a.claims.session_id)],
  ['idle timeout', a => f.run('UPDATE auth_sessions SET last_seen=? WHERE session_id=?', Math.floor(Date.now() / 1000) - 1800, a.claims.session_id)],
  ['absolute timeout', a => f.run('UPDATE auth_sessions SET created_at=? WHERE session_id=?', Math.floor(Date.now() / 1000) - 43200, a.claims.session_id)],
  ['local revocation', a => f.run('UPDATE auth_sessions SET revoked_at=? WHERE session_id=?', Math.floor(Date.now() / 1000), a.claims.session_id)],
]) test(`refresh cannot resurrect ${label}`, async () => {
  const a = await actor(); mutate(a); const response = await refresh.POST(reqFor('refresh', a)); assert.equal(response.status, 401); assert.equal(response.headers.getSetCookie().some(value => !value.includes('Max-Age=0')), false);
});
test('session heartbeat updates idle time without extending absolute lifetime', async () => {
  const a = await actor(); const created = Math.floor(Date.now() / 1000) - 3000; f.run('UPDATE auth_sessions SET created_at=?,last_seen=? WHERE session_id=?', created, Math.floor(Date.now() / 1000) - 1000, a.claims.session_id);
  await auth.verifyIdentity(a.access); const row = f.get('SELECT * FROM auth_sessions WHERE session_id=?', a.claims.session_id); assert.equal(row.created_at, created); assert.ok(row.last_seen > created + 2000);
});
test('a local session is bound to issuer, subject and employee, never only session UUID', async () => {
  const a = await actor('a'), b = await actor('b'); const forged = await issue(b, { session_id: a.claims.session_id }); await rejectsStatus(auth.verifyIdentity(forged), 401);
});

test('logout clears both cookies, locally revokes and prevents access and refresh replay', async () => {
  const a = await actor('logout', { local: false }); assert.equal((await loginAs(a)).status, 200); const response = await logout.POST(reqFor('logout', a)); assert.equal(response.status, 200); assert.deepEqual(await bodyOf(response), { ok: true, providerSignOutComplete: true });
  assert.equal(response.headers.getSetCookie().length, 2); assert.ok(response.headers.getSetCookie().every(value => value.includes('Max-Age=0') && value.includes('HttpOnly') && value.includes('Secure')));
  assert.ok(f.get('SELECT revoked_at FROM auth_sessions WHERE session_id=?', a.claims.session_id).revoked_at);
  a.live = true; await rejectsStatus(auth.verifyIdentity(a.access), 401); assert.equal((await refresh.POST(reqFor('refresh', a))).status, 401);
});
test('logout revokes locally even when provider sign-out fails', async () => {
  const a = await actor('logout-failure', { local: false }); assert.equal((await loginAs(a)).status, 200); transport.failLogout = true; const response = await logout.POST(reqFor('logout', a)); assert.equal(response.status, 200); assert.equal((await bodyOf(response)).providerSignOutComplete, false); assert.equal(a.live, true); await rejectsStatus(auth.verifyIdentity(a.access), 401);
});
test('logout during provider verification outage cannot allow replay after recovery', async () => {
  const a = await actor('logout-outage', { local: false }); assert.equal((await loginAs(a)).status, 200); transport.failRpc = true; transport.failUser = true; const response = await logout.POST(reqFor('logout', a)); assert.equal(response.status, 200); assert.equal((await bodyOf(response)).providerSignOutComplete, false); transport.failRpc = false; transport.failUser = false; assert.equal(a.live, true); await rejectsStatus(auth.verifyIdentity(a.access), 401);
});
test('logout with expired access token revokes its local session before refreshed replay', async () => {
  const a = await actor('logout-expired', { local: false }); assert.equal((await loginAs(a)).status, 200);
  const originalNow = Date.now; transport.failUser = true; transport.failLogout = true;
  try { Date.now = () => (a.claims.exp + 60) * 1000; assert.equal((await logout.POST(reqFor('logout', a))).status, 200); } finally { Date.now = originalNow; transport.failUser = false; transport.failLogout = false; }
  assert.equal(a.live, true); await rejectsStatus(auth.verifyIdentity(a.access), 401);
});
test('logout without a valid session remains safe and idempotently clears cookies', async () => { for (let i = 0; i < 2; i++) { const response = await logout.POST(request('logout')); assert.equal(response.status, 200); assert.equal(response.headers.getSetCookie().length, 2); } });


test('interleaved users never share auth headers, identity, or refreshed cookies', async () => {
  const a = await actor('a'), b = await actor('b'); transport.delay = call => new Promise(resolve => setTimeout(resolve, call.subject === a.user.id ? 2 : 0));
  const identities = await Promise.all(Array.from({ length: 20 }, (_, i) => auth.verifyIdentity(i % 2 ? a.access : b.access)));
  identities.forEach((identity, i) => assert.equal(identity.employee.id, i % 2 ? a.employee.id : b.employee.id));
  const responses = await Promise.all([refresh.POST(reqFor('refresh', a)), refresh.POST(reqFor('refresh', b))]);
  for (let i = 0; i < 2; i++) {
    assert.equal(responses[i].status, 200); const access = responses[i].headers.getSetCookie().find(value => value.startsWith(`${auth.ACCESS_COOKIE}=`)).split(';')[0].split('=')[1]; assert.equal((await auth.verifyIdentity(access)).employee.id, i ? b.employee.id : a.employee.id);
  }
  for (const call of transport.calls.filter(value => value.path.startsWith('/rest/'))) assert.ok([a.user.id, b.user.id].includes(call.subject));
});


test('persistent auth tables hold access-token fingerprints, never raw access or refresh tokens', async () => {
  const a = await actor('hash-only', { local: false }); assert.equal((await loginAs(a)).status, 200);
  const rows = f.rows('SELECT * FROM auth_session_tokens'); assert.equal(rows.length, 1); assert.match(rows[0].token_hash, /^[a-f0-9]{64}$/);
  const expected = Buffer.from(await crypto.subtle.digest('SHA-256', encoder.encode(a.access))).toString('hex'); assert.equal(rows[0].token_hash, expected);
  const all = JSON.stringify([...rows, ...f.rows('SELECT * FROM auth_sessions'), ...f.rows('SELECT * FROM auth_rate_limits')]); assert.equal(all.includes(a.access), false); assert.equal(all.includes(a.refresh), false);
});
test('unrecognized token claiming an existing session cannot locally revoke the victim', async () => {
  const a = await actor('victim', { local: false }); assert.equal((await loginAs(a)).status, 200);
  const unrecognized = await issue(a, { synthetic_unrecognized: true }); transport.failUser = true;
  const response = await logout.POST(request('logout', {}, { cookie: `${auth.ACCESS_COOKIE}=${unrecognized}; ${auth.REFRESH_COOKIE}=synthetic-unknown-refresh` })); assert.equal(response.status, 200); transport.failUser = false;
  assert.equal(f.get('SELECT revoked_at FROM auth_sessions WHERE session_id=?', a.claims.session_id).revoked_at, null); assert.equal((await auth.verifyIdentity(a.access)).employee.id, a.employee.id);
});
test('logout with an earlier verified token revokes every rotated token for that session', async () => {
  const a = await actor('rotation-logout', { local: false }); assert.equal((await loginAs(a)).status, 200);
  const response = await refresh.POST(reqFor('refresh', a)); assert.equal(response.status, 200);
  const rotated = response.headers.getSetCookie().find(value => value.startsWith(`${auth.ACCESS_COOKIE}=`)).split(';')[0].split('=')[1];
  transport.failLogout = true; assert.equal((await logout.POST(reqFor('logout', a))).status, 200);
  await rejectsStatus(auth.verifyIdentity(a.access), 401); await rejectsStatus(auth.verifyIdentity(rotated), 401);
});
test('login cannot reactivate an already revoked local session UUID', async () => {
  const a = await actor('revoked-login', { local: false }); assert.equal((await loginAs(a)).status, 200); transport.failLogout = true; assert.equal((await logout.POST(reqFor('logout', a))).status, 200);
  const response = await loginAs(a); assert.equal(response.status, 401); assert.equal(response.headers.getSetCookie().some(value => !value.includes('Max-Age=0')), false);
});

async function ownerCandidate(options = {}) {
  const a = await actor(crypto.randomUUID(), { mapping: false, local: false, ...options, employee: { role: 'admin', user_id: 'synthetic-legacy-owner', ...options.employee } });
  f.env.UFS_SUPABASE_OWNER_SUB = a.claims.sub; f.env.UFS_SUPABASE_OWNER_EMPLOYEE_ID = a.employee.id;
  return a;
}
const ownerAudits = () => f.rows("SELECT * FROM audit WHERE action='Bound approved standalone owner identity'");
const noBootstrap = () => { assert.equal(f.get('SELECT COUNT(*) n FROM employee_identities').n, 0); assert.equal(ownerAudits().length, 0); };

test('exact owner runtime approval binds only an existing eligible legacy admin, once, with one audit', async () => {
  const a = await ownerCandidate(); const original = f.get('SELECT * FROM employees WHERE id=?', a.employee.id);
  let response = await loginAs(a); assert.equal(response.status, 200);   const binding = f.get('SELECT * FROM employee_identities'); assert.equal(binding.subject, a.claims.sub); assert.equal(binding.issuer, auth.SUPABASE_ISSUER); assert.equal(binding.employee_id, a.employee.id); assert.equal(binding.enabled, 1); assert.equal(binding.approved_by, 'explicit-owner-runtime-approval');
  assert.deepEqual(f.get('SELECT * FROM employees WHERE id=?', a.employee.id), original); assert.equal(f.get('SELECT COUNT(*) n FROM employees').n, 1);
  response = await loginAs(a); assert.equal(response.status, 200); assert.deepEqual(f.get('SELECT * FROM employee_identities'), binding);
  const audits = ownerAudits(); assert.equal(audits.length, 1); assert.equal(audits[0].actor_id, a.employee.id); assert.equal(audits[0].target_id, a.employee.id);
});
test('owner bootstrap stays exact and idempotent under concurrent verified logins', async () => {
  const a = await ownerCandidate(); const responses = await Promise.all(Array.from({ length: 6 }, () => loginAs(a)));
  assert.ok(responses.every(result => result.status === 200)); assert.equal(f.get('SELECT COUNT(*) n FROM employee_identities').n, 1); assert.equal(ownerAudits().length, 1);
});
for (const [label, configure] of [
  ['missing approved subject', () => { delete f.env.UFS_SUPABASE_OWNER_SUB; }],
  ['missing approved employee', () => { delete f.env.UFS_SUPABASE_OWNER_EMPLOYEE_ID; }],
  ['different approved subject', () => { f.env.UFS_SUPABASE_OWNER_SUB = crypto.randomUUID(); }],
  ['non-UUID target employee', () => { f.env.UFS_SUPABASE_OWNER_EMPLOYEE_ID = 'synthetic-employee'; }],
  ['nonexistent target employee', () => { f.env.UFS_SUPABASE_OWNER_EMPLOYEE_ID = crypto.randomUUID(); }],
]) test(`owner bootstrap refuses ${label} without creating people or bindings`, async () => {
  const a = await ownerCandidate(); configure(); const response = await loginAs(a); assert.equal(response.status, 403); noBootstrap(); assert.equal(f.get('SELECT COUNT(*) n FROM employees').n, 1); assert.equal(f.get('SELECT role FROM employees').role, 'admin');
});
for (const role of ['employee', 'manager', 'hr_manager', 'hiring_manager', 'super_admin']) test(`owner configuration cannot promote current role ${role}`, async () => {
  const a = await ownerCandidate({ employee: { role } }); assert.equal((await loginAs(a)).status, 403); noBootstrap(); assert.equal(f.get('SELECT role FROM employees').role, role);
});
for (const [label, employee] of [['disabled', { active: 0 }], ['demo', { demo: 1 }], ['no prior legacy identity', { user_id: null }]]) test(`owner bootstrap cannot restore ${label} admin`, async () => {
  const a = await ownerCandidate({ employee }); const before = f.get('SELECT * FROM employees'); assert.equal((await loginAs(a)).status, 403); noBootstrap(); assert.deepEqual(f.get('SELECT * FROM employees'), before);
});
for (const state of ['inactive', 'terminated', 'archived']) test(`owner bootstrap cannot bypass former ${state} profile`, async () => {
  const a = await ownerCandidate(); f.run('INSERT INTO employee_profiles (employee_id,employment_status,updated_at) VALUES (?,?,?)', a.employee.id, state, '2026-01-01'); assert.equal((await loginAs(a)).status, 403); noBootstrap();
});
test('matching owner email cannot bind a different Supabase subject or elevate its role', async () => {
  const a = await ownerCandidate(); const b = await actor('same-email-intruder', { mapping: false, local: false }); b.user.email = a.user.email; transport.users.set(a.user.email, b);
  assert.equal((await loginAs(b)).status, 403); noBootstrap(); assert.equal(f.get('SELECT role FROM employees WHERE id=?', b.employee.id).role, 'employee'); assert.equal(f.get('SELECT COUNT(*) n FROM employees').n, 2);
});
test('disabled exact owner binding remains disabled and immutable', async () => {
  const a = await ownerCandidate(); const id = crypto.randomUUID(); f.run('INSERT INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) VALUES (?,?,?,?,?,?,?)', id, auth.SUPABASE_ISSUER, a.claims.sub, a.employee.id, 0, '2026-01-01', 'synthetic-prior-approver');
  const before = f.get('SELECT * FROM employee_identities'); assert.equal((await loginAs(a)).status, 403); assert.deepEqual(f.get('SELECT * FROM employee_identities'), before); assert.equal(ownerAudits().length, 0);
});
test('owner target already bound to another subject cannot be reassigned', async () => {
  const a = await ownerCandidate(); f.run('INSERT INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) VALUES (?,?,?,?,?,?,?)', crypto.randomUUID(), auth.SUPABASE_ISSUER, crypto.randomUUID(), a.employee.id, 1, '2026-01-01', 'synthetic-prior-approver');
  const before = f.get('SELECT * FROM employee_identities'); assert.equal((await loginAs(a)).status, 403); assert.deepEqual(f.get('SELECT * FROM employee_identities'), before); assert.equal(ownerAudits().length, 0);
});
test('approved subject already bound elsewhere keeps that immutable mapping and ordinary role', async () => {
  const a = await ownerCandidate(); const other = f.employee('already-bound-employee', { user_id: null });
  f.run('INSERT INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) VALUES (?,?,?,?,?,?,?)', crypto.randomUUID(), auth.SUPABASE_ISSUER, a.claims.sub, other.id, 1, '2026-01-01', 'synthetic-prior-approver');
  const before = f.get('SELECT * FROM employee_identities'); assert.equal((await loginAs(a)).status, 200); assert.deepEqual(f.get('SELECT * FROM employee_identities'), before); assert.equal((await auth.verifyIdentity(a.access)).employee.role, 'employee'); assert.equal(ownerAudits().length, 0);
});
for (const [label, options, mutate] of [
  ['unconfirmed', { user: { email_confirmed_at: null } }],
  ['banned', { user: { banned_until: new Date(Date.now() + 86400000).toISOString() } }],
  ['deleted', { user: { deleted_at: '2026-01-01T00:00:00Z' } }],
  ['invalid AAL2 AMR', { claims: { aal: 'aal2' } }],
  ['revoked provider session', {}, a => { a.live = false; }],
]) test(`owner bootstrap cannot write binding or audit for ${label} identity`, async () => {
  const a = await ownerCandidate(options); mutate?.(a); assert.equal((await loginAs(a)).status, 401); noBootstrap(); assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 0);
});
test('failed owner password cannot create a binding or audit', async () => {
  const a = await ownerCandidate(); assert.equal((await loginAs(a, { password: 'synthetic-wrong-password' })).status, 401); noBootstrap();
});
test('owner bootstrap does not run from session status or protected reads before verified login', async () => {
  const a = await ownerCandidate(); assert.equal((await status(a)).status, 403); noBootstrap(); await rejectsStatus(auth.verifyIdentity(a.access), 403); noBootstrap();
});

async function additionalAdminCandidate(options = {}) {
  const a = await actor(crypto.randomUUID(), { mapping: false, local: false, ...options, employee: { role: 'employee', active: 0, user_id: null, ...options.employee } });
  f.env.UFS_SUPABASE_ADDITIONAL_ADMIN_SUB = a.claims.sub; f.env.UFS_SUPABASE_ADDITIONAL_ADMIN_EMPLOYEE_ID = a.employee.id;
  return a;
}
const noAdditionalBootstrap = a => {
  assert.equal(f.get('SELECT COUNT(*) n FROM employee_identities').n, 0); assert.equal(f.get('SELECT COUNT(*) n FROM audit').n, 0);
  assert.equal(f.get('SELECT role FROM employees WHERE id=?', a.employee.id).role, a.employee.role);
  assert.equal(f.get('SELECT active FROM employees WHERE id=?', a.employee.id).active, a.employee.active);
};

test('additional approved exact staff identity activates only that pending employee as admin, with one audit', async () => {
  const a = await additionalAdminCandidate(); f.employee('synthetic-existing-owner', { role: 'admin' }); f.employee('synthetic-other-staff', { active: 0 });
  const others = f.rows('SELECT * FROM employees WHERE id<>? ORDER BY id', a.employee.id), before = f.get('SELECT * FROM employees WHERE id=?', a.employee.id);
  const response = await loginAs(a); assert.equal(response.status, 200); const body = await bodyOf(response); assert.equal(body.authenticated, true);   assert.deepEqual(f.rows('SELECT * FROM employees WHERE id<>? ORDER BY id', a.employee.id), others);
  assert.deepEqual({ ...f.get('SELECT * FROM employees WHERE id=?', a.employee.id) }, { ...before, role: 'admin', active: 1 });
  const binding = f.get('SELECT * FROM employee_identities'); assert.equal(binding.subject, a.claims.sub); assert.equal(binding.issuer, auth.SUPABASE_ISSUER); assert.equal(binding.employee_id, a.employee.id); assert.equal(binding.enabled, 1);
  const audit = f.get('SELECT * FROM audit'); assert.equal(audit.target_id, a.employee.id); assert.equal(f.get('SELECT COUNT(*) n FROM audit').n, 1); assert.equal(f.get('SELECT COUNT(*) n FROM employees').n, 3);
  assert.equal((await auth.verifyIdentity(a.access)).employee.role, 'admin'); const elevated = await issue(a, { aal: 'aal2', amr: [{ method: 'password', timestamp: a.claims.iat }, { method: 'totp', timestamp: a.claims.iat }] }); assert.equal((await auth.verifyIdentity(elevated)).employee.role, 'admin');
  assert.equal((await loginAs(a)).status, 200); assert.equal(f.get('SELECT COUNT(*) n FROM audit').n, 1); assert.deepEqual(f.get('SELECT * FROM employee_identities'), binding);
});
test('concurrent additional-admin logins promote exactly once with one immutable binding and audit', async () => {
  const a = await additionalAdminCandidate(); const results = await Promise.all(Array.from({ length: 6 }, () => loginAs(a)));
  assert.ok(results.every(result => result.status === 200)); assert.equal(f.get('SELECT COUNT(*) n FROM employee_identities').n, 1); assert.equal(f.get('SELECT COUNT(*) n FROM audit').n, 1);
  assert.equal(f.get('SELECT role FROM employees WHERE id=?', a.employee.id).role, 'admin'); assert.equal(f.get('SELECT active FROM employees WHERE id=?', a.employee.id).active, 1);
});
test('additional-admin audit failure rolls back promotion, activation and identity insertion atomically', async () => {
  const a = await additionalAdminCandidate();
  f.sqlite.exec("CREATE TRIGGER synthetic_reject_auth_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT, 'Synthetic audit storage failure'); END;");
  const response = await loginAs(a); assert.equal(response.status, 503); noAdditionalBootstrap(a); assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 0); assert.equal(response.headers.getSetCookie().some(value => !value.includes('Max-Age=0')), false);
});
for (const [label, configure] of [
  ['missing subject', () => { delete f.env.UFS_SUPABASE_ADDITIONAL_ADMIN_SUB; }],
  ['missing target', () => { delete f.env.UFS_SUPABASE_ADDITIONAL_ADMIN_EMPLOYEE_ID; }],
  ['different subject', () => { f.env.UFS_SUPABASE_ADDITIONAL_ADMIN_SUB = crypto.randomUUID(); }],
  ['unmatched target identifier', () => { f.env.UFS_SUPABASE_ADDITIONAL_ADMIN_EMPLOYEE_ID = 'synthetic-invalid-target'; }],
  ['nonexistent target', () => { f.env.UFS_SUPABASE_ADDITIONAL_ADMIN_EMPLOYEE_ID = crypto.randomUUID(); }],
]) test(`additional-admin bootstrap denies ${label} without changing staff`, async () => {
  const a = await additionalAdminCandidate(); configure(); assert.equal((await loginAs(a)).status, 403); noAdditionalBootstrap(a); assert.equal(f.get('SELECT COUNT(*) n FROM employees').n, 1);
});
for (const [label, employee] of [
  ['already active', { active: 1 }], ['demo', { demo: 1 }], ['legacy identity already bound', { user_id: 'synthetic-legacy-identity' }],
  ['already admin', { role: 'admin' }], ['manager', { role: 'manager' }], ['HR manager', { role: 'hr_manager' }], ['hiring manager', { role: 'hiring_manager' }], ['unknown role', { role: 'super_admin' }],
]) test(`additional-admin bootstrap requires exact pending-employee state: ${label}`, async () => {
  const a = await additionalAdminCandidate({ employee }); assert.equal((await loginAs(a)).status, 403); noAdditionalBootstrap(a);
});
for (const state of ['inactive', 'terminated', 'archived']) {
  test(`additional-admin bootstrap refuses former profile ${state}`, async () => {
    const a = await additionalAdminCandidate(); f.run('INSERT INTO employee_profiles (employee_id,employment_status,updated_at) VALUES (?,?,?)', a.employee.id, ` ${state.toUpperCase()} `, '2026-01-01'); assert.equal((await loginAs(a)).status, 403); noAdditionalBootstrap(a);
  });
  test(`additional-admin bootstrap refuses imported former ${state}`, async () => {
    const a = await additionalAdminCandidate(); f.run('INSERT INTO source_employee_links (source_id,employee_id,source_email,source_status,imported_at) VALUES (?,?,?,?,?)', 'synthetic-former-source', a.employee.id, a.employee.email, ` ${state.toUpperCase()} `, '2026-01-01'); assert.equal((await loginAs(a)).status, 403); noAdditionalBootstrap(a);
  });
}
for (const enabled of [0, 1]) test(`existing exact additional-admin mapping (enabled=${enabled}) prevents implicit promotion or reactivation`, async () => {
  const a = await additionalAdminCandidate(); f.run('INSERT INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) VALUES (?,?,?,?,?,?,?)', crypto.randomUUID(), auth.SUPABASE_ISSUER, a.claims.sub, a.employee.id, enabled, '2026-01-01', 'synthetic-prior-approver');
  const before = f.get('SELECT * FROM employee_identities'); assert.equal((await loginAs(a)).status, 403); assert.deepEqual(f.get('SELECT * FROM employee_identities'), before); assert.equal(f.get('SELECT COUNT(*) n FROM audit').n, 0);
  assert.equal(f.get('SELECT role FROM employees WHERE id=?', a.employee.id).role, 'employee'); assert.equal(f.get('SELECT active FROM employees WHERE id=?', a.employee.id).active, 0);
});
test('additional-admin target bound to a conflicting subject cannot be reassigned or promoted', async () => {
  const a = await additionalAdminCandidate(); f.run('INSERT INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) VALUES (?,?,?,?,?,?,?)', crypto.randomUUID(), auth.SUPABASE_ISSUER, crypto.randomUUID(), a.employee.id, 1, '2026-01-01', 'synthetic-prior-approver');
  const before = f.get('SELECT * FROM employee_identities'); assert.equal((await loginAs(a)).status, 403); assert.deepEqual(f.get('SELECT * FROM employee_identities'), before); assert.equal(f.get('SELECT COUNT(*) n FROM audit').n, 0);
  assert.equal(f.get('SELECT role FROM employees WHERE id=?', a.employee.id).role, 'employee'); assert.equal(f.get('SELECT active FROM employees WHERE id=?', a.employee.id).active, 0);
});
test('additional-admin subject bound elsewhere retains its existing role and leaves approved target untouched', async () => {
  const a = await additionalAdminCandidate(); const existing = f.employee('existing-synthetic-mapping', { user_id: null });
  f.run('INSERT INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) VALUES (?,?,?,?,?,?,?)', crypto.randomUUID(), auth.SUPABASE_ISSUER, a.claims.sub, existing.id, 1, '2026-01-01', 'synthetic-prior-approver');
  const before = f.rows('SELECT * FROM employees ORDER BY id'); assert.equal((await loginAs(a)).status, 200); assert.deepEqual(f.rows('SELECT * FROM employees ORDER BY id'), before); assert.equal((await auth.verifyIdentity(a.access)).employee.id, existing.id); assert.equal(f.get('SELECT COUNT(*) n FROM audit').n, 0);
});
test('same email with a different subject cannot activate or promote approved additional staff', async () => {
  const a = await additionalAdminCandidate(); const wrong = await actor('synthetic-same-email', { mapping: false, local: false }); wrong.user.email = a.user.email; transport.users.set(a.user.email, wrong);
  assert.equal((await loginAs(wrong)).status, 403); noAdditionalBootstrap(a); assert.equal(f.get('SELECT role FROM employees WHERE id=?', wrong.employee.id).role, 'employee');
});
test('future additional-admin demotion is never reversed by unchanged bootstrap settings', async () => {
  const a = await additionalAdminCandidate(); assert.equal((await loginAs(a)).status, 200); f.run("UPDATE employees SET role='employee' WHERE id=?", a.employee.id);
  const response = await loginAs(a); assert.equal(response.status, 200); assert.equal((await auth.verifyIdentity(a.access)).employee.role, 'employee'); assert.equal(f.get('SELECT COUNT(*) n FROM audit').n, 1);
});
test('future additional-admin disablement is never reversed by unchanged bootstrap settings', async () => {
  const a = await additionalAdminCandidate(); assert.equal((await loginAs(a)).status, 200); f.run('UPDATE employees SET active=0 WHERE id=?', a.employee.id);
  assert.equal((await loginAs(a)).status, 403); assert.equal(f.get('SELECT active FROM employees WHERE id=?', a.employee.id).active, 0); assert.equal(f.get('SELECT COUNT(*) n FROM audit').n, 1);
});
for (const [label, options, mutate] of [
  ['unconfirmed', { user: { email_confirmed_at: null } }], ['banned', { user: { banned_until: new Date(Date.now() + 86400000).toISOString() } }],
  ['deleted', { user: { deleted_at: '2026-01-01T00:00:00Z' } }], ['invalid AAL2 AMR', { claims: { aal: 'aal2' } }], ['revoked provider session', {}, a => { a.live = false; }],
]) test(`additional-admin rejected ${label} identity cannot mutate access`, async () => {
  const a = await additionalAdminCandidate(options); mutate?.(a); assert.equal((await loginAs(a)).status, 401); noAdditionalBootstrap(a);
});
test('additional-admin bootstrap cannot run from status or protected reads', async () => {
  const a = await additionalAdminCandidate(); assert.equal((await status(a)).status, 403); noAdditionalBootstrap(a); await rejectsStatus(auth.verifyIdentity(a.access), 403); noAdditionalBootstrap(a);
});

// Separately approved public pilot: two exact existing subjects only. These
// synthetic fixtures do not create the separately requested real test accounts.
describe('dedicated public pilot scope', () => {
let publicOriginalNow;
beforeEach(() => { publicOriginalNow = Date.now; Date.now = () => Date.UTC(2026, 9, 12, 2, 30, 0); });
afterEach(() => { Date.now = publicOriginalNow; });
function publicPilotWindow(a, kind = 'owner', duration = 3_600_000) {
  f.env.UFS_AUTH_MODE = 'standalone';
  f.env.UFS_AUTH_PUBLIC_PILOT_UNTIL = new Date(Date.now() + duration).toISOString();
  f.env.UFS_SUPABASE_OWNER_SUB = kind === 'owner' ? a.claims.sub : crypto.randomUUID();
  f.env.UFS_SUPABASE_ADDITIONAL_ADMIN_SUB = kind === 'additional' ? a.claims.sub : crypto.randomUUID();
}
for (const kind of ['owner', 'additional']) test(`public two-account pilot: exact ${kind} gets AAL1 login, session and server admin access`, async () => {
  const factors = [{ id: 'synthetic-retained-totp', factor_type: 'totp', status: 'verified', friendly_name: 'Synthetic retained authenticator' }];
  const a = await actor(`public-${kind}`, { employee: { role: 'admin' }, local: false, user: { factors: structuredClone(factors) } }); publicPilotWindow(a, kind);
  assert.equal(auth.publicPilotEnabled(), true); assert.equal(auth.standaloneConfigured(), true); assert.equal(auth.approvedPilotSubject(a.claims.sub), true);   const response = await loginAs(a); assert.equal(response.status, 200); assert.deepEqual(await bodyOf(response), { ok: true, enabled: true, authenticated: true });
  assert.equal(response.headers.getSetCookie().length, 2); assert.equal((await auth.verifyIdentity(a.access)).employee.role, 'admin'); assert.equal((await bodyOf(await status(a))).authenticated, true);
  const target = f.employee(`public-synthetic-target-${kind}`);
  const result = await asCookies(a, () => action.POST(new Request(`${origin}/api/action`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'updateAccess', employeeId: target.id, role: 'employee', active: false, managerId: null }) })));
  assert.equal(result.status, 200); assert.equal(f.get('SELECT active FROM employees WHERE id=?', target.id).active, 0);
  assert.deepEqual(a.user.factors, factors); assert.equal(transport.calls.some(call => call.path.includes('/factors') || call.method === 'DELETE'), false);
});
for (const role of roles) for (const aal of ['aal1', 'aal2']) test(`public pilot refuses unrelated mapped ${role} at ${aal}, including login and session reads`, async () => {
  const a = await actor(`outside-${role}-${aal}`, { employee: { role }, local: false, claims: { aal, amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }, ...(aal === 'aal2' ? [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] : [])] } });
  publicPilotWindow({ claims: { sub: crypto.randomUUID() } });
  const before = f.get('SELECT * FROM employee_identities'); assert.equal(auth.approvedPilotSubject(a.claims.sub), false);
  await rejectsStatus(auth.verifyIdentity(a.access, { registerSession: true }), 403); assert.equal((await status(a)).status, 403); assert.equal((await loginAs(a)).status, 403);
  assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 0); assert.deepEqual(f.get('SELECT * FROM employee_identities'), before); assert.equal(f.get('SELECT role FROM employees WHERE id=?', a.employee.id).role, role);
  assert.equal(transport.calls.some(call => call.path.startsWith('/rest/')), false);
});
for (const kind of ['owner', 'additional']) for (const bad of ['missing', 'invalid', 'whitespace', 'different']) test(`public pilot ${kind} UUID ${bad} cannot authorize that account`, async () => {
  const a = await actor(`bad-public-${kind}-${bad}`, { employee: { role: 'admin' }, claims: { aal: 'aal2', amr: [{ method: 'password', timestamp: 1 }, { method: 'totp', timestamp: 1 }] } }); publicPilotWindow(a, kind);
  const key = kind === 'owner' ? 'UFS_SUPABASE_OWNER_SUB' : 'UFS_SUPABASE_ADDITIONAL_ADMIN_SUB';
  if (bad === 'missing') delete f.env[key]; else f.env[key] = bad === 'invalid' ? 'synthetic-not-a-uuid' : bad === 'whitespace' ? ` ${a.claims.sub} ` : crypto.randomUUID();
  assert.equal(auth.approvedPilotSubject(a.claims.sub), false); await rejectsStatus(auth.verifyIdentity(a.access), 403);
});
test('public pilot with no configured subject UUIDs denies all existing mapped accounts', async () => {
  const a = await actor('no-public-subjects', { employee: { role: 'admin' } }); publicPilotWindow(a); delete f.env.UFS_SUPABASE_OWNER_SUB; delete f.env.UFS_SUPABASE_ADDITIONAL_ADMIN_SUB;
  await rejectsStatus(auth.verifyIdentity(a.access), 403); assert.equal(auth.approvedPilotSubject(a.claims.sub), false);
});
for (const [label, value] of [
  ['empty', ''], ['arbitrary string', 'synthetic-invalid'], ['invalid month', '2026-13-01T00:00:00.000Z'], ['impossible calendar date', '2026-02-29T00:00:00.000Z'],
  ['non-UTC offset', '2026-10-13T01:35:00.000+00:00'], ['missing milliseconds', '2026-10-13T01:35:00Z'], ['whitespace', ' 2026-10-13T01:35:00.000Z '],
]) test(`malformed public pilot expiry (${label}) disables auth instead of widening access`, async () => {
  const a = await actor('public-malformed', { employee: { role: 'admin' } }); publicPilotWindow(a); f.env.UFS_AUTH_PUBLIC_PILOT_UNTIL = value;
  assert.equal(auth.publicPilotEnabled(), true); assert.equal(auth.standaloneConfigured(), false);   assert.deepEqual(await bodyOf(await status(a)), { enabled: false, authenticated: false }); assert.equal((await loginAs(a)).status, 503); await rejectsStatus(auth.verifyIdentity(a.access), 503); assert.equal(transport.calls.length, 0);
});
test('standalone without public flag fails closed', async () => {
  const a = await actor('ordinary-standalone-admin', { employee: { role: 'admin' } }); f.env.UFS_AUTH_MODE = 'standalone'; delete f.env.UFS_AUTH_PUBLIC_PILOT_UNTIL;
  assert.equal(auth.publicPilotEnabled(), true); assert.equal(auth.standaloneConfigured(), false); await rejectsStatus(auth.verifyIdentity(a.access), 503); assert.deepEqual(await bodyOf(await status(a)), { enabled: false, authenticated: false });
  const other = await actor('default-standalone-employee'); await rejectsStatus(auth.verifyIdentity(other.access), 503); assert.equal(transport.calls.length, 0);
});
test('public pilot over-24-hour expiry retains the two-subject scope and needs no authenticator', async () => {
  Date.now = () => Date.parse('2026-10-13T01:35:00.000Z') - 86400001;
  const a = await actor('public-too-long', { employee: { role: 'admin' } }); publicPilotWindow(a, 'owner', 86400001);
  assert.equal(auth.standaloneConfigured(), true); assert.equal((await auth.verifyIdentity(a.access)).employee.id, a.employee.id);
  const other = await actor('public-too-long-other', { employee: { role: 'admin' }, claims: { aal: 'aal2', amr: [{ method: 'password', timestamp: 1 }, { method: 'totp', timestamp: 1 }] } }); await rejectsStatus(auth.verifyIdentity(other.access), 403);
});
for (const kind of ['owner', 'additional']) test(`public pilot expiry leaves ${kind} password sign-in unchanged while unrelated AAL2 subjects remain excluded`, async () => {
  const a = await actor(`public-expiring-${kind}`, { employee: { role: 'admin' } }); publicPilotWindow(a, kind, 60_000);
  const other = await actor(`public-expiring-other-${kind}`, { employee: { role: 'admin' }, claims: { aal: 'aal2', amr: [{ method: 'password', timestamp: 1 }, { method: 'totp', timestamp: 1 }] } });
  assert.equal((await auth.verifyIdentity(a.access)).employee.role, 'admin'); const expiry = Date.parse(f.env.UFS_AUTH_PUBLIC_PILOT_UNTIL), originalNow = Date.now;
  try {
    Date.now = () => expiry; assert.equal(auth.publicPilotEnabled(), true); assert.equal(auth.standaloneConfigured(), true);     assert.equal((await auth.verifyIdentity(a.access)).employee.id, a.employee.id); await rejectsStatus(auth.verifyIdentity(other.access), 403);
  } finally { Date.now = originalNow; }
});
test('public standalone mode never accepts legacy authenticated-user headers without a valid cookie', async () => {
  const a = await actor('public-cookie-owner', { employee: { role: 'admin' } }); publicPilotWindow(a);
  const legacy = f.employee('legacy-public-admin', { role: 'admin', email: 'owner@example.test' });
  await rejectsStatus(asUser(legacy, () => server.currentEmployee()), 401); assert.equal(transport.calls.length, 0);
  await rejectsStatus(globalThis.__ufsSecurityTest.context.run(new Headers({ cookie: `${auth.ACCESS_COOKIE}=invalid-jwt`, 'oai-authenticated-user-id': legacy.user_id, 'oai-authenticated-user-email': legacy.email }), () => server.currentEmployee()), 401);
  const forbidden = await actor('public-forbidden-cookie', { employee: { role: 'admin' }, claims: { aal: 'aal2', amr: [{ method: 'password', timestamp: 1 }, { method: 'totp', timestamp: 1 }] } });
  await rejectsStatus(asCookies(forbidden, () => server.currentEmployee(), { 'oai-authenticated-user-id': legacy.user_id, 'oai-authenticated-user-email': legacy.email }), 403);
});
for (const [label, options, mutate, expected] of [
  ['unbound identity', { mapping: false }, null, 403], ['disabled binding', { enabled: 0 }, null, 403], ['wrong immutable issuer binding', { issuer: 'https://synthetic.invalid/auth/v1' }, null, 403],
  ['disabled employee', { employee: { active: 0 } }, null, 403], ['demo employee', { employee: { demo: 1 } }, null, 403],
  ['former employee', {}, a => f.run('INSERT INTO employee_profiles (employee_id,employment_status,updated_at) VALUES (?,?,?)', a.employee.id, 'terminated', '2026-01-01'), 403],
  ['unconfirmed user', { user: { email_confirmed_at: null } }, null, 401], ['deleted user', { user: { deleted_at: '2026-01-01T00:00:00Z' } }, null, 401],
  ['banned user', { user: { banned_until: new Date(Date.now() + 86400000).toISOString() } }, null, 401],
  ['revoked provider session', {}, a => { a.live = false; }, 401], ['unavailable provider user', {}, a => { a.userError = true; }, 401], ['self-session RPC unavailable', {}, () => { transport.failRpc = true; }, 503],
  ['missing local session', { local: false }, null, 401], ['local revocation', {}, a => f.run('UPDATE auth_sessions SET revoked_at=1 WHERE session_id=?', a.claims.session_id), 401],
  ['idle expiry', {}, a => f.run('UPDATE auth_sessions SET last_seen=? WHERE session_id=?', Math.floor(Date.now() / 1000) - 1800, a.claims.session_id), 401],
  ['absolute expiry', {}, a => f.run('UPDATE auth_sessions SET created_at=? WHERE session_id=?', Math.floor(Date.now() / 1000) - 43200, a.claims.session_id), 401],
]) test(`public pilot allowlist never bypasses ${label}`, async () => {
  const a = await actor('public-eligibility', { ...options, employee: { role: 'admin', ...options.employee } }); publicPilotWindow(a); mutate?.(a);
  assert.equal(auth.approvedPilotSubject(a.claims.sub), true); await rejectsStatus(auth.verifyIdentity(a.access), expected); assert.equal(transport.calls.some(call => call.path.includes('/factors') || call.method === 'DELETE'), false);
});
for (const [label, claims] of [
  ['wrong issuer', { iss: 'https://synthetic.invalid/auth/v1' }], ['wrong audience', { aud: 'anon' }], ['anonymous claims', { is_anonymous: true }],
  ['non-password AMR', { amr: [{ method: 'otp', timestamp: 1 }] }], ['AAL2 missing TOTP proof', { aal: 'aal2' }], ['expired claims', { exp: 1 }],
]) test(`public pilot still rejects ${label} for an approved subject`, async () => {
  const a = await actor('public-claims-denied', { employee: { role: 'admin' }, claims }); publicPilotWindow(a); await rejectsStatus(auth.verifyIdentity(a.access), 401);
});
test('public pilot allowlist never bypasses JWT signature verification', async () => {
  const a = await actor('public-signed-only', { employee: { role: 'admin' } }); publicPilotWindow(a);
  const [header, payload, signature] = a.access.split('.'), bytes = Buffer.from(signature, 'base64url'); bytes[0] ^= 1; await rejectsStatus(auth.verifyIdentity(`${header}.${payload}.${bytes.toString('base64url')}`), 401);
  assert.equal(transport.calls.some(call => call.path === '/auth/v1/user' || call.path.startsWith('/rest/')), false);
});
test('public pilot refresh works only for the exact approved subject and does not expand the allowlist', async () => {
  const a = await actor('public-refresh-owner', { employee: { role: 'admin' } }); publicPilotWindow(a);
  let response = await refresh.POST(reqFor('refresh', a)); assert.equal(response.status, 200); assert.equal((await bodyOf(response)).authenticated, true);
  const other = await actor('public-refresh-outsider', { employee: { role: 'employee' } }); response = await refresh.POST(reqFor('refresh', other)); assert.equal(response.status, 403); assert.equal(response.headers.getSetCookie().length, 0);
});
test('public pilot logout locally revokes approved AAL1 sessions even during provider outage', async () => {
  const a = await actor('public-logout-owner', { employee: { role: 'admin' }, local: false }); publicPilotWindow(a); assert.equal((await loginAs(a)).status, 200);
  transport.failUser = true; const response = await logout.POST(reqFor('logout', a)); assert.equal(response.status, 200); assert.equal(response.headers.getSetCookie().length, 2); transport.failUser = false;
  assert.ok(f.get('SELECT revoked_at FROM auth_sessions WHERE session_id=?', a.claims.session_id).revoked_at); await rejectsStatus(auth.verifyIdentity(a.access), 401);
});

for (const mode of [undefined, '', 'pilot', 'public', 'STANDALONE']) test(`public flag with wrong mode ${mode ?? 'unset'} disables auth and prevents legacy-header fallback`, async () => {
  const a = await actor('wrong-public-mode', { employee: { role: 'admin' } }); publicPilotWindow(a); f.env.UFS_AUTH_MODE = mode;
  assert.equal(auth.publicPilotEnabled(), true); assert.equal(auth.standaloneConfigured(), false);   await rejectsStatus(auth.verifyIdentity(a.access), 503); assert.equal((await loginAs(a)).status, 503);
  const legacy = f.employee('wrong-mode-legacy', { role: 'admin', email: 'owner@example.test' }); await rejectsStatus(asUser(legacy, () => server.currentEmployee()), 401);
  assert.equal(transport.calls.length, 0); assert.deepEqual(await bodyOf(await status(a)), { enabled: false, authenticated: false });
});
test('public deadline can end early but cannot exceed the fixed approved ceiling by even one millisecond', async () => {
  const a = await actor('fixed-public-deadline', { employee: { role: 'admin' } }); publicPilotWindow(a);
  for (const until of ['2026-10-13T01:34:59.999Z', '2026-10-13T01:35:00.000Z']) { f.env.UFS_AUTH_PUBLIC_PILOT_UNTIL = until; assert.equal(auth.standaloneConfigured(), true); }
  for (const until of ['2026-10-13T01:35:00.001Z', '2026-10-14T01:35:00.000Z']) { f.env.UFS_AUTH_PUBLIC_PILOT_UNTIL = until; assert.equal(auth.standaloneConfigured(), false); await rejectsStatus(auth.verifyIdentity(a.access), 503); }
});
});


// These identities, signatures and provider responses exist only in memory.
// No real QA account or password is created by this suite.
function allowTestActor(a){
 Object.assign(f.env,{UFS_QA_TEST_ACCESS:'enabled',UFS_QA_EMPLOYEE_SUB:a.employee.role==='employee'?a.user.id:crypto.randomUUID(),UFS_QA_HR_MANAGER_SUB:a.employee.role==='hr_manager'?a.user.id:crypto.randomUUID()});
}
for(const role of ['employee','hr_manager']){
 test(`QA ${role} is denied by default even with genuine-format signed provider claims and valid mapping`,async()=>{
  const a=await actor('qa',{employee:{role,data_scope:'qa-bots-v1'}});
  await rejectsStatus(auth.verifyIdentity(a.access),403);
 });
 test(`QA ${role} requires exact subject, immutable test binding and exact role`,async()=>{
  const a=await actor('qa',{employee:{role,data_scope:'qa-bots-v1'}});allowTestActor(a);
  assert.equal((await auth.verifyIdentity(a.access)).employee.id,a.employee.id);
    const b=await actor('qa-other',{employee:{role,data_scope:'qa-bots-v1'}});
  await rejectsStatus(auth.verifyIdentity(b.access),403);
 });
 test(`approved QA ${role} subject cannot bind live data`,async()=>{
  const a=await actor('wrong-scope',{employee:{role}});allowTestActor(a);
  await rejectsStatus(auth.verifyIdentity(a.access),403);
 });
 test(`QA ${role} never receives the real administrator password-only exception`,async()=>{
  const a=await actor('qa',{employee:{role,data_scope:'qa-bots-v1'}});allowTestActor(a);
      assert.equal((await auth.verifyIdentity(a.access)).employee.id,a.employee.id);
 });
 test(`QA ${role} cannot use a legacy linked identity`,async()=>{
  const a=await actor('qa',{employee:{role,data_scope:'qa-bots-v1',user_id:'synthetic-old-link'}});allowTestActor(a);
  await rejectsStatus(auth.verifyIdentity(a.access),403);
 });
}
for(const [name,configure]of [
 ['flag missing',()=>{delete f.env.UFS_QA_TEST_ACCESS}],
 ['flag malformed',()=>{f.env.UFS_QA_TEST_ACCESS='true'}],
 ['employee UUID missing',()=>{delete f.env.UFS_QA_EMPLOYEE_SUB}],
 ['HR UUID missing',()=>{delete f.env.UFS_QA_HR_MANAGER_SUB}],
 ['employee UUID malformed',()=>{f.env.UFS_QA_EMPLOYEE_SUB='not-a-uuid'}],
 ['HR UUID malformed',()=>{f.env.UFS_QA_HR_MANAGER_SUB='not-a-uuid'}],
 ['duplicate UUID',()=>{f.env.UFS_QA_HR_MANAGER_SUB=f.env.UFS_QA_EMPLOYEE_SUB}],
 ['real owner collision',()=>{f.env.UFS_SUPABASE_OWNER_SUB=f.env.UFS_QA_EMPLOYEE_SUB}],
 ['real additional admin collision',()=>{f.env.UFS_SUPABASE_ADDITIONAL_ADMIN_SUB=f.env.UFS_QA_HR_MANAGER_SUB}],
])test(`QA configuration fails closed: ${name}`,async()=>{
 const a=await actor('qa',{employee:{data_scope:'qa-bots-v1'}});allowTestActor(a);configure();
 await rejectsStatus(auth.verifyIdentity(a.access),403);
});
test('QA exact role mismatch is rejected before app session registration',async()=>{
 const a=await actor('qa',{employee:{role:'hr_manager',data_scope:'qa-bots-v1'},local:false});
 Object.assign(f.env,{UFS_QA_TEST_ACCESS:'enabled',UFS_QA_EMPLOYEE_SUB:a.user.id,UFS_QA_HR_MANAGER_SUB:crypto.randomUUID()});
 await rejectsStatus(auth.verifyIdentity(a.access,{ registerSession: true }),403);
 assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n,0);
});
test('QA HR login uses the real SDK authorization pipeline without an authenticator',async()=>{
 const a=await actor('qa',{employee:{role:'hr_manager',data_scope:'qa-bots-v1'},local:false});allowTestActor(a);
 const entered=await bodyOf(await loginAs(a));assert.equal(entered.authenticated,true);assert.equal(entered.testMode,true);
 const upgraded=await issue(a,{aal:'aal2',amr:[{method:'password',timestamp:a.claims.iat},{method:'totp',timestamp:a.claims.iat}]});
 assert.equal((await auth.verifyIdentity(upgraded)).employee.id,a.employee.id);
 delete f.env.UFS_QA_TEST_ACCESS;await rejectsStatus(auth.verifyIdentity(upgraded),403);
});

// Ongoing approval for one QA-only account. These are synthetic provider sessions,
// never credentials or live logins. Historical exception ceilings stay unchanged.
describe('approved exact QA HR password-only policy',()=>{
 const subject='1ce902e2-5c60-40fd-96b3-1ae14478f5e7',profile='qa-bots-v1:hr-manager',email='hrtest@unitedffs.com',expired='2026-10-13T01:35:00.000Z';
 let originalNow;
 beforeEach(()=>{originalNow=Date.now;Date.now=()=>Date.parse('2026-10-13T06:00:00.000Z')});
 afterEach(()=>{Date.now=originalNow});
 async function qa(options={}){
  const a=await actor(options.id??profile,{...options,employee:{role:'hr_manager',data_scope:'qa-bots-v1',email,...options.employee},user:{id:subject,email,...options.user},claims:{sub:subject,...options.claims},subject:options.subject??subject});
  allowTestActor(a);Object.assign(f.env,{UFS_AUTH_MODE:'standalone',UFS_AUTH_PUBLIC_PILOT_UNTIL:expired});return a;
 }
 test('only the approved account can log in and use HR state with a password after the old deadline',async()=>{
  const a=await qa({local:false}),r=await loginAs(a),body=await bodyOf(r);
  assert.equal(r.status,200);assert.equal(body.authenticated,true);assert.equal(body.testMode,true);
    assert.equal((await auth.verifyIdentity(a.access)).employee.id,profile);
  const stateRoute=await import('../app/api/state/route.ts');assert.equal((await asCookies(a,()=>stateRoute.GET())).status,200);
 });
 test('exact QA identity cannot access a live binding even with the new flag',async()=>{
  const a=await qa({employee:{data_scope:'live'}});await rejectsStatus(auth.verifyIdentity(a.access),403);
 });
 for(const change of ['missing','wrong-subject','owner-collision','admin-collision'])test(`QA access configuration remains mandatory: ${change}`,async()=>{
  const a=await qa();if(change==='missing')delete f.env.UFS_QA_TEST_ACCESS;if(change==='wrong-subject')f.env.UFS_QA_HR_MANAGER_SUB=crypto.randomUUID();if(change==='owner-collision')f.env.UFS_SUPABASE_OWNER_SUB=subject;if(change==='admin-collision')f.env.UFS_SUPABASE_ADDITIONAL_ADMIN_SUB=subject;
  await rejectsStatus(auth.verifyIdentity(a.access),403);
 });
 test('password proof and real password validation remain required',async()=>{
  const a=await qa();await rejectsStatus(auth.verifyIdentity(await issue(a,{amr:[{method:'otp',timestamp:a.claims.iat}]})),401);assert.equal((await loginAs(a,{password:'wrong-synthetic-value'})).status,401);
 });
 test('fresh provider identity, provider session revocation and RPC availability remain required',async()=>{
  const a=await qa();a.userError=true;await rejectsStatus(auth.verifyIdentity(a.access),401);a.userError=false;a.live=false;await rejectsStatus(auth.verifyIdentity(a.access),401);a.live=true;transport.failRpc=true;await rejectsStatus(auth.verifyIdentity(a.access),503);
 });
 test('local revocation and idle expiry remain effective',async()=>{
  const a=await qa();f.run('UPDATE auth_sessions SET last_seen=? WHERE session_id=?',Math.floor(Date.now()/1000)-1801,a.claims.session_id);await rejectsStatus(auth.verifyIdentity(a.access),401);
  f.run('UPDATE auth_sessions SET last_seen=?,revoked_at=? WHERE session_id=?',Math.floor(Date.now()/1000),Math.floor(Date.now()/1000),a.claims.session_id);await rejectsStatus(auth.verifyIdentity(a.access),401);
 });
 for(const [label,options] of [['disabled mapping',{enabled:0}],['unmapped identity',{mapping:false}],['wrong issuer',{issuer:'https://other.example.test/auth/v1'}],['inactive employee',{employee:{active:0}}],['demo employee',{employee:{demo:1}}]])test(`new QA policy preserves ${label} denial`,async()=>{
  const a=await qa(options);await rejectsStatus(auth.verifyIdentity(a.access),403);
 });
 test('terminated employment cannot regain access using the password-only flag',async()=>{
  const a=await qa();f.run('INSERT INTO employee_profiles (employee_id,data_scope,employment_status,updated_at) VALUES (?,?,?,?)',profile,'qa-bots-v1','Terminated','2026-10-13');await rejectsStatus(auth.verifyIdentity(a.access),403);
 });
 test('CSRF remains enforced and cannot write even with the QA exception',async()=>{
  const a=await qa();const r=await asCookies(a,()=>action.POST(new Request(`${origin}/api/action`,{method:'POST',headers:{origin:'https://other.example.test','content-type':'application/json'},body:JSON.stringify({action:'addEvent',title:'Forged event',date:'2026-12-01'})})));assert.equal(r.status,403);assert.equal(f.get('SELECT COUNT(*) n FROM events').n,0);
  assert.equal((await refresh.POST(reqFor('refresh',a,{}, {origin:'https://other.example.test'}))).status,403);
 });
 test('refresh remains password-authenticated, QA scoped and password-only for the exact approved account',async()=>{
  const a=await qa(),r=await refresh.POST(reqFor('refresh',a)),body=await bodyOf(r);assert.equal(r.status,200);assert.equal(body.authenticated,true);assert.equal(body.testMode,true);
 });
 test('existing factors and provider password are never modified',async()=>{
  const factors=[{id:'synthetic-qa-existing-factor',factor_type:'totp',status:'verified'}],a=await qa({user:{factors}});
  assert.equal((await loginAs(a)).status,200);assert.deepEqual((await auth.verifyIdentity(a.access)).user.factors,factors);
  assert.equal(transport.calls.some(c=>c.path.includes('/factors')||(c.path==='/auth/v1/user'&&c.method!=='GET')),false);
 });
});

// Password-only policy requested by the owner, October 15, 2026.
for(const role of roles)test(`password-only policy: ${role} signs in without an authenticator`,async()=>{
 const a=await actor('password-only',{employee:{role},user:{factors:[{id:'existing-factor',factor_type:'totp',status:'verified'}]}});
  const response=await loginAs(a),body=await bodyOf(response);assert.equal(response.status,200);assert.equal(body.authenticated,true);assert.equal((await status(a)).status,200);assert.equal((await auth.verifyIdentity(a.access)).employee.role,role);
 assert.equal((await refresh.POST(reqFor('refresh',a))).status,200);
 assert.equal((await loginAs(a,{password:'wrong-password'})).status,401);
 
 assert.equal(transport.calls.some(c=>c.path.includes('/factors')),false);
 a.live=false;await rejectsStatus(auth.verifyIdentity(a.access),401);
});

test('authenticator routes and QR helper were removed, not merely disabled', async () => {
 for (const path of ['../app/api/auth/mfa/route.ts', '../app/api/auth/mfa/enroll/route.ts', '../lib/mfa-qr.ts']) await assert.rejects(import(path));
 for (const name of ['requiresMfa', 'temporaryPasswordOnly', 'temporaryQaPasswordOnly', 'approvedQaHrPasswordOnly']) assert.equal(name in auth, false);
});
