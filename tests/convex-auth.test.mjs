// Convex Auth provider tests. A synthetic Convex deployment answers every request with locally signed
// RS256 tokens; nothing here contacts a real service, sends email or creates an account anywhere.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, origin } from './harness.mjs';

const auth = await import('../lib/standalone-auth.ts');
const provider = await import('../lib/auth-provider.ts');
const convex = await import('../lib/convex-auth.ts');
const server = await import('../lib/server.ts');
const policy = await import('../lib/policy.ts');
const login = await import('../app/api/auth/login/route.ts');
const logout = await import('../app/api/auth/logout/route.ts');
const refresh = await import('../app/api/auth/refresh/route.ts');
const sessionRoute = await import('../app/api/auth/session/route.ts');
const forgot = await import('../app/api/auth/forgot-password/route.ts');
const reset = await import('../app/api/auth/reset-password/route.ts');

const CLOUD = 'https://synthetic-deploy-123.convex.cloud', SITE = 'https://synthetic-deploy-123.convex.site';
const GOOD_PASSWORD = 'synthetic-good-passphrase', NEW_PASSWORD = 'synthetic-new-passphrase-9';
const encoder = new TextEncoder();
const b64 = value => Buffer.from(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)).toString('base64url');
const rsa = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const keyPair = async () => { const pair = await crypto.subtle.generateKey(rsa, true, ['sign', 'verify']); return { pair, jwk: { ...await crypto.subtle.exportKey('jwk', pair.publicKey), use: 'sig' } }; };
let primary = await keyPair(); const stranger = await keyPair();
const authKeys = ['UFS_AUTH_PROVIDER', 'UFS_AUTH_MODE', 'UFS_CONVEX_URL', 'UFS_CONVEX_SITE_URL', 'UFS_CONVEX_OWNER_SUB', 'UFS_CONVEX_OWNER_EMPLOYEE_ID', 'UFS_PASSWORD_RECOVERY', 'UFS_SUPABASE_URL', 'UFS_SUPABASE_PUBLISHABLE_KEY', 'UFS_SUPABASE_SESSION_CHECK', 'UFS_AUTH_PUBLIC_PILOT_UNTIL'];
let f, previousEnv, transport, originalFetch, originalNow;

