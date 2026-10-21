// Password-recovery integration/security tests. Production routes and the pinned
// Supabase SDK run unchanged against SQLite and a deny-by-default HTTP transport.
// Every identity, password, token, email and response here is synthetic. No real
// provider request or email is sent. These tests do not establish deployed SMTP,
// email-template, allowlist, token-expiry or global-revocation configuration.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './harness.mjs';

const auth = await import('../lib/standalone-auth.ts');
const recovery = await import('../lib/password-recovery.ts');
const forgot = await import('../app/api/auth/forgot-password/route.ts');
const reset = await import('../app/api/auth/reset-password/route.ts');
const sessionRoute = await import('../app/api/auth/session/route.ts');
const refreshRoute = await import('../app/api/auth/refresh/route.ts');
const server = await import('../lib/server.ts');
const { AppError } = await import('../lib/policy.ts');
const origins = ['http://localhost:5173', 'https://ufs-people.artman79.chatgpt.site'];
const origin = origins[0], password = 'Synthetic-reset-value-42!', ip = '192.0.2.71';
const notice = { ok: true, message: recovery.RESET_NOTICE };
const invalidLink = { error: 'This reset link is invalid, expired, or already used. Request a new link.' };
const envKeys = ['UFS_PASSWORD_RECOVERY', 'UFS_AUTH_MODE', 'UFS_SUPABASE_URL', 'UFS_SUPABASE_PUBLISHABLE_KEY', 'UFS_SUPABASE_SESSION_CHECK', 'UFS_AUTH_PUBLIC_PILOT_UNTIL', 'UFS_SUPABASE_OWNER_SUB', 'UFS_SUPABASE_ADDITIONAL_ADMIN_SUB', 'UFS_QA_TEST_ACCESS'];
const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', key.publicKey), kid: 'synthetic-recovery-es256', alg: 'ES256', use: 'sig' };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
let f, previousEnv, originalFetch, transport;
const now = () => Math.floor(Date.now() / 1000);
const json = (data, status = 200) => Response.json(data, { status });
const failure = (message = 'Synthetic provider refusal', status = 400) => json({ message, msg: message, code: 'otp_expired' }, status);
const request = (path, body = {}, headers = {}, base = origin) => new Request(`${base}/api/auth/${path}`, {
  method: 'POST', headers: { origin: base, 'content-type': 'application/json', 'cf-connecting-ip': ip, ...headers }, body: JSON.stringify(body),
});
const finish = (a, overrides = {}, headers = {}, base = origin) => reset.POST(request('reset-password', { token_hash: a.token, password, confirmPassword: password, ...overrides }, headers, base));
const ask = (email, body = {}, headers = {}, base = origin) => forgot.POST(request('forgot-password', { email, ...body }, headers, base));
const calls = (path, method) => transport.calls.filter(call => call.path === `/auth/v1/${path}` && (!method || call.method === method));
const snapshot = () => Object.fromEntries(['employees', 'employee_identities', 'auth_sessions', 'auth_session_tokens', 'auth_password_resets', 'audit'].map(table => [table, f.rows(`SELECT * FROM ${table} ORDER BY rowid`)]));
const rateSnapshot = () => f.rows('SELECT * FROM auth_rate_limits ORDER BY key');
function secureHeaders(response) {
  assert.ok(response.headers.get('cache-control')?.includes('no-store'));
  assert.ok(response.headers.get('cache-control')?.includes('private'));
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('vary'), 'Cookie');
}
async function bodyOf(response) { secureHeaders(response); return response.json(); }
function noCookies(response) { assert.deepEqual(response.headers.getSetCookie(), [], 'Recovery must not issue session cookies'); }
function clearedCookiesOnly(response) {
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  for (const [index, name] of [auth.ACCESS_COOKIE, auth.REFRESH_COOKIE].entries()) {
    assert.ok(cookies[index].startsWith(`${name}=;`));
    for (const attribute of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0']) assert.ok(cookies[index].includes(attribute));
    assert.equal(/domain=/i.test(cookies[index]), false);
  }
}
async function signedToken(claims) {
  const input = `${b64({ alg: 'ES256', typ: 'JWT', kid: jwk.kid })}.${b64(claims)}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, new TextEncoder().encode(input));
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}
async function actor(id = 'synthetic-employee', options = {}) {
  const employee = f.employee(id, { user_id: null, ...options.employee });
  const subject = crypto.randomUUID();
  const claims = { iss: auth.SUPABASE_ISSUER, aud: 'authenticated', role: 'authenticated', sub: subject, session_id: crypto.randomUUID(), iat: now(), exp: now() + 3600, is_anonymous: false, aal: 'aal1', amr: [{ method: 'otp', timestamp: now() }], ...options.claims };
  const a = {
    employee, claims, token: crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
    user: { id: subject, email: employee.email, email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', is_anonymous: false, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, ...options.user },
    refresh: `synthetic-recovery-refresh-${crypto.randomUUID()}`, consumed: false, expiresAt: now() + 3600, live: true,
  };
  a.access = await signedToken(claims);
  transport.tokens.set(a.access, a); transport.recoveries.set(a.token, a); transport.refreshes.set(a.refresh, a);
  if (options.mapping !== false) f.run('INSERT INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) VALUES (?,?,?,?,?,?,?)', crypto.randomUUID(), options.issuer ?? auth.SUPABASE_ISSUER, options.subject ?? subject, employee.id, options.enabled ?? 1, '2026-01-01T00:00:00Z', 'synthetic-test-only');
  return a;
}
async function existingSession(a, overrides = {}) {
  const claims = { ...a.claims, session_id: crypto.randomUUID(), amr: [{ method: 'password', timestamp: now() }] };
  const access = await signedToken(claims), refresh = `synthetic-existing-refresh-${crypto.randomUUID()}`;
  const existing = { ...a, claims, access, refresh, live: true };
  transport.tokens.set(access, existing); transport.refreshes.set(refresh, existing);
  const values = { session_id: claims.session_id, issuer: auth.SUPABASE_ISSUER, subject: a.user.id, employee_id: a.employee.id, created_at: now(), last_seen: now(), ...overrides };
  f.run(`INSERT INTO auth_sessions (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`, ...Object.values(values));
  return existing;
}
const sessionData = a => ({ access_token: a.access, refresh_token: a.refresh, expires_in: 3600, expires_at: now() + 3600, token_type: 'bearer', user: a.user });
const cookie = a => `${auth.ACCESS_COOKIE}=${a.access}; ${auth.REFRESH_COOKIE}=${a.refresh}`;
async function setRate(kind, label, value, attempts, window = Math.floor(now() / 900) * 900) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${kind}:${label}:${value}`));
  const hash = Buffer.from(digest).toString('hex');
  f.run('INSERT INTO auth_rate_limits (key,window_start,attempts) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,attempts=excluded.attempts', hash, window, attempts);
  return hash;
}
function installTransport() {
  const state = { calls: [], unexpected: [], tokens: new Map(), recoveries: new Map(), refreshes: new Map(), recoverError: false, verifyError: false, updateError: false, globalLogoutError: false, verifyResponse: null, beforeVerify: null, beforeUpdate: null };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    const method = init.method ?? (input instanceof Request ? input.method : 'GET');
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : null;
    const a = state.tokens.get(headers.get('authorization')?.replace(/^Bearer /, ''));
    const call = { url: url.href, path: url.pathname, method, headers, body, cache: init.cache };
    state.calls.push(call);
    if (url.origin !== auth.SUPABASE_URL) { state.unexpected.push(url.href); return failure('Unexpected synthetic destination'); }
    if (url.pathname === '/auth/v1/recover' && method === 'POST') return state.recoverError ? failure('Synthetic secret SMTP diagnostic') : json({});
    if (url.pathname === '/auth/v1/verify' && method === 'POST') {
      if (state.beforeVerify) await state.beforeVerify(call);
      const recipient = state.recoveries.get(body?.token_hash);
      if (body?.type !== 'recovery' || !recipient || recipient.consumed || recipient.expiresAt <= now() || state.verifyError) return failure();
      recipient.consumed = true;
      return json(state.verifyResponse ?? sessionData(recipient));
    }
    if (url.pathname === '/auth/v1/user' && method === 'PUT') {
      if (state.beforeUpdate) await state.beforeUpdate(call, a);
      if (!a || state.updateError) return failure('Synthetic provider password policy rejection');
      a.changedPassword = body.password;
      return json(a.user);
    }
    if (url.pathname === '/auth/v1/logout' && method === 'POST') {
      const scope = url.searchParams.get('scope');
      if (scope === 'global' && state.globalLogoutError) return failure('Synthetic global revocation failure', Number.isInteger(state.globalLogoutError) ? state.globalLogoutError : 400);
      for (const candidate of state.tokens.values()) if (candidate === a || (scope === 'global' && candidate.user.id === a?.user.id)) candidate.live = false;
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/auth/v1/.well-known/jwks.json' && method === 'GET') return json({ keys: [jwk] });
    if (url.pathname === '/auth/v1/user' && method === 'GET') return a ? json(a.user) : failure();
    if (url.pathname === '/rest/v1/rpc/ufs_session_is_active' && method === 'POST') return json(!!a?.live);
    if (url.pathname === '/auth/v1/token' && method === 'POST' && url.searchParams.get('grant_type') === 'refresh_token') {
      const old = state.refreshes.get(body?.refresh_token);
      return old?.live ? json(sessionData(old)) : failure();
    }
    state.unexpected.push(url.href); return failure('Unexpected synthetic request');
  };
  return state;
}
beforeEach(() => {
  f = fixture(); previousEnv = Object.fromEntries(envKeys.map(name => [name, f.env[name]]));
  for (const name of envKeys) delete f.env[name];
  Object.assign(f.env, { UFS_PASSWORD_RECOVERY: 'enabled', UFS_AUTH_MODE: 'pilot', UFS_SUPABASE_URL: auth.SUPABASE_URL, UFS_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic', UFS_SUPABASE_SESSION_CHECK: 'enabled' });
  originalFetch = globalThis.fetch; transport = installTransport();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of envKeys) if (previousEnv[name] === undefined) delete f.env[name]; else f.env[name] = previousEnv[name];
  f.close(); assert.deepEqual(transport.unexpected, [], 'All HTTP is synthetic and deny-by-default');
});

test('recovery routes expose POST only; reading a link cannot consume its token', () => {
  assert.equal(forgot.dynamic, 'force-dynamic'); assert.equal(reset.dynamic, 'force-dynamic');
  for (const route of [forgot, reset]) for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) assert.equal(route[method], undefined);
  assert.deepEqual([...recovery.RESET_ORIGINS], origins);
});

