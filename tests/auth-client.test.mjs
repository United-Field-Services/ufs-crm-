// Client session orchestration only. Synthetic Fetch responses; no browser or provider network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './harness.mjs';
const { apiFetch, refreshEmployeeSession, signOutEmployee } = await import('../lib/auth-fetch.ts');
let originalFetch, previousWindow, calls, navigations, handle;
const response = (body, status = 200) => Response.json(body, { status });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => {
  originalFetch = globalThis.fetch; previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'); calls = []; navigations = [];
  Object.defineProperty(globalThis, 'window', { value: { location: { replace: path => navigations.push(path) } }, configurable: true, writable: true });
  handle = async () => response({ ok: true });
  globalThis.fetch = async (input, init) => { calls.push({ input, init }); return handle(input, init); };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
});

test('API requests always use same-origin credentials and disable cache', async () => {
  const result = await apiFetch('/api/state', { credentials: 'include', cache: 'force-cache', headers: { 'x-synthetic': 'test' } });
  assert.equal(result.status, 200); assert.equal(calls.length, 1); assert.equal(calls[0].init.credentials, 'same-origin'); assert.equal(calls[0].init.cache, 'no-store'); assert.deepEqual(calls[0].init.headers, { 'x-synthetic': 'test' });
});
for (const status of [200, 400, 403, 404, 409, 429, 500, 503]) test(`HTTP ${status} never triggers refresh or replay`, async () => {
  handle = async () => response({ status }, status); const result = await apiFetch('/api/action', { method: 'POST', body: '{"synthetic":true}' });
  assert.equal(result.status, status); assert.equal(calls.length, 1);
});
test('network failure propagates without silently replaying a mutation', async () => {
  handle = async () => { throw new Error('Synthetic connection failure'); }; await assert.rejects(apiFetch('/api/action', { method: 'POST', body: '{}' }), /Synthetic connection failure/); assert.equal(calls.length, 1);
});
test('expired API session refreshes once and replays one identical JSON mutation', async () => {
  let mutations = 0; handle = async path => path === '/api/auth/refresh' ? response({ authenticated: true }) : response({ ok: true }, ++mutations === 1 ? 401 : 200);
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"synthetic"}' };
  assert.equal((await apiFetch('/api/action', options)).status, 200);
  assert.deepEqual(calls.map(call => call.input), ['/api/action', '/api/auth/refresh', '/api/action']); assert.deepEqual(calls[0].init, calls[2].init);
  const refresh = calls[1].init; assert.equal(refresh.method, 'POST'); assert.equal(refresh.credentials, 'same-origin'); assert.equal(refresh.cache, 'no-store'); assert.equal(refresh.redirect, 'error'); assert.equal(refresh.body, '{}');
});
test('second API 401 returns to caller instead of an infinite refresh loop', async () => {
  handle = async path => path === '/api/auth/refresh' ? response({ authenticated: true }) : response({ error: 'Synthetic expired session' }, 401);
  assert.equal((await apiFetch('/api/action', { method: 'POST', body: '{}' })).status, 401); assert.equal(calls.length, 3);
});
for (const [label, refreshResult] of [
  ['unauthorized', () => response({ error: 'Synthetic revoked session' }, 401)],
  ['rate limited', () => response({ error: 'Synthetic throttling' }, 429)],
  ['unavailable', () => response({ error: 'Synthetic unavailable' }, 503)],
  ['not authenticated', () => response({ authenticated: false })],
  ['missing authenticated flag', () => response({ ok: true })],
  ['non-boolean authenticated flag', () => response({ authenticated: 'true' })],
  ['malformed JSON', () => new Response('synthetic invalid JSON', { status: 200 })],
  ['network exception', () => { throw new Error('Synthetic transport failure'); }],
]) test(`refresh ${label} cannot replay a protected operation`, async () => {
  handle = async path => path === '/api/auth/refresh' ? refreshResult() : response({ error: 'Synthetic not authorized' }, 401);
  assert.equal((await apiFetch('/api/action', { method: 'POST', body: '{}' })).status, 401); assert.equal(calls.length, 2);
});
test('twenty simultaneous 401 responses share one in-flight refresh', async () => {
  const gate = deferred(), attempts = new Map();
  handle = async path => {
    if (path === '/api/auth/refresh') return gate.promise;
    const count = (attempts.get(path) ?? 0) + 1; attempts.set(path, count); return response({ ok: true }, count === 1 ? 401 : 200);
  };
  const work = Promise.all(Array.from({ length: 20 }, (_, i) => apiFetch(`/api/synthetic-${i}`)));
  await new Promise(setImmediate); assert.equal(calls.filter(call => call.input === '/api/auth/refresh').length, 1);
  gate.resolve(response({ authenticated: true })); const results = await work; assert.ok(results.every(result => result.status === 200));
  assert.equal(calls.filter(call => call.input === '/api/auth/refresh').length, 1); assert.ok([...attempts.values()].every(count => count === 2));
});
test('failed shared refresh is cleared, allowing a later explicit retry', async () => {
  let refreshes = 0; handle = async path => path === '/api/auth/refresh' ? response({ authenticated: ++refreshes > 1 }, refreshes === 1 ? 503 : 200) : response({ error: 'Synthetic unavailable' }, 401);
  assert.equal(await refreshEmployeeSession(), false); assert.equal(await refreshEmployeeSession(), true); assert.equal(refreshes, 2);
});
test('multipart form replay preserves the same synthetic file after refresh', async () => {
  const bodies = []; let requests = 0;
  handle = async (path, init) => {
    if (path === '/api/auth/refresh') return response({ authenticated: true });
    const consumed = new Request('https://synthetic.invalid/api/files', init); const data = await consumed.formData(); bodies.push({ folder: data.get('folder'), text: await data.get('file').text() });
    return response({ ok: true }, ++requests === 1 ? 401 : 200);
  };
  const form = new FormData(); form.set('folder', 'Synthetic folder'); form.set('file', new File(['synthetic file bytes'], 'synthetic.txt'));
  assert.equal((await apiFetch('/api/files', { method: 'POST', body: form })).status, 200); assert.deepEqual(bodies, [{ folder: 'Synthetic folder', text: 'synthetic file bytes' }, { folder: 'Synthetic folder', text: 'synthetic file bytes' }]);
});
test('Request-object POST can be safely replayed after its first body is consumed', async () => {
  let requests = 0; const bodies = [];
  handle = async input => {
    if (input === '/api/auth/refresh') return response({ authenticated: true });
    assert.ok(input instanceof Request); bodies.push(await input.text()); return response({ ok: true }, ++requests === 1 ? 401 : 200);
  };
  const request = new Request('https://synthetic.invalid/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"synthetic":true}' });
  assert.equal((await apiFetch(request)).status, 200); assert.deepEqual(bodies, ['{"synthetic":true}', '{"synthetic":true}']);
});
test('successful sign-out uses same-origin POST and fixed login destination', async () => {
  await signOutEmployee(); assert.equal(calls.length, 1); assert.equal(calls[0].input, '/api/auth/logout'); assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.credentials, 'same-origin'); assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.cache, 'no-store'); assert.deepEqual(navigations, ['/login']);
});
test('failed sign-out never pretends completion or navigates away', async () => {
  handle = async () => response({ error: 'Synthetic failure' }, 503); await assert.rejects(signOutEmployee(), /Sign-out could not be completed/); assert.deepEqual(navigations, []); assert.equal(calls.length, 1);
});