async function sign(claims, { key = primary.pair.privateKey, header = { alg: 'RS256', typ: 'JWT' } } = {}) {
  const input = `${b64(header)}.${b64(claims)}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(input));
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}
const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), x => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join('');
const claimsFor = (userId, sessionId, extra = {}) => { const now = Math.floor(Date.now() / 1000); return { iss: SITE, aud: 'convex', sub: `${userId}|${sessionId}`, iat: now, exp: now + 900, ...extra }; };

function installTransport() {
  const state = { calls: [], unexpected: [], accounts: new Map(), sessions: new Map(), refreshes: new Map(), jwksFetches: 0, jwksDown: false, down: false, failSignOut: false, resetRequests: [], keys: () => [primary.jwk] };
  const respond = (body, status = 200) => Response.json(body, { status });
  const ok = value => respond({ status: 'success', value });
  const rejected = () => respond({ status: 'error', errorMessage: '[Request ID: synthetic] Server Error\nUncaught Error: InvalidSecret\n' });
  async function startSession(account) {
    const sessionId = rand(32), refreshToken = `${rand(32)}|${sessionId}`;
    state.sessions.set(sessionId, { userId: account.userId, live: true }); state.refreshes.set(refreshToken, sessionId);
    return { token: await sign(claimsFor(account.userId, sessionId)), refreshToken, sessionId };
  }
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const headers = new Headers(init.headers ?? undefined), body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : null;
    state.calls.push({ url: url.href, path: url.pathname, origin: url.origin, body, headers, redirect: init.redirect, cache: init.cache });
    if (state.down) throw new TypeError('Synthetic outage');
    if (url.origin === SITE && url.pathname === '/.well-known/jwks.json') { state.jwksFetches++; return state.jwksDown ? respond({}, 503) : respond({ keys: state.keys() }); }
    if (url.origin === CLOUD && url.pathname === '/api/action' && body) {
      const { path, args } = body;
      if (path === 'auth:signIn' && args.refreshToken !== undefined) {
        const sessionId = state.refreshes.get(args.refreshToken), session = sessionId && state.sessions.get(sessionId);
        if (!session?.live) return ok({ tokens: null });
        state.refreshes.delete(args.refreshToken);
        const next = `${rand(32)}|${sessionId}`; state.refreshes.set(next, sessionId);
        return ok({ tokens: { token: await sign(claimsFor(session.userId, sessionId)), refreshToken: next } });
      }
      if (path === 'auth:signIn' && args.provider === 'password') {
        const { email, flow } = args.params, account = state.accounts.get(email);
        if (flow === 'signIn') {
          if (!account || args.params.password !== account.password || account.locked) return rejected();
          const s = await startSession(account); return ok({ tokens: { token: s.token, refreshToken: s.refreshToken } });
        }
        if (flow === 'reset') { state.resetRequests.push(email); if (!account) return rejected(); account.code = String(Math.floor(10000000 + Math.random() * 89999999)); return ok({ started: true }); }
        if (flow === 'reset-verification') {
          if (!account || !account.code || args.params.code !== account.code || args.params.newPassword.length < 12) return rejected();
          account.password = args.params.newPassword; account.code = null;
          for (const session of state.sessions.values()) if (session.userId === account.userId) session.live = false;
          const s = await startSession({ userId: state.forceUserId ?? account.userId }); return ok({ tokens: { token: s.token, refreshToken: s.refreshToken } });
        }
      }
      if (path === 'auth:signOut') {
        if (state.failSignOut) return respond({ status: 'error', errorMessage: 'Synthetic failure' });
        const token = headers.get('authorization')?.replace(/^Bearer /, '');
        if (!token) return rejected();
        const sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub, sessionId = sub.split('|')[1];
        const session = state.sessions.get(sessionId); if (!session) return rejected();
        session.live = false; return ok(null);
      }
    }
    state.unexpected.push(url.href); return respond({ status: 'error', errorMessage: 'Unexpected synthetic request' }, 400);
  };
  return state;
}

const request = (path, body = {}, headers = {}) => new Request(`${origin}/api/auth/${path}`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.7', ...headers }, body: JSON.stringify(body) });
const bodyOf = async response => { const body = await response.json(); assert.equal(response.headers.get('cache-control')?.includes('no-store'), true); return body; };
const cookiePair = (response, name) => response.headers.getSetCookie().find(value => value.startsWith(`${name}=`))?.split(';')[0].split('=')[1];
const cookiesOf = response => `${auth.ACCESS_COOKIE}=${cookiePair(response, auth.ACCESS_COOKIE)}; ${auth.REFRESH_COOKIE}=${cookiePair(response, auth.REFRESH_COOKIE)}`;
const asCookies = (cookie, callback) => globalThis.__ufsSecurityTest.context.run(new Headers({ cookie }), callback);
const rejectsStatus = (promise, status) => assert.rejects(promise, error => error instanceof policy.AppError && error.status === status);
const sessionCalls = () => transport.calls.filter(call => call.origin === CLOUD && call.body?.path === 'auth:signIn' && call.body.args.params?.flow === 'signIn');
const convexCalls = () => transport.calls.filter(call => call.origin === CLOUD);

// An employee with an approved sign-in binding and a Convex account.
function person(id, { role = 'employee', password = GOOD_PASSWORD, bind = true, enabled = 1, employee = {} } = {}) {
  const row = f.employee(id, { user_id: null, role, ...employee }), userId = rand(32);
  if (bind) f.run('INSERT INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) VALUES (?,?,?,?,?,?,?)', crypto.randomUUID(), SITE, userId, row.id, enabled, '2026-01-01T00:00:00Z', 'synthetic-reviewer');
  const account = { userId, password, code: null }; transport.accounts.set(row.email.toLowerCase(), account);
  return { row, email: row.email.toLowerCase(), userId, account };
}
const signIn = (who, password = GOOD_PASSWORD) => login.POST(request('login', { email: who.email, password }));

beforeEach(() => {
  f = fixture(); previousEnv = Object.fromEntries(authKeys.map(key => [key, f.env[key]]));
  Object.assign(f.env, { UFS_AUTH_PROVIDER: 'convex', UFS_AUTH_MODE: 'standalone', UFS_CONVEX_URL: CLOUD, UFS_CONVEX_SITE_URL: SITE });
  for (const key of ['UFS_SUPABASE_URL', 'UFS_SUPABASE_PUBLISHABLE_KEY', 'UFS_SUPABASE_SESSION_CHECK', 'UFS_AUTH_PUBLIC_PILOT_UNTIL', 'UFS_PASSWORD_RECOVERY', 'UFS_CONVEX_OWNER_SUB', 'UFS_CONVEX_OWNER_EMPLOYEE_ID']) delete f.env[key];
  originalFetch = globalThis.fetch; originalNow = Date.now; convex.resetConvexKeyCache(); transport = installTransport();
});
afterEach(() => {
  globalThis.fetch = originalFetch; Date.now = originalNow;
  for (const key of authKeys) if (previousEnv[key] === undefined) delete f.env[key]; else f.env[key] = previousEnv[key];
  f.close(); assert.deepEqual(transport.unexpected, [], 'No unexpected or real HTTP requests are permitted');
});

describe('configuration', () => {
  for (const [label, change] of [
    ['http instead of https', { UFS_CONVEX_URL: 'http://synthetic-deploy-123.convex.cloud' }],
    ['another host', { UFS_CONVEX_URL: 'https://synthetic-deploy-123.example.test' }],
    ['site URL on the wrong domain', { UFS_CONVEX_SITE_URL: 'https://synthetic-deploy-123.convex.cloud' }],
    ['different deployments', { UFS_CONVEX_SITE_URL: 'https://other-deploy-456.convex.site' }],
    ['trailing slash', { UFS_CONVEX_URL: `${CLOUD}/` }],
    ['path appended', { UFS_CONVEX_SITE_URL: `${SITE}/auth` }],
    ['missing URL', { UFS_CONVEX_URL: undefined }],
    ['missing site URL', { UFS_CONVEX_SITE_URL: undefined }],
    ['sign-in mode off', { UFS_AUTH_MODE: undefined }],
    ['unknown sign-in mode', { UFS_AUTH_MODE: 'public' }],
  ]) test(`fails closed: ${label}`, async () => {
    Object.assign(f.env, change);
    assert.equal(auth.standaloneConfigured(), false);
    assert.deepEqual(await bodyOf(await sessionRoute.GET(new Request(`${origin}/api/auth/session`))), { enabled: false, authenticated: false });
    assert.equal((await login.POST(request('login', { email: 'a@example.test', password: GOOD_PASSWORD }))).status, 503);
    assert.equal(transport.calls.length, 0);
  });
  test('Supabase stays the default provider', () => {
    delete f.env.UFS_AUTH_PROVIDER;
    assert.equal(provider.authProvider(), 'supabase'); assert.equal(auth.standaloneConfigured(), false);
    f.env.UFS_AUTH_PROVIDER = 'CONVEX'; assert.equal(provider.authProvider(), 'supabase');
  });
  test('public-pilot limits belong to Supabase and do not apply to Convex', () => {
    f.env.UFS_AUTH_PUBLIC_PILOT_UNTIL = '2026-10-13T01:35:00.000Z';
    assert.equal(auth.publicPilotEnabled(), false); assert.equal(auth.standaloneConfigured(), true);
  });
});

describe('sign in', () => {
  test('a bound employee signs in; cookies only, no tokens in the response', async () => {
    const a = person('alice'), response = await signIn(a);
    assert.equal(response.status, 200); assert.deepEqual(await bodyOf(response), { ok: true, enabled: true, authenticated: true });
    const set = response.headers.getSetCookie(); assert.equal(set.length, 2);
    for (const cookie of set) { assert.match(cookie, /; Secure; HttpOnly; SameSite=Strict/); assert.ok(cookie.startsWith('__Host-')); assert.match(cookie, /Path=\//); assert.doesNotMatch(cookie, /Domain=/i); }
    assert.doesNotMatch(cookiePair(response, auth.REFRESH_COOKIE), /[|]/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  });
  test('the app session ledger records the Convex session', async () => {
    const a = person('alice'), response = await signIn(a);
    const sessionId = JSON.parse(Buffer.from(cookiePair(response, auth.ACCESS_COOKIE).split('.')[1], 'base64url')).sub.split('|')[1];
    const row = f.get('SELECT * FROM auth_sessions WHERE session_id=?', sessionId);
    assert.equal(row.issuer, SITE); assert.equal(row.subject, a.userId); assert.equal(row.employee_id, a.row.id); assert.equal(row.revoked_at, null);
    assert.equal(f.get('SELECT COUNT(*) n FROM auth_session_tokens').n, 1);
    assert.doesNotMatch(JSON.stringify(f.rows('SELECT * FROM auth_session_tokens')), /eyJ/);
  });
  test('wrong password, unknown address and locked account look identical', async () => {
    const a = person('alice'), locked = person('locked'); locked.account.locked = true;
    const results = [];
    for (const attempt of [() => signIn(a, 'wrong-password-value'), () => login.POST(request('login', { email: 'nobody@example.test', password: GOOD_PASSWORD })), () => signIn(locked)]) {
      const response = await attempt(); results.push([response.status, JSON.stringify(await response.json()), response.headers.getSetCookie().length]);
    }
    assert.deepEqual(results[1], results[0]); assert.deepEqual(results[2], results[0]); assert.equal(results[0][0], 401); assert.equal(results[0][2], 0);
    assert.doesNotMatch(results[0][1], /Invalid|Secret|AccountId|Request ID/);
  });
  test('requests use only fetch options the edge runtime supports and never follow redirects', async () => {
    const a = person('alice'); await signIn(a);
    assert.ok(convexCalls().length >= 1 && transport.jwksFetches >= 1);
    for (const call of transport.calls) { assert.equal(call.redirect, 'manual'); assert.equal(call.cache, 'no-store'); }
  });
  test('a redirect answer from Convex is treated as unavailable, not followed', async () => {
    const a = person('alice'), real = globalThis.fetch;
    globalThis.fetch = async (input, init) => new URL(typeof input === 'string' ? input : input.url).origin === CLOUD ? new Response(null, { status: 302, headers: { location: 'https://attacker.example.test/' } }) : real(input, init);
    const response = await signIn(a); assert.equal(response.status, 503); assert.equal(response.headers.getSetCookie().length, 0);
  });
  test('an account with no approved binding is refused and its Convex session ended', async () => {
    const a = person('unbound', { bind: false }), response = await signIn(a);
    assert.equal(response.status, 403); assert.equal(response.headers.getSetCookie().length, 0);
    assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 0);
    assert.equal([...transport.sessions.values()].every(s => !s.live), true);
  });
  for (const [label, options] of [['disabled binding', { enabled: 0 }], ['inactive employee', { employee: { active: 0 } }], ['demo employee', { employee: { demo: 1 } }], ['unknown role', { role: 'super_admin' }], ['test-scope employee', { employee: { data_scope: 'qa-bots-v1' } }]]) {
    test(`denied: ${label}`, async () => {
      const a = person('blocked', options), response = await signIn(a);
      assert.equal(response.status, 403); assert.equal(response.headers.getSetCookie().length, 0); assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 0);
    });
  }
  test('a former employee is denied even if the account is active', async () => {
    const a = person('former'); f.run('INSERT INTO employee_profiles (employee_id,employment_status,updated_at) VALUES (?,?,?)', a.row.id, 'terminated', '2026-01-01');
    assert.equal((await signIn(a)).status, 403);
  });
  for (const [label, body] of [['bad email', { email: 'not-an-email', password: GOOD_PASSWORD }], ['no password', { email: 'a@example.test' }], ['empty password', { email: 'a@example.test', password: '' }], ['huge password', { email: 'a@example.test', password: 'x'.repeat(1025) }], ['non-string email', { email: ['a@example.test'], password: GOOD_PASSWORD }]]) {
    test(`rejects ${label} before contacting Convex`, async () => { assert.equal((await login.POST(request('login', body))).status, 400); assert.equal(transport.calls.length, 0); });
  }
  for (const [reason, headers] of [['missing origin', { origin: '' }], ['foreign origin', { origin: 'https://attacker.example.test' }], ['cross-site fetch', { 'sec-fetch-site': 'cross-site' }]]) {
    for (const [name, route] of [['login', login], ['logout', logout], ['refresh', refresh]]) test(`${name} rejects CSRF: ${reason}`, async () => {
      assert.equal((await route.POST(request(name, {}, headers))).status, 403); assert.equal(transport.calls.length, 0);
    });
  }
  test('non-JSON sign-in is refused', async () => { assert.equal((await login.POST(request('login', {}, { 'content-type': 'text/plain' }))).status, 415); assert.equal(transport.calls.length, 0); });
  test('sign-in attempts are rate limited per address', async () => {
    const a = person('alice');
    for (let i = 0; i < 10; i++) assert.equal((await signIn(a, 'wrong-password-value')).status, 401);
    assert.equal((await signIn(a)).status, 429); assert.equal(sessionCalls().length, 10);
  });
});

describe('token verification', () => {
  const token = async (overrides = {}, options) => { const a = person('alice'), sessionId = rand(32); const t = await sign(claimsFor(a.userId, sessionId, overrides), options); return { a, sessionId, t }; };
  test('a valid token is accepted and the session is registered once', async () => {
    const { a, t } = await token(); const identity = await convex.convexVerifyIdentity(t, { registerSession: true });
    assert.equal(identity.employee.id, a.row.id); assert.equal(identity.issuer, SITE);
  });
  test('audience may be a list containing convex', async () => { const { a, t } = await token({ aud: ['other', 'convex'] }); assert.equal((await convex.convexVerifyIdentity(t, { registerSession: true })).employee.id, a.row.id); });
  for (const [label, overrides] of [
    ['wrong issuer', { iss: 'https://other-deploy-456.convex.site' }], ['issuer with slash', { iss: `${SITE}/` }], ['wrong audience', { aud: 'authenticated' }], ['missing audience', { aud: undefined }],
    ['expired', { exp: 1 }], ['expiry as text', { exp: '9999999999' }], ['no expiry', { exp: undefined }], ['issued in the future', { iat: Math.floor(Date.now() / 1000) + 600 }], ['no issue time', { iat: undefined }],
    ['subject without a session', { sub: 'a'.repeat(32) }], ['subject with too many parts', { sub: `${'a'.repeat(32)}|${'b'.repeat(32)}|${'c'.repeat(32)}` }], ['subject too short', { sub: 'a|b' }], ['numeric subject', { sub: 12345 }],
  ]) test(`signed but unacceptable claims are rejected: ${label}`, async () => { const { t } = await token(overrides); await rejectsStatus(convex.convexVerifyIdentity(t, { registerSession: true }), 401); });
  test('payload tampering is rejected', async () => {
    const { a, t } = await token(); const [h, p, s] = t.split('.'); const other = person('mallory');
    const forged = `${h}.${b64({ ...JSON.parse(Buffer.from(p, 'base64url')), sub: `${other.userId}|${rand(32)}` })}.${s}`;
    await rejectsStatus(convex.convexVerifyIdentity(forged, { registerSession: true }), 401); assert.ok(a);
  });
  test('signature tampering is rejected', async () => {
    const { t } = await token(); const [h, p, s] = t.split('.'), bytes = Buffer.from(s, 'base64url'); bytes[0] ^= 1;
    await rejectsStatus(convex.convexVerifyIdentity(`${h}.${p}.${bytes.toString('base64url')}`, { registerSession: true }), 401);
  });
  test('a token signed by another key is rejected', async () => {
    const { t } = await token({}, { key: stranger.pair.privateKey }); await rejectsStatus(convex.convexVerifyIdentity(t, { registerSession: true }), 401);
    assert.ok(transport.jwksFetches <= 2);
  });
  for (const [label, header] of [['none', { alg: 'none' }], ['HS256', { alg: 'HS256', typ: 'JWT' }], ['RS512', { alg: 'RS512' }], ['missing algorithm', {}]]) {
    test(`algorithm "${label}" is never accepted`, async () => { const { t } = await token({}, { header }); await rejectsStatus(convex.convexVerifyIdentity(t, { registerSession: true }), 401); });
  }
  for (const [label, value] of [['empty', ''], ['two parts', 'a.b'], ['not base64', '!!!.???.***'], ['four parts', 'a.b.c.d'], ['huge', `${'a'.repeat(4001)}.b.c`]]) {
    test(`malformed token is rejected: ${label}`, async () => { await rejectsStatus(convex.convexVerifyIdentity(value), 401); });
  }
  test('signing keys are cached between requests', async () => {
    const { t } = await token(); await convex.convexVerifyIdentity(t, { registerSession: true }); await convex.convexVerifyIdentity(t);
    assert.equal(transport.jwksFetches, 1);
  });
  test('a rotated signing key is picked up after one refetch', async () => {
    const a = person('alice'), first = await sign(claimsFor(a.userId, rand(32))); await convex.convexVerifyIdentity(first, { registerSession: true });
    const rotated = await keyPair(); transport.keys = () => [rotated.jwk];
    const second = await sign(claimsFor(a.userId, rand(32)), { key: rotated.pair.privateKey });
    assert.equal((await convex.convexVerifyIdentity(second, { registerSession: true })).employee.id, a.row.id); assert.equal(transport.jwksFetches, 2);
  });
  test('unreachable signing keys mean "try later", not a sign-out', async () => {
    const { t } = await token(); transport.jwksDown = true; await rejectsStatus(convex.convexVerifyIdentity(t, { registerSession: true }), 503);
  });
  test('only keys from the configured deployment are fetched', async () => {
    const { t } = await token(); await convex.convexVerifyIdentity(t, { registerSession: true });
    assert.equal(transport.calls.every(call => call.origin === SITE || call.origin === CLOUD), true);
  });
});

describe('sessions', () => {
  test('the session endpoint reports state without leaking tokens', async () => {
    const a = person('alice'), response = await signIn(a);
    const status = await sessionRoute.GET(new Request(`${origin}/api/auth/session`, { headers: { cookie: cookiesOf(response) } }));
    assert.equal(status.status, 200); assert.deepEqual(await bodyOf(status), { ok: true, enabled: true, authenticated: true });
    assert.deepEqual(await bodyOf(await sessionRoute.GET(new Request(`${origin}/api/auth/session`))), { enabled: true, authenticated: false });
    const bad = await sessionRoute.GET(new Request(`${origin}/api/auth/session`, { headers: { cookie: `${auth.ACCESS_COOKIE}=not.a.token` } }));
    assert.equal(bad.status, 401);
  });
  test('a signed-in request resolves its employee; nobody is signed in without cookies', async () => {
    const a = person('alice'), response = await signIn(a);
    assert.equal((await asCookies(cookiesOf(response), () => server.currentEmployee())).id, a.row.id);
    await rejectsStatus(asCookies('', () => server.currentEmployee()), 401);
  });
  test('legacy ChatGPT headers never sign anyone in while Convex sign-in is on', async () => {
    const legacy = f.employee('legacy-admin', { role: 'admin', email: 'owner@example.test' });
    await rejectsStatus(globalThis.__ufsSecurityTest.context.run(new Headers({ 'oai-authenticated-user-id': legacy.user_id, 'oai-authenticated-user-email': legacy.email }), () => server.currentEmployee()), 401);
  });
  test('refresh rotates both cookies and a used refresh token cannot be replayed', async () => {
    const a = person('alice'), first = await signIn(a), cookie = cookiesOf(first);
    const second = await refresh.POST(request('refresh', {}, { cookie })); assert.equal(second.status, 200);
    assert.notEqual(cookiePair(second, auth.REFRESH_COOKIE), cookiePair(first, auth.REFRESH_COOKIE)); assert.equal((await bodyOf(second)).authenticated, true);
    const replay = await refresh.POST(request('refresh', {}, { cookie })); assert.equal(replay.status, 401); assert.equal(replay.headers.getSetCookie().length, 0);
  });
  for (const [label, cookie] of [['no cookie', ''], ['not encoded', `${auth.REFRESH_COOKIE}=abc.def`], ['unknown token', `${auth.REFRESH_COOKIE}=${Buffer.from('unknown|token').toString('base64url')}`]]) {
    test(`refresh refuses: ${label}`, async () => { assert.equal((await refresh.POST(request('refresh', {}, cookie ? { cookie } : {}))).status, 401); });
  }
  test('logout revokes the app session at once, even though the token is still signed', async () => {
    const a = person('alice'), response = await signIn(a), cookie = cookiesOf(response), token = cookiePair(response, auth.ACCESS_COOKIE);
    const out = await logout.POST(request('logout', {}, { cookie })); assert.equal(out.status, 200);
    assert.equal(out.headers.getSetCookie().length, 2); assert.ok(out.headers.getSetCookie().every(value => value.includes('Max-Age=0')));
    assert.equal((await bodyOf(out)).providerSignOutComplete, true);
    assert.ok(f.get('SELECT revoked_at FROM auth_sessions').revoked_at);
    await rejectsStatus(convex.convexVerifyIdentity(token), 401);
    assert.equal((await refresh.POST(request('refresh', {}, { cookie }))).status, 401);
  });
  test('logout still revokes when Convex is unreachable and says sign-out was not confirmed', async () => {
    const a = person('alice'), response = await signIn(a), cookie = cookiesOf(response), token = cookiePair(response, auth.ACCESS_COOKIE);
    transport.down = true; const out = await logout.POST(request('logout', {}, { cookie }));
    assert.equal(out.status, 200); assert.equal((await bodyOf(out)).providerSignOutComplete, false); assert.ok(f.get('SELECT revoked_at FROM auth_sessions').revoked_at);
    transport.down = false; await rejectsStatus(convex.convexVerifyIdentity(token), 401);
  });
  test('logout with an expired access token still ends the session using the refresh token', async () => {
    const a = person('alice'), response = await signIn(a), cookie = cookiesOf(response);
    Date.now = () => originalNow() + 20 * 60 * 1000;
    const out = await logout.POST(request('logout', {}, { cookie })); assert.equal((await bodyOf(out)).providerSignOutComplete, true);
    assert.ok(f.get('SELECT revoked_at FROM auth_sessions').revoked_at);
    assert.equal([...transport.sessions.values()].every(s => !s.live), true);
  });
  test('logout without a session is safe and idempotent', async () => {
    for (let i = 0; i < 2; i++) { const out = await logout.POST(request('logout')); assert.equal(out.status, 200); assert.equal(out.headers.getSetCookie().length, 2); }
  });
  test('idle sessions expire after 30 minutes and absolute sessions after 12 hours', async () => {
    const a = person('alice'), response = await signIn(a), token = cookiePair(response, auth.ACCESS_COOKIE);
    f.run('UPDATE auth_sessions SET last_seen=?', Math.floor(Date.now() / 1000) - 1801); await rejectsStatus(convex.convexVerifyIdentity(token), 401);
    f.run('UPDATE auth_sessions SET last_seen=?,created_at=?', Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) - 43201); await rejectsStatus(convex.convexVerifyIdentity(token), 401);
  });
  test('removing a binding or deactivating the employee takes effect on the next request', async () => {
    const a = person('alice'), response = await signIn(a), token = cookiePair(response, auth.ACCESS_COOKIE);
    f.run('UPDATE employee_identities SET enabled=0'); await rejectsStatus(convex.convexVerifyIdentity(token), 403);
    f.run('UPDATE employee_identities SET enabled=1'); assert.equal((await convex.convexVerifyIdentity(token)).employee.id, a.row.id);
    f.run('UPDATE employees SET active=0 WHERE id=?', a.row.id); await rejectsStatus(convex.convexVerifyIdentity(token), 403);
  });
  test('a reset cutoff blocks a sign-in that registers after it', async () => {
    const a = person('alice'); f.run('INSERT INTO auth_password_resets (issuer,subject,not_before,locked) VALUES (?,?,?,0)', SITE, a.userId, Math.floor(Date.now() / 1000) + 5);
    assert.equal((await signIn(a)).status, 401); assert.equal(f.get('SELECT COUNT(*) n FROM auth_sessions').n, 0);
    f.run('UPDATE auth_password_resets SET not_before=0,locked=1'); assert.equal((await signIn(a)).status, 401);
  });
});

describe('owner bootstrap', () => {
  const OWNER_ID = '00000000-0000-4000-8000-0000000000a1';
  const owner = (role = 'admin') => { const row = f.employee(OWNER_ID, { role, email: 'owner@example.test' }), userId = rand(32); transport.accounts.set(row.email, { userId, password: GOOD_PASSWORD, code: null }); return { row, userId, email: row.email }; };
  test('the approved owner is bound once, with one audit entry', async () => {
    const o = owner(); Object.assign(f.env, { UFS_CONVEX_OWNER_SUB: o.userId, UFS_CONVEX_OWNER_EMPLOYEE_ID: OWNER_ID });
    for (let i = 0; i < 2; i++) assert.equal((await signIn(o)).status, 200);
    const binding = f.get('SELECT * FROM employee_identities');
    assert.equal(binding.subject, o.userId); assert.equal(binding.issuer, SITE); assert.equal(binding.employee_id, OWNER_ID); assert.equal(binding.approved_by, 'explicit-owner-runtime-approval');
    assert.equal(f.get('SELECT COUNT(*) n FROM employee_identities').n, 1);
    assert.equal(f.get("SELECT COUNT(*) n FROM audit WHERE action='Bound approved standalone owner identity'").n, 1);
  });
  for (const [label, config] of [
    ["a different user id", () => ({ UFS_CONVEX_OWNER_SUB: rand(32), UFS_CONVEX_OWNER_EMPLOYEE_ID: OWNER_ID })],
    ['no employee id', o => ({ UFS_CONVEX_OWNER_SUB: o.userId })],
    ['an employee id that is not a UUID', o => ({ UFS_CONVEX_OWNER_SUB: o.userId, UFS_CONVEX_OWNER_EMPLOYEE_ID: 'owner-admin' })],
  ]) test(`binds nothing with ${label}`, async () => {
    const o = owner(); Object.assign(f.env, config(o));
    assert.equal((await signIn(o)).status, 403); assert.equal(f.get('SELECT COUNT(*) n FROM employee_identities').n, 0);
  });
  test('a target that is not an administrator is never bound', async () => {
    const o = owner('employee'); Object.assign(f.env, { UFS_CONVEX_OWNER_SUB: o.userId, UFS_CONVEX_OWNER_EMPLOYEE_ID: OWNER_ID });
    assert.equal((await signIn(o)).status, 403); assert.equal(f.get('SELECT COUNT(*) n FROM employee_identities').n, 0);
  });
  test('an existing disabled binding is never replaced or re-enabled', async () => {
    const o = owner(); f.run('INSERT INTO employee_identities (id,issuer,subject,employee_id,enabled,created_at,approved_by) VALUES (?,?,?,?,0,?,?)', crypto.randomUUID(), SITE, o.userId, OWNER_ID, '2026-01-01T00:00:00Z', 'reviewer');
    Object.assign(f.env, { UFS_CONVEX_OWNER_SUB: o.userId, UFS_CONVEX_OWNER_EMPLOYEE_ID: OWNER_ID });
    assert.equal((await signIn(o)).status, 403); assert.equal(f.get('SELECT enabled FROM employee_identities').enabled, 0);
  });
});

describe('password reset', () => {
  const post = (route, name, body, headers) => route.POST(request(name, body, headers));
  const askFor = email => post(forgot, 'forgot-password', { email });
  const complete = (who, code, extra = {}) => post(reset, 'reset-password', { email: who.email, code, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD, ...extra });
  beforeEach(() => { f.env.UFS_PASSWORD_RECOVERY = 'enabled'; });

  test('reset is off unless the exact flag is set', async () => {
    for (const value of [undefined, '', 'true', 'ENABLED', 'enabled ']) {
      if (value === undefined) delete f.env.UFS_PASSWORD_RECOVERY; else f.env.UFS_PASSWORD_RECOVERY = value;
      assert.equal((await askFor('a@example.test')).status, 503);
      assert.equal((await complete({ email: 'a@example.test' }, '12345678')).status, 503);
    }
    assert.equal(transport.calls.length, 0);
  });
  test('reset also needs Convex sign-in to be configured', async () => { delete f.env.UFS_CONVEX_URL; assert.equal((await askFor('a@example.test')).status, 503); assert.equal(transport.calls.length, 0); });
  test('asking for a code gives the same answer for eligible, unknown, unbound and inactive addresses', async () => {
    const eligible = person('alice'), unbound = person('unbound', { bind: false }), inactive = person('inactive', { employee: { active: 0 } });
    const answers = [];
    for (const email of [eligible.email, 'nobody@example.test', unbound.email, inactive.email]) { const r = await askFor(email); answers.push([r.status, JSON.stringify(await r.json()), r.headers.getSetCookie().length]); }
    for (const answer of answers.slice(1)) assert.deepEqual(answer, answers[0]);
    assert.equal(answers[0][0], 200); assert.match(answers[0][1], /If an eligible account/);
    assert.deepEqual(transport.resetRequests, [eligible.email]);
  });
  test('the answer takes at least 600 ms so known and unknown addresses are not trivially distinguishable', async () => {
    const eligible = person('alice'), started = Date.now(); await askFor(eligible.email); assert.ok(Date.now() - started >= 600);
  });
  test('a Convex or email failure is hidden from the visitor', async () => {
    const a = person('alice'); transport.accounts.delete(a.email); const r = await askFor(a.email); assert.equal(r.status, 200);
    transport.down = true; assert.equal((await askFor(a.email)).status, 200);
  });
  test('the test-scope employee is never sent a code', async () => {
    const a = person('qa', { employee: { data_scope: 'qa-bots-v1' } }); await askFor(a.email); assert.deepEqual(transport.resetRequests, []);
  });
  for (const [label, body] of [['no email', {}], ['bad email', { email: 'nope' }], ['oversized', { email: `${'a'.repeat(250)}@example.test` }], ['non-string', { email: 5 }]]) {
    test(`asking for a code rejects ${label}`, async () => { assert.equal((await post(forgot, 'forgot-password', body)).status, 400); assert.equal(transport.calls.length, 0); });
  }
  for (const [reason, headers] of [['missing origin', { origin: '' }], ['foreign origin', { origin: 'https://attacker.example.test' }], ['cross-site fetch', { 'sec-fetch-site': 'cross-site' }]]) {
    for (const [name, route] of [['forgot-password', forgot], ['reset-password', reset]]) test(`${name} rejects CSRF: ${reason}`, async () => { assert.equal((await post(route, name, { email: 'a@example.test' }, headers)).status, 403); assert.equal(transport.calls.length, 0); });
  }
  test('both reset endpoints refuse non-JSON bodies', async () => {
    for (const [name, route] of [['forgot-password', forgot], ['reset-password', reset]]) assert.equal((await post(route, name, {}, { 'content-type': 'text/plain' })).status, 415);
  });

  test('a valid code changes the password, ends every session and signs nobody in', async () => {
    const a = person('alice'), old = await signIn(a), oldToken = cookiePair(old, auth.ACCESS_COOKIE);
    await askFor(a.email); const code = a.account.code;
    const response = await complete(a, code); assert.equal(response.status, 200);
    const body = await bodyOf(response); assert.deepEqual(body, { ok: true, requiresSignIn: true, sessionRevocationPending: false });
    const cookies = response.headers.getSetCookie(); assert.equal(cookies.length, 2); assert.ok(cookies.every(value => value.includes('Max-Age=0')));
    assert.equal(a.account.password, NEW_PASSWORD); assert.equal([...transport.sessions.values()].every(s => !s.live), true);
    assert.ok(f.get('SELECT revoked_at FROM auth_sessions').revoked_at); await rejectsStatus(convex.convexVerifyIdentity(oldToken), 401);
    assert.equal(f.get('SELECT locked FROM auth_password_resets WHERE subject=?', a.userId).locked, 0);
    assert.doesNotMatch(JSON.stringify(body), new RegExp(`${code}|${NEW_PASSWORD}`));
  });
  test('after a reset the new password works and the old one does not', async () => {
    const a = person('alice'); await askFor(a.email); await complete(a, a.account.code);
    assert.equal((await signIn(a, GOOD_PASSWORD)).status, 401);
    Date.now = () => originalNow() + 3000; assert.equal((await signIn(a, NEW_PASSWORD)).status, 200);
  });
  test('a code works only once and spaces in it are ignored', async () => {
    const a = person('alice'); await askFor(a.email); const code = a.account.code;
    assert.equal((await complete(a, `${code.slice(0, 4)} ${code.slice(4)}`)).status, 200);
    assert.equal((await complete(a, code)).status, 400);
  });
  test('a wrong code changes nothing and does not lock the real owner out', async () => {
    const a = person('alice'), session = await signIn(a); await askFor(a.email);
    const response = await complete(a, '00000000'); assert.equal(response.status, 400); assert.match((await bodyOf(response)).error, /invalid, expired, or already used/);
    assert.equal(a.account.password, GOOD_PASSWORD); assert.equal(f.get('SELECT COUNT(*) n FROM auth_password_resets').n, 0); assert.equal(f.get('SELECT revoked_at FROM auth_sessions').revoked_at, null);
    assert.equal((await asCookies(cookiesOf(session), () => server.currentEmployee())).id, a.row.id);
  });
  test('unknown, unbound and test-scope addresses get the same failure and Convex is not asked', async () => {
    const unbound = person('unbound', { bind: false }), qa = person('qa', { employee: { data_scope: 'qa-bots-v1' } }), results = [];
    for (const who of [{ email: 'nobody@example.test' }, unbound, qa]) { const r = await complete(who, '12345678'); results.push([r.status, JSON.stringify(await r.json())]); }
    for (const r of results) assert.deepEqual(r, [400, results[0][1]]);
    assert.equal(convexCalls().length, 0);
  });
  for (const [label, extra] of [['too short', { password: 'short', confirmPassword: 'short' }], ['over 72 bytes', { password: 'p'.repeat(73), confirmPassword: 'p'.repeat(73) }], ['multibyte over 72 bytes', { password: 'é'.repeat(37), confirmPassword: 'é'.repeat(37) }], ['not confirmed', { confirmPassword: 'something-else-entirely' }], ['missing', { password: undefined, confirmPassword: undefined }]]) {
    test(`rejects a ${label} password before contacting Convex`, async () => {
      const a = person('alice'); assert.equal((await complete(a, '12345678', extra)).status, 400); assert.equal(convexCalls().length, 0);
    });
  }
  for (const [label, code] of [['too short', '1234567'], ['too long', '123456789'], ['letters', 'abcdefgh'], ['number', 12345678], ['empty', '']]) {
    test(`rejects a code that is ${label}`, async () => { const a = person('alice'); assert.equal((await complete(a, code)).status, 400); assert.equal(convexCalls().length, 0); });
  }
  test('a code that produces a session for a different account is refused and ended', async () => {
    const a = person('alice'), b = person('bob'); await askFor(a.email); transport.forceUserId = b.userId;
    assert.equal((await complete(a, a.account.code)).status, 400);
    assert.equal(f.get('SELECT COUNT(*) n FROM auth_password_resets').n, 0); assert.equal([...transport.sessions.values()].filter(s => s.userId === b.userId).every(s => !s.live), true);
  });
  test('if Convex cannot confirm the sign-out the visitor is told, and the app sessions are still revoked', async () => {
    const a = person('alice'); await signIn(a); await askFor(a.email); const code = a.account.code;
    const realFetch = globalThis.fetch; globalThis.fetch = async (input, init) => { if (JSON.parse(init?.body ?? 'null')?.path === 'auth:signOut') return Response.json({ status: 'error', errorMessage: 'x' }); return realFetch(input, init); };
    const response = await complete(a, code); assert.equal(response.status, 200); assert.equal((await bodyOf(response)).sessionRevocationPending, true);
    assert.ok(f.get('SELECT revoked_at FROM auth_sessions').revoked_at);
  });
  test('the reset endpoints are rate limited', async () => {
    const a = person('alice');
    for (let i = 0; i < 10; i++) assert.equal((await complete(a, '00000000')).status, 400);
    assert.equal((await complete(a, '00000000')).status, 429);
  });
});