for (const base of origins) test(`request uses exact query-free reset destination: ${base}`, async () => {
  const a = await actor();
  const response = await ask(`  ${a.employee.email.toUpperCase()}  `, { redirectTo: 'https://attacker.example.test/steal', next: '//attacker.example.test', emailRedirectTo: 'https://attacker.example.test' }, { host: 'attacker.example.test', 'x-forwarded-host': 'attacker.example.test', 'x-forwarded-proto': 'https' }, base);
  assert.equal(response.status, 200); assert.deepEqual(await bodyOf(response), notice); noCookies(response);
  assert.equal(calls('recover').length, 1);
  const call = calls('recover')[0], providerUrl = new URL(call.url);
  assert.equal(providerUrl.searchParams.get('redirect_to'), `${base}/reset-password`);
  assert.equal(call.body.email, a.employee.email); assert.equal(call.method, 'POST');
  assert.equal(call.headers.get('apikey'), 'sb_publishable_synthetic'); assert.equal(call.cache, 'no-store');
  assert.equal(JSON.stringify(call.body).includes('attacker'), false);
  assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 0);
});

for (const [name, route] of [['forgot-password', forgot], ['reset-password', reset]]) {
  for (const [label, headers] of [
    ['missing origin', { origin: '' }], ['foreign origin', { origin: 'https://attacker.example.test' }], ['cross-site fetch', { 'sec-fetch-site': 'cross-site' }], ['null origin', { origin: 'null' }],
  ]) test(`${name} rejects CSRF: ${label}`, async () => {
    const before = snapshot();
    const response = await route.POST(request(name, {}, headers));
    assert.equal(response.status, 403); await bodyOf(response); noCookies(response);
    assert.equal(transport.calls.length, 0); assert.deepEqual(snapshot(), before); assert.deepEqual(rateSnapshot(), []);
  });
  for (const badOrigin of ['http://127.0.0.1:5173', 'http://localhost:5174', 'https://localhost:5173', 'http://ufs-people.artman79.chatgpt.site', 'https://ufs-people.artman79.chatgpt.site.attacker.example.test', 'https://unapproved-preview.chatgpt.site']) {
    test(`${name} rejects unapproved destination ${badOrigin}`, async () => {
      const response = await route.POST(request(name, {}, {}, badOrigin));
      assert.equal(response.status, 403); await bodyOf(response); noCookies(response);
      assert.equal(transport.calls.length, 0); assert.deepEqual(rateSnapshot(), []);
    });
  }
  for (const [label, raw, headers, expected] of [
    ['wrong media type', '{}', { 'content-type': 'text/plain' }, 415],
    ['missing media type', '{}', { 'content-type': '' }, 415],
    ['malformed JSON', '{', {}, 400], ['array', '[]', {}, 400], ['null', 'null', {}, 400], ['scalar', '42', {}, 400],
    ['oversized actual body', JSON.stringify({ pad: 'x'.repeat(20000) }), { 'content-length': '2' }, 413],
    ['forged data scope', JSON.stringify({ data_scope: 'live' }), {}, 400],
  ]) test(`${name} rejects ${label} before provider or limiter changes`, async () => {
    const response = await route.POST(new Request(`${origin}/api/auth/${name}`, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: raw }));
    assert.equal(response.status, expected); await bodyOf(response); noCookies(response);
    assert.equal(transport.calls.length, 0); assert.deepEqual(rateSnapshot(), []);
  });
  test(`${name} enforces the streaming body limit without trusting Content-Length`, async () => {
    let cancelled = false, chunks = 0;
    const stream = new ReadableStream({ pull(controller) { chunks++; controller.enqueue(new TextEncoder().encode('x'.repeat(10001))); }, cancel() { cancelled = true; } });
    const response = await route.POST(new Request(`${origin}/api/auth/${name}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: stream, duplex: 'half' }));
    assert.equal(response.status, 413); assert.equal(cancelled, true); assert.ok(chunks <= 3);
    assert.equal(transport.calls.length, 0); assert.deepEqual(rateSnapshot(), []);
  });
}

for (const [label, value] of [['missing', undefined], ['empty', ''], ['non-string', {}], ['invalid', 'invalid'], ['whitespace', 'a b@example.test'], ['oversized', `${'a'.repeat(250)}@example.test`]]) test(`request rejects ${label} email`, async () => {
  const response = await ask(value); assert.equal(response.status, 400); await bodyOf(response); noCookies(response);
  assert.equal(transport.calls.length, 0); assert.deepEqual(rateSnapshot(), []);
});

test('request response is identical for eligible, unknown, ineligible and provider-failure addresses', async () => {
  const known = await actor('known'), inactive = await actor('inactive', { employee: { active: 0 } });
  const before = snapshot(), results = [];
  for (const email of [known.employee.email, 'unknown@example.test', inactive.employee.email, known.employee.email]) {
    transport.recoverError = results.length === 3;
    const response = await ask(email); noCookies(response);
    results.push({ status: response.status, headers: [...response.headers], body: await bodyOf(response) });
  }
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.deepEqual(results[0].body, notice); assert.equal(results[0].status, 200);
  assert.equal(calls('recover').length, 2); assert.deepEqual(snapshot(), before);
  const serialized = JSON.stringify(results); for (const privateValue of [known.employee.email, known.token, known.access, 'SMTP', known.user.id]) assert.equal(serialized.includes(privateValue), false);
});

test('request hides eligibility-database failures with the same generic notice', async () => {
  const a = await actor(), prepare = f.env.DB.prepare;
  f.env.DB.prepare = sql => { if (sql.startsWith('SELECT e.*,i.subject')) throw new Error('Synthetic private database failure'); return prepare(sql); };
  const response = await ask(a.employee.email);
  assert.equal(response.status, 200); assert.deepEqual(await bodyOf(response), notice); noCookies(response); assert.equal(calls('recover').length, 0);
});

test('known and unknown request paths both retain the response timing floor', async () => {
  const a = await actor();
  for (const email of [a.employee.email, 'unknown@example.test']) {
    const start = performance.now(); assert.equal((await ask(email)).status, 200);
    assert.ok(performance.now() - start >= 650, '700 ms floor allows only minor scheduler/clock tolerance');
  }
});

for (const [label, options] of [
  ['missing mapping', { mapping: false }], ['disabled mapping', { enabled: 0 }],
  ['different issuer', { issuer: 'https://untrusted.example.test/auth/v1' }],
  ['inactive employee', { employee: { active: 0 } }], ['demo employee', { employee: { demo: 1 } }],
  ['unknown employee role', { employee: { role: 'super_admin' } }],
]) test(`request hides and does not email ${label}`, async () => {
  const a = await actor('ineligible', options), before = snapshot();
  const response = await ask(a.employee.email);
  assert.equal(response.status, 200); assert.deepEqual(await bodyOf(response), notice); noCookies(response);
  assert.equal(calls('recover').length, 0); assert.deepEqual(snapshot(), before);
});

for (const state of ['inactive', 'terminated', 'archived']) for (const source of ['profile', 'import']) test(`both recovery routes reject ${source} ${state} even with active=1`, async () => {
  const a = await actor();
  if (source === 'profile') f.run('INSERT INTO employee_profiles (employee_id,employment_status,updated_at) VALUES (?,?,?)', a.employee.id, ` ${state.toUpperCase()} `, '2026-01-01');
  else f.run('INSERT INTO source_employee_links (source_id,employee_id,source_email,source_status,imported_at) VALUES (?,?,?,?,?)', 'synthetic-source', a.employee.id, a.employee.email, ` ${state.toUpperCase()} `, '2026-01-01');
  const before = snapshot();
  assert.deepEqual(await bodyOf(await ask(a.employee.email)), notice); assert.equal(calls('recover').length, 0);
  const response = await finish(a); assert.equal(response.status, 400); assert.deepEqual(await bodyOf(response), invalidLink); noCookies(response);
  assert.equal(calls('user', 'PUT').length, 0); assert.deepEqual(snapshot(), before);
});

for (const [label, change] of [
  ['disabled recovery', { UFS_PASSWORD_RECOVERY: undefined }], ['unknown recovery setting', { UFS_PASSWORD_RECOVERY: 'true' }], ['disabled auth', { UFS_AUTH_MODE: undefined }], ['wrong provider URL', { UFS_SUPABASE_URL: 'https://attacker.example.test' }],
  ['missing publishable key', { UFS_SUPABASE_PUBLISHABLE_KEY: undefined }], ['missing revocation check', { UFS_SUPABASE_SESSION_CHECK: undefined }],
]) test(`both recovery routes fail closed with ${label}`, async () => {
  const a = await actor(); Object.assign(f.env, change);
  for (const response of [await ask(a.employee.email), await finish(a)]) { assert.equal(response.status, 503); await bodyOf(response); noCookies(response); }
  assert.equal(transport.calls.length, 0); assert.equal(a.consumed, false);
});

test('request identity rate limit normalizes email and allows tenth but rejects eleventh attempt', async () => {
  const a = await actor(), hash = await setRate('password-reset-request', 'identity', a.employee.email, 9);
  assert.equal((await ask(` ${a.employee.email.toUpperCase()} `)).status, 200);
  const response = await ask(a.employee.email); assert.equal(response.status, 429); await bodyOf(response); noCookies(response);
  assert.equal(calls('recover').length, 1); assert.equal(f.get('SELECT attempts FROM auth_rate_limits WHERE key=?', hash).attempts, 11);
  assert.equal(JSON.stringify(rateSnapshot()).includes(a.employee.email), false);
});
test('request network limit spans distinct addresses and blocks the forty-first attempt', async () => {
  await setRate('password-reset-request', 'network', ip, 39);
  assert.equal((await ask('first-unknown@example.test')).status, 200);
  assert.equal((await ask('second-unknown@example.test')).status, 429);
  assert.equal(transport.calls.length, 0);
});
test('request rate counters reset after the fixed window and are separate from login', async () => {
  const email = 'synthetic@example.test';
  await setRate('password-reset-request', 'identity', email, 99, Math.floor(now() / 900) * 900 - 900);
  await setRate('login', 'network', ip, 99); await setRate('login', 'identity', email, 99);
  assert.equal((await ask(email)).status, 200);
});

for (const [label, token] of [['missing', undefined], ['empty', ''], ['non-string', {}], ['too short', 'a'.repeat(31)], ['too long', 'a'.repeat(257)], ['non-hex', 'g'.repeat(64)], ['URL', 'https://attacker.example.test/token'], ['space-padded', ` ${'a'.repeat(64)} `]]) test(`completion rejects ${label} recovery hash without consuming provider token`, async () => {
  const a = await actor(), response = await finish(a, { token_hash: token });
  assert.equal(response.status, 400); assert.deepEqual(await bodyOf(response), invalidLink); noCookies(response);
  assert.equal(a.consumed, false); assert.equal(transport.calls.length, 0); assert.deepEqual(rateSnapshot(), []);
});
for (const [label, fields] of [
  ['missing password', { password: undefined, confirmPassword: undefined }], ['non-string password', { password: 123456789012, confirmPassword: 123456789012 }],
  ['too short', { password: 'x'.repeat(11), confirmPassword: 'x'.repeat(11) }], ['too long', { password: 'x'.repeat(129), confirmPassword: 'x'.repeat(129) }],
  ['missing confirmation', { confirmPassword: undefined }], ['non-string confirmation', { confirmPassword: {} }], ['mismatched confirmation', { confirmPassword: 'Synthetic-different-value' }],
]) test(`completion rejects ${label} before consuming the one-time link`, async () => {
  const a = await actor(), response = await finish(a, fields);
  assert.equal(response.status, 400); await bodyOf(response); noCookies(response);
  assert.equal(a.consumed, false); assert.equal(transport.calls.length, 0); assert.deepEqual(rateSnapshot(), []);
});
for (const length of [12, 128]) test(`completion accepts the ${length}-character password boundary unchanged`, async () => {
  const a = await actor(), value = ` ${'x'.repeat(length - 2)} `;
  const response = await finish(a, { password: value, confirmPassword: value });
  assert.equal(response.status, 200); assert.equal(a.changedPassword, value); clearedCookiesOnly(response);
});

for (const state of ['unknown', 'expired', 'used', 'provider error']) test(`completion uniformly rejects ${state} links`, async () => {
  const a = await actor(), before = snapshot();
  if (state === 'unknown') transport.recoveries.delete(a.token);
  if (state === 'expired') a.expiresAt = now() - 1;
  if (state === 'used') a.consumed = true;
  if (state === 'provider error') transport.verifyError = true;
  const response = await finish(a); assert.equal(response.status, 400); assert.deepEqual(await bodyOf(response), invalidLink); noCookies(response);
  assert.equal(calls('verify').length, 1); assert.equal(calls('user', 'PUT').length, 0); assert.deepEqual(snapshot(), before);
});

test('completion uses recovery verification only and refuses client-selected authentication type or subject', async () => {
  const a = await actor(), other = await actor('other');
  const response = await finish(a, { type: 'invite', email: other.employee.email, user_id: other.user.id, subject: other.user.id, redirectTo: 'https://attacker.example.test' });
  assert.equal(response.status, 200); assert.equal(a.changedPassword, password); assert.equal(other.changedPassword, undefined);
  const verify = calls('verify')[0]; assert.equal(verify.body.type, 'recovery'); assert.equal(verify.body.token_hash, a.token);
  assert.equal(verify.body.email, undefined); assert.equal(verify.body.user_id, undefined);
  assert.equal(calls('user', 'PUT')[0].headers.get('authorization'), `Bearer ${a.access}`);
  assert.equal(transport.calls.every(call => call.cache === 'no-store'), true);
});

for (const [label, options] of [
  ['unmapped subject', { mapping: false }], ['disabled mapping', { enabled: 0 }], ['wrong mapped issuer', { issuer: 'https://different.example.test/auth/v1' }],
  ['wrong mapped subject', { subject: crypto.randomUUID() }], ['inactive employee', { employee: { active: 0 } }], ['demo employee', { employee: { demo: 1 } }],
  ['unknown role', { employee: { role: 'super_admin' } }], ['unconfirmed provider user', { user: { email_confirmed_at: null } }], ['anonymous provider user', { user: { is_anonymous: true } }],
  ['banned provider user', { user: { banned_until: new Date(Date.now() + 86400000).toISOString() } }], ['deleted provider user', { user: { deleted_at: '2026-01-01T00:00:00Z' } }],
]) test(`completion rejects ${label} and cleans up the temporary provider session`, async () => {
  const a = await actor('ineligible', options), old = await existingSession(a), before = snapshot();
  const response = await finish(a); assert.equal(response.status, 400); assert.deepEqual(await bodyOf(response), invalidLink); noCookies(response);
  assert.equal(calls('user', 'PUT').length, 0); assert.deepEqual(snapshot(), before);
  assert.ok(calls('logout').some(call => new URL(call.url).searchParams.get('scope') === 'local'));
  assert.equal(f.get('SELECT revoked_at FROM auth_sessions WHERE session_id=?', old.claims.session_id).revoked_at, null);
});

for (const malformed of [{}, { user: { id: 'synthetic-only' } }, { access_token: 'synthetic-only', token_type: 'bearer', expires_in: 3600 }]) test(`completion rejects incomplete provider recovery response ${Object.keys(malformed).join(',') || 'empty'}`, async () => {
  const a = await actor(); transport.verifyResponse = malformed;
  const response = await finish(a); assert.equal(response.status, 400); assert.deepEqual(await bodyOf(response), invalidLink); noCookies(response);
  assert.equal(calls('user', 'PUT').length, 0); assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 0);
});

test('completion rechecks employee eligibility after link verification and never auto-links by matching email', async () => {
  const a = await actor();
  transport.beforeVerify = () => { f.run('UPDATE employees SET active=0 WHERE id=?', a.employee.id); };
  const response = await finish(a); assert.equal(response.status, 400); assert.deepEqual(await bodyOf(response), invalidLink);
  assert.equal(calls('user', 'PUT').length, 0); assert.equal(f.get('SELECT user_id FROM employees WHERE id=?', a.employee.id).user_id, null);
});

test('successful completion revokes all same-subject app sessions before update, globally logs out, and requires a fresh sign-in', async () => {
  const a = await actor(), other = await actor('other');
  const old = await existingSession(a), second = await existingSession(a), alreadyRevoked = await existingSession(a, { revoked_at: 1 });
  const unrelated = await existingSession(other), otherIssuer = await existingSession(a, { issuer: 'https://other.example.test/auth/v1' });
  const before = snapshot();
  transport.beforeUpdate = () => {
    assert.ok(f.get('SELECT revoked_at FROM auth_sessions WHERE session_id=?', old.claims.session_id).revoked_at);
    assert.ok(f.get('SELECT revoked_at FROM auth_sessions WHERE session_id=?', second.claims.session_id).revoked_at);
  };
  const response = await finish(a, {}, { cookie: cookie(old) });
  assert.equal(response.status, 200); assert.deepEqual(await bodyOf(response), { ok: true, requiresSignIn: true, sessionRevocationPending: false }); clearedCookiesOnly(response);
  assert.equal(a.changedPassword, password); assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 5);
  assert.equal(f.get('SELECT revoked_at FROM auth_sessions WHERE session_id=?', alreadyRevoked.claims.session_id).revoked_at, 1);
  for (const session of [unrelated, otherIssuer]) assert.equal(f.get('SELECT revoked_at FROM auth_sessions WHERE session_id=?', session.claims.session_id).revoked_at, null);
  assert.deepEqual(f.rows('SELECT * FROM employee_identities ORDER BY rowid'), before.employee_identities);
  assert.deepEqual(f.rows('SELECT * FROM employees ORDER BY rowid'), before.employees);
  const logouts = calls('logout'); assert.equal(logouts.length, 2); assert.equal(new URL(logouts[1].url).searchParams.get('scope'), 'local'); assert.equal(new URL(logouts[0].url).searchParams.get('scope'), 'global');
  assert.equal(logouts[0].headers.get('authorization'), `Bearer ${a.access}`);
  assert.ok(transport.calls.indexOf(logouts[0]) > transport.calls.indexOf(calls('user', 'PUT')[0]));
  const unauthenticated = await sessionRoute.GET(new Request(`${origin}/api/auth/session`));
  assert.deepEqual(await bodyOf(unauthenticated), { enabled: true, authenticated: false });
  const oldStatus = await sessionRoute.GET(new Request(`${origin}/api/auth/session`, { headers: { cookie: cookie(old) } }));
  assert.equal(oldStatus.status, 401);
  const repeated = await finish(a); assert.equal(repeated.status, 400); assert.deepEqual(await bodyOf(repeated), invalidLink); noCookies(repeated);
  assert.equal(calls('user', 'PUT').length, 1);
  const database = JSON.stringify(snapshot()); for (const secret of [password, a.token, a.access, a.refresh]) assert.equal(database.includes(secret), false);
});

test('global logout failure is disclosed while old local sessions and refresh remain unusable', async () => {
  const a = await actor(), old = await existingSession(a); transport.globalLogoutError = true;
  const response = await finish(a);
  assert.equal(response.status, 200); assert.deepEqual(await bodyOf(response), { ok: true, requiresSignIn: true, sessionRevocationPending: true }); clearedCookiesOnly(response);
  assert.equal(a.changedPassword, password); assert.ok(f.get('SELECT revoked_at FROM auth_sessions WHERE session_id=?', old.claims.session_id).revoked_at);
  assert.equal(old.live, true, 'Synthetic provider revocation failure leaves provider session alive');
  const oldStatus = await sessionRoute.GET(new Request(`${origin}/api/auth/session`, { headers: { cookie: cookie(old) } }));
  assert.equal(oldStatus.status, 401);
  const refreshed = await refreshRoute.POST(request('refresh', {}, { cookie: cookie(old) })); assert.equal(refreshed.status, 401); noCookies(refreshed);
});

test('provider password-policy failure keeps app sessions revoked and does not claim completion', async () => {
  const a = await actor(), old = await existingSession(a); transport.updateError = true;
  const response = await finish(a); assert.equal(response.status, 400); assert.deepEqual(await bodyOf(response), { error: 'The password could not be changed. Request a new link and use a different strong password.' }); noCookies(response);
  assert.equal(a.changedPassword, undefined); assert.ok(f.get('SELECT revoked_at FROM auth_sessions WHERE session_id=?', old.claims.session_id).revoked_at);
  assert.equal(a.consumed, true); assert.equal(calls('logout').length, 1); assert.equal(new URL(calls('logout')[0].url).searchParams.get('scope'), 'local');
  assert.equal((await finish(a)).status, 400); assert.equal(calls('user', 'PUT').length, 1);
});

test('local-session revocation failure aborts before provider password change and cleans recovery session', async () => {
  const a = await actor(), old = await existingSession(a), prepare = f.env.DB.prepare;
  f.env.DB.prepare = sql => { if (sql.startsWith('UPDATE auth_sessions SET revoked_at=')) throw new Error('Synthetic local revocation failure'); return prepare(sql); };
  const response = await finish(a); assert.equal(response.status, 503); await bodyOf(response); noCookies(response);
  assert.equal(calls('user', 'PUT').length, 0); assert.equal(a.changedPassword, undefined);
  assert.equal(f.get('SELECT revoked_at FROM auth_sessions WHERE session_id=?', old.claims.session_id).revoked_at, null);
  assert.equal(calls('logout').length, 1); assert.equal(new URL(calls('logout')[0].url).searchParams.get('scope'), 'local');
});

test('completion token identity limiter rejects the eleventh attempt before provider verification', async () => {
  const a = await actor(); transport.verifyError = true;
  await setRate('password-reset-complete', 'identity', a.token, 9);
  assert.equal((await finish(a)).status, 400);
  const response = await finish(a); assert.equal(response.status, 429); await bodyOf(response); noCookies(response);
  assert.equal(calls('verify').length, 1); assert.equal(a.consumed, false); assert.equal(JSON.stringify(rateSnapshot()).includes(a.token), false);
});
test('completion network limiter spans different tokens and is separate from request limits', async () => {
  const a = await actor(), b = await actor('second'); transport.verifyError = true;
  await setRate('password-reset-complete', 'network', ip, 39); await setRate('password-reset-request', 'network', ip, 99);
  assert.equal((await finish(a)).status, 400); assert.equal((await finish(b)).status, 429); assert.equal(calls('verify').length, 1);
});

test('recovery-only access and refresh tokens cannot authenticate to the app or register an app session', async () => {
  const a = await actor();
  const status = await sessionRoute.GET(new Request(`${origin}/api/auth/session`, { headers: { cookie: cookie(a) } }));
  assert.equal(status.status, 401); noCookies(status);
  await assert.rejects(globalThis.__ufsSecurityTest.context.run(new Headers({ cookie: cookie(a) }), () => server.currentEmployee()), error => error instanceof AppError && error.status === 401);
  const response = await refreshRoute.POST(request('refresh', {}, { cookie: cookie(a) })); assert.equal(response.status, 401); noCookies(response);
  await assert.rejects(auth.verifyIdentity(a.access, { registerSession: true }), error => error instanceof AppError && error.status === 401);
  assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 0); assert.equal(f.get('SELECT COUNT(*) n FROM auth_session_tokens').n, 0);
});

test('even recovery tokens with password AMR cannot enter the app without a registered app session', async () => {
  const a = await actor('synthetic-password-amr', { claims: { amr: [{ method: 'password', timestamp: now() }] } });
  const response = await sessionRoute.GET(new Request(`${origin}/api/auth/session`, { headers: { cookie: cookie(a) } }));
  assert.equal(response.status, 401); noCookies(response); assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 0);
});

for (const code of [401, 403, 404, 429, 500]) test(`global logout HTTP ${code} is reported as pending rather than silently accepted`, async () => {
  const a = await actor(); transport.globalLogoutError = code;
  const response = await finish(a);
  assert.equal(response.status, 200); assert.deepEqual(await bodyOf(response), { ok: true, requiresSignIn: true, sessionRevocationPending: true }); clearedCookiesOnly(response);
  assert.equal(a.changedPassword, password);
  assert.equal(new URL(calls('logout')[0].url).searchParams.get('scope'), 'global');
});

test('eligibility failure after verified recovery does not create identities, cutoff rows or sessions', async () => {
  const a = await actor('unmapped-same-email', { mapping: false }), before = snapshot();
  const response = await finish(a);
  assert.equal(response.status, 400); assert.deepEqual(await bodyOf(response), invalidLink);
  assert.deepEqual(snapshot(), before); assert.equal(a.employee.email, a.user.email);
});

test('public pilot excludes unapproved identities from request and completion', async () => {
  const a = await actor();
  f.env.UFS_AUTH_MODE = 'standalone'; f.env.UFS_AUTH_PUBLIC_PILOT_UNTIL = '2026-10-13T01:35:00.000Z';
  assert.equal(auth.standaloneConfigured(), true);
  const before = snapshot();
  assert.deepEqual(await bodyOf(await ask(a.employee.email)), notice); assert.equal(calls('recover').length, 0);
  const response = await finish(a); assert.equal(response.status, 400); assert.deepEqual(await bodyOf(response), invalidLink);
  assert.equal(calls('user', 'PUT').length, 0); assert.deepEqual(snapshot(), before);
});

test('public pilot permits only explicitly approved subject bindings without changing role', async () => {
  const a = await actor('approved-admin', { employee: { role: 'admin' } });
  f.env.UFS_AUTH_MODE = 'standalone'; f.env.UFS_AUTH_PUBLIC_PILOT_UNTIL = '2026-10-13T01:35:00.000Z'; f.env.UFS_SUPABASE_OWNER_SUB = a.user.id;
  assert.deepEqual(await bodyOf(await ask(a.employee.email)), notice); assert.equal(calls('recover').length, 1);
  const response = await finish(a); assert.equal(response.status, 200); clearedCookiesOnly(response);
  assert.equal(f.get('SELECT role FROM employees WHERE id=?', a.employee.id).role, 'admin');
});

test('unapproved QA-scope identity cannot recover even with an enabled mapping', async () => {
  const a = await actor('unapproved-qa', { employee: { data_scope: 'qa-bots-v1' } }), before = snapshot();
  assert.deepEqual(await bodyOf(await ask(a.employee.email)), notice); assert.equal(calls('recover').length, 0);
  const response = await finish(a); assert.equal(response.status, 400); assert.deepEqual(await bodyOf(response), invalidLink);
  assert.equal(calls('user', 'PUT').length, 0); assert.deepEqual(snapshot(), before);
});

test('session inserted while password update is in flight is revoked by the second atomic sweep', async () => {
  const a = await actor(); await existingSession(a);
  let inserted;
  transport.beforeUpdate = async () => {
    assert.equal(f.get('SELECT COUNT(*) n FROM auth_password_resets WHERE issuer=? AND subject=?', auth.SUPABASE_ISSUER, a.user.id).n, 1);
    inserted = await existingSession(a);
    assert.equal(f.get('SELECT revoked_at FROM auth_sessions WHERE session_id=?', inserted.claims.session_id).revoked_at, null);
  };
  const response = await finish(a); assert.equal(response.status, 200); clearedCookiesOnly(response);
  assert.ok(f.get('SELECT revoked_at FROM auth_sessions WHERE session_id=?', inserted.claims.session_id).revoked_at);
  assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions WHERE issuer=? AND subject=? AND revoked_at IS NULL', auth.SUPABASE_ISSUER, a.user.id).n, 0);
});

async function registerToken(a, claimChanges = {}) {
  const claims = { ...a.claims, session_id: crypto.randomUUID(), amr: [{ method: 'password', timestamp: now() }], ...claimChanges };
  const access = await signedToken(claims), fresh = { ...a, access, claims, live: true, refresh: `synthetic-fresh-refresh-${crypto.randomUUID()}` };
  transport.tokens.set(access, fresh); transport.refreshes.set(fresh.refresh, fresh);
  return fresh;
}
for (const [label, claimsFor] of [
  ['old JWT and password authentication', cutoff => ({ iat: cutoff - 1, amr: [{ method: 'password', timestamp: cutoff - 1 }] })],
  ['new JWT with pre-reset password authentication', cutoff => ({ iat: cutoff + 1, amr: [{ method: 'password', timestamp: cutoff - 1 }] })],
  ['same-second JWT and password authentication', cutoff => ({ iat: cutoff, amr: [{ method: 'password', timestamp: cutoff }] })],
  ['missing password AMR timestamp', cutoff => ({ iat: cutoff + 1, amr: [{ method: 'password' }] })],
  ['string password AMR timestamp', cutoff => ({ iat: cutoff + 1, amr: [{ method: 'password', timestamp: String(cutoff + 1) }] })],
]) test(`reset cutoff prevents re-registering ${label}`, async () => {
  const a = await actor(); transport.globalLogoutError = true;
  assert.equal((await finish(a)).status, 200);
  const cutoff = f.get('SELECT not_before FROM auth_password_resets WHERE issuer=? AND subject=?', auth.SUPABASE_ISSUER, a.user.id).not_before;
  const old = await registerToken(a, claimsFor(cutoff));
  await assert.rejects(auth.verifyIdentity(old.access, { registerSession: true }), error => error instanceof AppError && error.status === 401);
  assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 0);
  assert.equal(f.get('SELECT COUNT(*) n FROM auth_session_tokens').n, 0);
});

test('fresh password authentication after reset cutoff can establish a new app session', async () => {
  const a = await actor(); transport.globalLogoutError = true;
  assert.equal((await finish(a)).status, 200);
  const cutoff = f.get('SELECT not_before FROM auth_password_resets WHERE issuer=? AND subject=?', auth.SUPABASE_ISSUER, a.user.id).not_before;
  const fresh = await registerToken(a, { iat: cutoff + 1, amr: [{ method: 'password', timestamp: cutoff + 1 }] });
  assert.equal((await auth.verifyIdentity(fresh.access, { registerSession: true })).employee.id, a.employee.id);
  assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions WHERE revoked_at IS NULL').n, 1);
});

test('reset cutoff is monotonic and scoped to the exact issuer and subject', async () => {
  const a = await actor(), b = await actor('unrelated');
  const futureCutoff = now() + 5;
  f.run('INSERT INTO auth_password_resets (issuer,subject,not_before) VALUES (?,?,?)', auth.SUPABASE_ISSUER, a.user.id, futureCutoff);
  f.run('INSERT INTO auth_password_resets (issuer,subject,not_before) VALUES (?,?,?)', 'https://other.example.test/auth/v1', a.user.id, futureCutoff + 5);
  assert.equal((await finish(a)).status, 200);
  assert.equal(f.get('SELECT not_before FROM auth_password_resets WHERE issuer=? AND subject=?', auth.SUPABASE_ISSUER, a.user.id).not_before, futureCutoff);
  assert.equal(f.get('SELECT not_before FROM auth_password_resets WHERE issuer=? AND subject=?', 'https://other.example.test/auth/v1', a.user.id).not_before, futureCutoff + 5);
  const unrelated = await registerToken(b);
  assert.equal((await auth.verifyIdentity(unrelated.access, { registerSession: true })).employee.id, b.employee.id);
});

test('concurrent submits of one recovery hash produce only one password update', async () => {
  const a = await actor();
  const results = await Promise.all([finish(a), finish(a)]);
  assert.deepEqual(results.map(response => response.status).sort(), [200, 400]);
  assert.equal(calls('verify').length, 2); assert.equal(calls('user', 'PUT').length, 1);
  assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 0);
  for (const response of results) if (response.status === 200) clearedCookiesOnly(response); else { noCookies(response); assert.deepEqual(await bodyOf(response), invalidLink); }
});

test('locked recovery cutoff rejects even otherwise fresh password authentication while update is in flight', async () => {
  const a = await actor();
  transport.beforeUpdate = async () => {
    const cutoff = f.get('SELECT not_before,locked FROM auth_password_resets WHERE issuer=? AND subject=?', auth.SUPABASE_ISSUER, a.user.id);
    assert.equal(cutoff.locked, 1);
    const future = await registerToken(a, { iat: cutoff.not_before + 1, amr: [{ method: 'password', timestamp: cutoff.not_before + 1 }] });
    await assert.rejects(auth.verifyIdentity(future.access, { registerSession: true }), error => error instanceof AppError && error.status === 401);
    assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 0);
  };
  assert.equal((await finish(a)).status, 200);
  assert.equal(f.get('SELECT locked FROM auth_password_resets WHERE issuer=? AND subject=?', auth.SUPABASE_ISSUER, a.user.id).locked, 0);
});

test('failed provider password change keeps the cutoff locked until a successful new recovery', async () => {
  const a = await actor(); transport.updateError = true;
  assert.equal((await finish(a)).status, 400);
  const cutoff = f.get('SELECT not_before,locked FROM auth_password_resets WHERE issuer=? AND subject=?', auth.SUPABASE_ISSUER, a.user.id);
  assert.equal(cutoff.locked, 1);
  const future = await registerToken(a, { iat: cutoff.not_before + 1, amr: [{ method: 'password', timestamp: cutoff.not_before + 1 }] });
  await assert.rejects(auth.verifyIdentity(future.access, { registerSession: true }), error => error instanceof AppError && error.status === 401);
  transport.updateError = false;
  a.token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''); a.consumed = false;
  transport.recoveries.set(a.token, a);
  assert.equal((await finish(a)).status, 200);
  assert.equal(f.get('SELECT locked FROM auth_password_resets WHERE issuer=? AND subject=?', auth.SUPABASE_ISSUER, a.user.id).locked, 0);
});

test('post-update database failure cannot unlock reset cutoff or allow fresh application sessions', async () => {
  const a = await actor(), batch = f.env.DB.batch;
  let batches = 0;
  f.env.DB.batch = statements => { if (++batches === 2) throw new Error('Synthetic post-password database failure'); return batch(statements); };
  const response = await finish(a); assert.equal(response.status, 503); await bodyOf(response); noCookies(response);
  assert.equal(a.changedPassword, password);
  const cutoff = f.get('SELECT not_before,locked FROM auth_password_resets WHERE issuer=? AND subject=?', auth.SUPABASE_ISSUER, a.user.id);
  assert.equal(cutoff.locked, 1);
  const future = await registerToken(a, { iat: cutoff.not_before + 1, amr: [{ method: 'password', timestamp: cutoff.not_before + 1 }] });
  await assert.rejects(auth.verifyIdentity(future.access, { registerSession: true }), error => error instanceof AppError && error.status === 401);
  assert.equal(calls('logout').length, 1); assert.equal(new URL(calls('logout')[0].url).searchParams.get('scope'), 'local');
});

test('initial revocation batch is atomic if its session update fails after cutoff insertion', async () => {
  const a = await actor(), old = await existingSession(a), prepare = f.env.DB.prepare;
  f.env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (sql.startsWith('UPDATE auth_sessions SET revoked_at=')) statement.run = async () => { throw new Error('Synthetic statement failure'); };
    return statement;
  };
  const response = await finish(a); assert.equal(response.status, 503); noCookies(response);
  assert.equal(calls('user', 'PUT').length, 0);
  assert.equal(f.get('SELECT COUNT(*) n FROM auth_password_resets').n, 0);
  assert.equal(f.get('SELECT revoked_at FROM auth_sessions WHERE session_id=?', old.claims.session_id).revoked_at, null);
});
