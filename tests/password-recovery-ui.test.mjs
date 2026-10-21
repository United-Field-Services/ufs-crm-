// Synthetic React/JSDOM interaction tests only. No real account, password, email,
// provider request, or network access is used. This does not prove hosted delivery.
import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const rootPath = fileURLToPath(new URL('../', import.meta.url));
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://synthetic.invalid/reset-password' });
const token = 'abc123de'.repeat(8);
const syntheticPassword = 'synthetic-password-only';
const restored = new Map();
let navigations = [], historyCalls = [];
const locationProxy = new Proxy(dom.window.location, {
  get(target, key) {
    if (key === 'assign' || key === 'replace') return path => navigations.push(path);
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
  set(target, key, value) {
    if (key === 'href') { navigations.push(value); return true; }
    return Reflect.set(target, key, value, target);
  },
});
const windowProxy = new Proxy(dom.window, {
  get(target, key) { return key === 'location' ? locationProxy : Reflect.get(target, key, target); },
  set(target, key, value) {
    if (key === 'location') { navigations.push(value); return true; }
    return Reflect.set(target, key, value, target);
  },
});
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'Event', 'MouseEvent', 'localStorage', 'sessionStorage', 'IS_REACT_ACT_ENVIRONMENT', '__ufsRecoveryUiConfigured', 'fetch']) {
  restored.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  if (name === 'fetch') continue;
  const value = name === 'window' ? windowProxy : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === '__ufsRecoveryUiConfigured' ? true : dom.window[name];
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
// Deny unexpected calls even during module import. Test fetch implementations
// below also have no route to the real network.
globalThis.fetch = async () => { throw new Error('Network is denied in synthetic recovery UI tests'); };
const actualReplaceState = dom.window.history.replaceState.bind(dom.window.history);
dom.window.history.replaceState = (...args) => { historyCalls.push(args); return actualReplaceState(...args); };
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '../../lib/password-recovery' && context.parentURL?.endsWith('/app/reset-password/recovery-page.tsx')) return { url: 'ufs-recovery-ui:config', shortCircuit: true };
    if (specifier === '../../lib/auth-provider' && context.parentURL?.endsWith('/app/reset-password/recovery-page.tsx')) return { url: 'ufs-recovery-ui:provider', shortCircuit: true };
    try { return next(specifier, context); } catch (error) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
        for (const extension of ['.tsx', '.ts']) try { return next(specifier + extension, context); } catch {}
      }
      throw error;
    }
  },
  load(url, context, next) {
    if (url === 'ufs-recovery-ui:provider') return { format: 'module', source: "export function authProvider() { return globalThis.__ufsRecoveryUiProvider || 'supabase'; } export function convexRecoveryConfigured() { return globalThis.__ufsRecoveryUiConfigured; }", shortCircuit: true };
    if (url === 'ufs-recovery-ui:config') return { format: 'module', source: 'export function passwordRecoveryConfigured() { return globalThis.__ufsRecoveryUiConfigured; }', shortCircuit: true };
    if (url.startsWith('file:') && fileURLToPath(url).startsWith(rootPath) && !url.includes('/node_modules/')) {
      if (url.endsWith('.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
      if (/\.tsx?$/.test(url)) return { format: 'module', source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});
const { createElement, StrictMode, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { renderToStaticMarkup } = await import('react-dom/server');
const { default: RecoveryForm } = await import('../app/reset-password/recovery-form.tsx');
const { default: ResetPage, metadata: resetMetadata, dynamic: resetDynamic } = await import('../app/reset-password/page.tsx');
const { default: ForgotPage, metadata: forgotMetadata, dynamic: forgotDynamic } = await import('../app/forgot-password/page.tsx');
const { default: ConvexRecoveryForm } = await import('../app/reset-password/convex-recovery-form.tsx');
let calls, responses, container, root, storageBefore, unexpectedCalls;
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
const storageSnapshot = () => [dom.window.localStorage, dom.window.sessionStorage].map(storage => Object.fromEntries(Object.keys(storage).sort().map(key => [key, storage.getItem(key)])));
const endpoint = mode => mode === 'request' ? '/api/auth/forgot-password' : '/api/auth/reset-password';
function useUrl(path) { dom.reconfigure({ url: 'https://synthetic.invalid' + path }); }

beforeEach(() => {
  useUrl('/reset-password?token_hash=' + token);
  navigations = []; historyCalls = []; calls = []; unexpectedCalls = [];
  globalThis.__ufsRecoveryUiConfigured = true;
  dom.window.localStorage.clear(); dom.window.sessionStorage.clear();
  dom.window.localStorage.setItem('existing-local-data', 'synthetic-local-value');
  dom.window.sessionStorage.setItem('existing-session-data', 'synthetic-session-value');
  storageBefore = storageSnapshot();
  responses = new Map([
    ['/api/auth/forgot-password', reply({ ok: true })],
    ['/api/auth/reset-password', reply({ ok: true })],
  ]);
  globalThis.fetch = async (path, init = {}) => {
    calls.push({ path, init, body: init.body ? JSON.parse(init.body) : undefined });
    if (!responses.has(path)) { unexpectedCalls.push(path); throw new Error('Unexpected synthetic request'); }
    const response = responses.get(path);
    return typeof response === 'function' ? response(init) : await response;
  };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  assert.deepEqual(storageSnapshot(), storageBefore, 'Recovery must not mutate either browser storage area');
  assert.deepEqual(unexpectedCalls, [], 'Only explicitly mocked recovery endpoints may be called');
  globalThis.fetch = async () => { throw new Error('Network is denied in synthetic recovery UI tests'); };
});
after(() => {
  hook.deregister(); dom.window.close();
  for (const [name, descriptor] of restored) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
});

async function mount(mode = 'reset', props = {}, strict = false) {
  const form = createElement(RecoveryForm, { mode, authEnabled: true, ...props });
  await act(async () => root.render(strict ? createElement(StrictMode, null, form) : form));
}
const query = selector => container.querySelector(selector);
async function change(selector, value) {
  const control = query(selector); assert.ok(control, 'Expected input ' + selector);
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(control, value);
  await act(async () => control.dispatchEvent(new dom.window.Event('input', { bubbles: true })));
}
async function fill(mode = 'reset', password = syntheticPassword, confirmation = password) {
  if (mode === 'request') await change('#reset-email', 'person@example.invalid');
  else { await change('#new-password', password); await change('#confirm-password', confirmation); }
}
async function submit() { await act(async () => query('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))); }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function assertTokenAbsent() {
  assert.ok(!container.innerHTML.includes(token), 'The token must not appear in DOM markup');
  for (const input of container.querySelectorAll('input')) assert.ok(!input.value.includes(token), 'The token must not appear in a form value');
  assert.equal(query('input[type="hidden"], [name="token_hash"]'), null);
  assert.equal(document.cookie, '');
  assert.deepEqual(storageSnapshot(), storageBefore);
}
function assertPasswordsCleared() {
  for (const selector of ['#new-password', '#confirm-password']) if (query(selector)) assert.equal(query(selector).value, '');
}
function assertSignInOnly() {
  assert.equal(query('a[href="/login"]')?.textContent, 'Back to sign in');
  assert.deepEqual(navigations, []);
  assert.ok(calls.every(call => ['/api/auth/forgot-password', '/api/auth/reset-password'].includes(call.path)));
}

for (const [name, Page, metadata, dynamic] of [['request', ForgotPage, forgotMetadata, forgotDynamic], ['reset', ResetPage, resetMetadata, resetDynamic]]) {
  test(`${name} public GET rendering is data-free, unindexed, no-referrer, and makes no request`, async () => {
    const html = renderToStaticMarkup(await Page());
    assert.match(html, /UFS PEOPLE/); assert.match(html, /href="\/login"/);
    assert.doesNotMatch(html, /<script|<iframe|<img|example\.invalid|token_hash|access_token|refresh_token/);
    assert.ok(!html.includes(token));
    assert.deepEqual(metadata.robots, { index: false, follow: false });
    assert.equal(metadata.referrer, 'no-referrer'); assert.equal(dynamic, 'force-dynamic');
    assert.deepEqual(calls, []); assert.deepEqual(historyCalls, []);
    globalThis.__ufsRecoveryUiConfigured = false;
    assert.match(renderToStaticMarkup(await Page()), /Password reset is not enabled yet/);
  });
}

test('a valid token is captured only in memory, stripped on mount, and not consumed by loading the page', async () => {
  await mount();
  assert.equal(dom.window.location.href, 'https://synthetic.invalid/reset-password');
  assert.deepEqual(historyCalls, [[null, '', '/reset-password']]);
  assert.equal(query('#new-password').disabled, false);
  assertTokenAbsent(); assert.deepEqual(calls, []); assertSignInOnly();
  await fill(); await submit();
  assert.deepEqual(calls[0].body, { token_hash: token, password: syntheticPassword, confirmPassword: syntheticPassword });
  assertTokenAbsent();
});

test('StrictMode effect replay strips the URL only once and retains the in-memory token', async () => {
  await mount('reset', {}, true);
  assert.equal(historyCalls.length, 1); assert.deepEqual(calls, []); assertTokenAbsent();
  await fill(); await submit(); assert.equal(calls.length, 1); assert.equal(calls[0].body.token_hash, token);
});

for (const [label, suffix] of [
  ['missing token', ''],
  ['empty token', '?token_hash='],
  ['duplicate token', `?token_hash=${token}&token_hash=${token}`],
  ['second different token', `?token_hash=${token}&token_hash=${'b'.repeat(64)}`],
  ['arbitrary query', `?token_hash=${token}&unexpected=private-value`],
  ['redirect query', `?token_hash=${token}&next=https%3A%2F%2Funtrusted.invalid`],
  ['recovery type query', `?token_hash=${token}&type=recovery`],
  ['wrong token parameter', `?token=${token}`],
  ['short token', '?token_hash=' + 'a'.repeat(31)],
  ['long token', '?token_hash=' + 'a'.repeat(257)],
  ['nonhex token', '?token_hash=' + 'g'.repeat(64)],
  ['whitespace token', `?token_hash=%20${token}`],
  ['fragment token', '#token_hash=' + token],
  ['fragment plus valid query', `?token_hash=${token}#access_token=synthetic-fragment`],
  ['provider error fragment', '#error_description=private-provider-detail'],
]) {
  test(`${label} fails closed and removes all query/fragment content without a request`, async () => {
    useUrl('/reset-password' + suffix); await mount();
    assert.equal(dom.window.location.href, 'https://synthetic.invalid/reset-password');
    assert.deepEqual(historyCalls, [[null, '', '/reset-password']]);
    assert.match(query('[role="alert"]').textContent, /invalid|missing/i);
    assert.equal(document.activeElement, query('[role="alert"]'));
    assert.doesNotMatch(container.textContent, /private-value|untrusted|synthetic-fragment|private-provider-detail/);
    for (const control of container.querySelectorAll('input, button')) assert.equal(control.disabled, true);
    assert.equal(query('a[href="/forgot-password"]')?.textContent, 'Request a new reset link');
    await submit(); assert.deepEqual(calls, []); assertTokenAbsent(); assertSignInOnly();
  });
}

for (const length of [32, 256]) {
  test(`a valid ${length}-character uppercase hex token is accepted without persistence`, async () => {
    const value = 'ABCDEF01'.repeat(length / 8); useUrl('/reset-password?token_hash=' + value);
    await mount(); await fill(); await submit();
    assert.equal(calls[0].body.token_hash, value); assert.ok(!container.innerHTML.includes(value));
    assert.equal(dom.window.location.search, ''); assert.deepEqual(storageSnapshot(), storageBefore);
  });
}

for (const mode of ['request', 'reset']) {
  test(`${mode} form load performs no session check or recovery request`, async () => {
    if (mode === 'request') useUrl('/forgot-password');
    await mount(mode); assert.deepEqual(calls, []); assertSignInOnly(); assertTokenAbsent();
    assert.equal(query('form').getAttribute('aria-busy'), 'false');
  });

  test(`${mode} is unavailable when auth is not configured and cannot submit`, async () => {
    await mount(mode, { authEnabled: false });
    assert.match(query('[role="status"]').textContent, /not enabled yet/);
    for (const control of container.querySelectorAll('input, button')) assert.equal(control.disabled, true);
    await submit(); assert.deepEqual(calls, []); assertSignInOnly(); assertTokenAbsent();
  });

  test(`${mode} rapid clicks and same-batch submits send one same-origin JSON POST`, async () => {
    const pending = deferred(); responses.set(endpoint(mode), pending.promise);
    await mount(mode); await fill(mode);
    if (mode === 'request') await change('#reset-email', '  person@example.invalid  ');
    const form = query('form'), button = query('button[type="submit"]');
    await act(async () => {
      button.click(); button.click();
      for (let index = 0; index < 2; index++) form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(calls.length, 1); assert.equal(calls[0].path, endpoint(mode));
    assert.deepEqual(calls[0].body, mode === 'request' ? { email: 'person@example.invalid' } : { token_hash: token, password: syntheticPassword, confirmPassword: syntheticPassword });
    const options = calls[0].init;
    assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Accept, 'application/json'); assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(form.getAttribute('aria-busy'), 'true');
    for (const control of form.querySelectorAll('input, button')) assert.equal(control.disabled, true);
    assertPasswordsCleared(); assertTokenAbsent();
    await submit(); assert.equal(calls.length, 1);
    await act(async () => pending.resolve(reply({ ok: true, authenticated: true, redirect: 'https://untrusted.invalid/' })));
    assert.equal(query('form'), null); assert.ok(query('[role="status"]'));
    assert.doesNotMatch(container.textContent, /untrusted/); assertSignInOnly(); assertTokenAbsent();
    // A stale form event after success cannot send a second request.
    await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(calls.length, 1);
  });

  for (const status of [400, 401, 403, 410, 429, 500, 503]) {
    test(`${mode} HTTP ${status} is generic, focused, clears passwords, and allows a deliberate retry`, async () => {
      responses.set(endpoint(mode), reply({ ok: false, error: 'Sensitive provider response for existing account' }, status));
      await mount(mode); await fill(mode); await submit();
      const alert = query('[role="alert"]'); assert.ok(alert);
      assert.doesNotMatch(container.textContent, /Sensitive provider|existing account/);
      if (status === 429) assert.match(alert.textContent, /Too many|wait|try again later/i);
      assert.equal(document.activeElement, alert); assert.equal(query('form').getAttribute('aria-busy'), 'false');
      for (const input of container.querySelectorAll('input')) assert.equal(input.disabled, false);
      assertPasswordsCleared(); assertSignInOnly(); assertTokenAbsent();
      if (mode === 'reset') { await submit(); assert.equal(calls.length, 1); }
      responses.set(endpoint(mode), reply({ ok: true })); await fill(mode); await submit();
      assert.equal(calls.length, 2); assert.equal(query('[role="alert"]'), null); assert.ok(query('[role="status"]'));
      assertSignInOnly();
    });
  }

  for (const failure of ['network', 'json']) {
    test(`${mode} ${failure} failure hides exception details and remains retryable`, async () => {
      const fail = () => { throw new Error('Sensitive provider detail ' + token); };
      responses.set(endpoint(mode), failure === 'network' ? fail : { ok: true, status: 200, json: fail });
      await mount(mode); await fill(mode); await submit();
      assert.ok(query('[role="alert"]'));
      assert.doesNotMatch(container.textContent, /Sensitive provider detail/);
      assertTokenAbsent(); assertPasswordsCleared(); assertSignInOnly();
      assert.equal(query('form').getAttribute('aria-busy'), 'false');
      responses.set(endpoint(mode), reply({ ok: true })); await fill(mode); await submit();
      assert.equal(calls.length, 2); assert.ok(query('[role="status"]')); assert.equal(query('[role="alert"]'), null);
    });
  }

  for (const body of [null, [], 'private-provider-detail', true, 1, {}, { ok: false }, { ok: 'true' }, { ok: 1 }, { authenticated: true }]) {
    test(`${mode} rejects malformed success body ${JSON.stringify(body)}`, async () => {
      responses.set(endpoint(mode), reply(body)); await mount(mode); await fill(mode); await submit();
      assert.ok(query('[role="alert"]')); assert.ok(query('form')); assert.equal(query('[role="status"]'), null);
      assert.doesNotMatch(container.textContent, /private-provider-detail/);
      assert.equal(query('form').getAttribute('aria-busy'), 'false'); assertPasswordsCleared(); assertSignInOnly();
    });
  }

  for (const outcome of ['success', 'http-error', 'network-error']) {
    test(`unmounted ${mode} ignores late ${outcome} without stale effects in a new form`, async () => {
      const pending = deferred(); responses.set(endpoint(mode), pending.promise);
      await mount(mode); await fill(mode); await submit();
      assert.equal(calls.length, 1); assertPasswordsCleared();
      await act(async () => root.render(null)); assert.equal(container.innerHTML, '');
      useUrl('/forgot-password'); await mount('request');
      const nextForm = container.innerHTML;
      await act(async () => {
        if (outcome === 'network-error') pending.reject(new Error('Sensitive late provider detail'));
        else pending.resolve(reply({ ok: outcome === 'success', error: 'Sensitive late provider detail' }, outcome === 'success' ? 200 : 503));
      });
      assert.equal(container.innerHTML, nextForm); assert.equal(query('[role="alert"]'), null);
      assert.equal(query('[role="status"]'), null); assert.equal(query('button').disabled, false);
      assert.equal(calls.length, 1); assertTokenAbsent(); assertSignInOnly();
    });
  }
}

test('request success stays generic and leads to a fresh manual sign-in', async () => {
  await mount('request'); await fill('request'); await submit();
  assert.match(query('[role="status"]').textContent, /If an eligible account matches that email/);
  assert.match(query('[role="status"]').textContent, /inbox and spam/i);
  assert.doesNotMatch(container.textContent, /person@example\.invalid/); assert.equal(query('form'), null); assertSignInOnly();
});

test('reset success requires fresh sign-in and never follows supplied login/session data', async () => {
  responses.set(endpoint('reset'), reply({ ok: true, authenticated: true, access_token: 'synthetic-provider-token', redirect: 'https://untrusted.invalid/' }));
  await mount(); await fill(); await submit();
  assert.match(query('[role="status"]').textContent, /password has been changed.*Sign in/i);
  assert.equal(query('form'), null); assert.equal(query('a[href="/forgot-password"]'), null);
  assert.doesNotMatch(container.innerHTML, /synthetic-provider-token|untrusted/); assertSignInOnly(); assertTokenAbsent();
});

test('partial provider cleanup success truthfully explains the remaining session cleanup', async () => {
  responses.set(endpoint('reset'), reply({ ok: true, sessionRevocationPending: true }));
  await mount(); await fill(); await submit();
  assert.match(query('[role="status"]').textContent, /password changed.*workspace sessions were ended/i);
  assert.match(query('[role="status"]').textContent, /cleanup could not be confirmed.*administrator/i);
  assertSignInOnly();
});

for (const [label, password, confirmation] of [
  ['empty', '', ''], ['11 characters', 'a'.repeat(11), 'a'.repeat(11)],
  ['129 characters', 'a'.repeat(129), 'a'.repeat(129)],
  ['mismatch', syntheticPassword, 'different-synthetic-password'],
  ['missing confirmation', syntheticPassword, ''],
]) {
  test(`reset ${label} validation prevents any request`, async () => {
    await mount(); await fill('reset', password, confirmation); await submit();
    assert.deepEqual(calls, []); assert.match(query('[role="alert"]').textContent, /12.*128.*identically/i);
    assert.equal(document.activeElement, query('[role="alert"]')); assert.equal(query('form').getAttribute('aria-busy'), 'false');
    assertSignInOnly(); assertTokenAbsent();
  });
}
for (const length of [12, 128]) {
  test(`reset accepts the ${length}-character password boundary`, async () => {
    await mount(); await fill('reset', 'a'.repeat(length)); await submit();
    assert.equal(calls.length, 1); assert.equal(calls[0].body.password.length, length); assert.equal(calls[0].body.confirmPassword.length, length);
    assert.ok(query('[role="status"]')); assertSignInOnly();
  });
}

test('forms expose labelled controls, correct autocomplete, and no credential persistence code', async () => {
  await mount();
  const inputs = [...container.querySelectorAll('input')];
  assert.deepEqual(inputs.map(input => input.name), ['password', 'confirmPassword']);
  for (const input of inputs) {
    assert.equal(input.type, 'password'); assert.equal(input.autocomplete, 'new-password');
    assert.equal(input.minLength, 12); assert.equal(input.maxLength, 128); assert.equal(input.required, true);
    assert.equal(input.tabIndex, 0); assert.ok(query(`label[for="${input.id}"]`));
  }
  await act(async () => root.render(null)); await mount('request');
  assert.equal(query('#reset-email').type, 'email'); assert.equal(query('#reset-email').autocomplete, 'username');
  assert.equal(query('#reset-email').required, true); assert.equal(query('#reset-email').maxLength, 254);
  assert.ok(query('label[for="reset-email"]'));
  const source = readFileSync(new URL('../app/reset-password/recovery-form.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.|dangerouslySetInnerHTML|document\.cookie/);
});

// ---- Convex Auth provider: emailed-code reset, one question per screen (the Supabase link flow above is unchanged) ----
const convexPassword = 'synthetic-new-passphrase-9';
async function mountConvex(mode = 'request', props = {}) {
  await act(async () => root.render(createElement(ConvexRecoveryForm, { mode, authEnabled: true, ...props })));
}
const stepOf = () => query('[data-stage]').getAttribute('data-stage');
async function toCodeStep() { await mountConvex('request'); await change('#convex-reset-email', 'person@example.invalid'); await submit(); }
async function toPasswordStep(code = '1234 5678') { await toCodeStep(); await change('#convex-reset-code', code); await submit(); }
async function typePasswords(password = convexPassword, confirmation = password) { await change('#convex-new-password', password); await change('#convex-confirm-password', confirmation); }

for (const [name, Page] of [['request', ForgotPage], ['reset', ResetPage]]) {
  test(`${name} page shows the emailed-code form only when the Convex provider is selected`, async () => {
    globalThis.__ufsRecoveryUiProvider = 'convex';
    try {
      const html = renderToStaticMarkup(await Page());
      assert.match(html, name === 'request' ? /Send reset code/ : /8-digit code/);
      assert.match(html, /STEP (1|2) OF 3/);
      assert.doesNotMatch(html, /token_hash|<script|<img/);
    } finally { delete globalThis.__ufsRecoveryUiProvider; }
    assert.doesNotMatch(renderToStaticMarkup(await Page()), /8-digit code|Send reset code/);
  });
}

test('convex: step 1 asks only for the email, sends it trimmed, and moves to the code step', async () => {
  await mountConvex('request');
  assert.equal(stepOf(), 'email'); assert.match(query('.ufs-login-form-eyebrow').textContent, /STEP 1 OF 3/);
  assert.equal(query('#convex-reset-code'), null); assert.equal(query('#convex-new-password'), null);
  await change('#convex-reset-email', '  person@example.invalid  '); await submit();
  assert.deepEqual(calls.map(call => call.path), ['/api/auth/forgot-password']); assert.deepEqual(calls[0].body, { email: 'person@example.invalid' });
  assert.equal(calls[0].init.credentials, 'same-origin'); assert.equal(calls[0].init.cache, 'no-store'); assert.equal(calls[0].init.redirect, 'error');
  assert.equal(stepOf(), 'code'); assert.match(query('.ufs-login-form-eyebrow').textContent, /STEP 2 OF 3/);
  assert.match(query('[role="status"]').textContent, /If an eligible account matches that email/);
  assert.equal(query('#convex-reset-email'), null); assert.equal(query('#convex-new-password'), null);
});

test('convex: step 2 takes only the code, with one-time-code hints, and sends nothing yet', async () => {
  await toCodeStep(); const before = calls.length;
  assert.equal(query('#convex-reset-code').autocomplete, 'one-time-code'); assert.equal(query('#convex-reset-code').inputMode, 'numeric'); assert.equal(query('#convex-new-password'), null);
  await change('#convex-reset-code', '1234 5678'); await submit();
  assert.equal(calls.length, before); assert.equal(stepOf(), 'password'); assert.match(query('.ufs-login-form-eyebrow').textContent, /STEP 3 OF 3/);
  assert.equal(query('#convex-new-password').autocomplete, 'new-password'); assert.equal(query('#convex-confirm-password').type, 'password'); assert.equal(query('#convex-reset-code'), null);
});

test('convex: the reset page starts at the code step and also asks for the email', async () => {
  await mountConvex('reset');
  assert.equal(stepOf(), 'code'); assert.ok(query('#convex-reset-email-2')); assert.ok(query('#convex-reset-code'));
  await change('#convex-reset-code', '12345678'); await submit();
  assert.match(query('[role="alert"]').textContent, /Enter your work email/); assert.equal(stepOf(), 'code'); assert.equal(calls.length, 0);
  await change('#convex-reset-email-2', 'person@example.invalid'); await submit(); assert.equal(stepOf(), 'password');
});

for (const [label, code] of [['too short', '1234567'], ['too long', '123456789'], ['letters', 'abcdefgh'], ['empty', '']]) {
  test(`convex: a code that is ${label} is rejected on step 2 without any request`, async () => {
    await toCodeStep(); const before = calls.length; await change('#convex-reset-code', code); await submit();
    assert.match(query('[role="alert"]').textContent, /8-digit code/); assert.equal(stepOf(), 'code'); assert.equal(calls.length, before);
  });
}

for (const [label, password, confirmation, message] of [
  ['a short password', 'short', 'short', /between 12 and 72/],
  ['a password over 72 characters', 'p'.repeat(73), 'p'.repeat(73), /between 12 and 72/],
  ['passwords that differ', convexPassword, 'something-else-entirely', /identically twice/],
]) {
  test(`convex: ${label} is caught on step 3 without any request`, async () => {
    await toPasswordStep(); const before = calls.length; await typePasswords(password, confirmation); await submit();
    assert.match(query('[role="alert"]').textContent, message); assert.equal(stepOf(), 'password'); assert.equal(calls.length, before);
  });
}

test('convex: saving sends email, code and password once, clears the fields and asks for sign-in', async () => {
  const gate = deferred(); responses.set('/api/auth/reset-password', gate.promise);
  await toPasswordStep(); await typePasswords(); await submit(); await submit();
  const posts = calls.filter(call => call.path === '/api/auth/reset-password');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, { email: 'person@example.invalid', code: '12345678', password: convexPassword, confirmPassword: convexPassword });
  assert.equal(query('#convex-new-password').value, ''); assert.equal(query('#convex-confirm-password').value, '');
  await act(async () => gate.resolve(reply({ ok: true, requiresSignIn: true, sessionRevocationPending: false })));
  assert.equal(stepOf(), 'done'); assert.match(query('[role="status"]').textContent, /Your password changed\. Other devices were signed out/);
  assert.equal(query('form'), null); assert.equal(query('a[href="/login"]').textContent, 'Go to sign in'); assert.deepEqual(navigations, []);
  assert.ok(!container.innerHTML.includes('12345678')); assert.ok(!container.innerHTML.includes(convexPassword));
});

test('convex: an unconfirmed sign-out is reported honestly', async () => {
  responses.set('/api/auth/reset-password', reply({ ok: true, sessionRevocationPending: true }));
  await toPasswordStep(); await typePasswords(); await submit();
  assert.equal(stepOf(), 'done'); assert.match(query('[role="status"]').textContent, /signing out other devices could not be confirmed/);
});

for (const status of [400, 500]) {
  test(`convex: a rejected code (${status}) sends the person back to step 2 and clears everything typed`, async () => {
    responses.set('/api/auth/reset-password', reply({ error: 'Sensitive provider detail 99887766' }, status));
    await toPasswordStep(); await typePasswords(); await submit();
    assert.equal(stepOf(), 'code'); assert.match(query('[role="alert"]').textContent, /That code didn’t work/); assert.doesNotMatch(container.textContent, /Sensitive|99887766/);
    assert.equal(query('#convex-reset-code').value, ''); assert.equal(query('#convex-new-password'), null);
    assert.ok(query('a[href="/forgot-password"]'));
  });
}

for (const [status, message] of [[429, /Too many attempts/], [503, /temporarily unavailable/]]) {
  test(`convex: a ${status} answer stays on step 3 with a safe message and clears the passwords`, async () => {
    responses.set('/api/auth/reset-password', reply({ error: 'Sensitive provider detail' }, status));
    await toPasswordStep(); await typePasswords(); await submit();
    assert.equal(stepOf(), 'password'); assert.match(query('[role="alert"]').textContent, message); assert.doesNotMatch(container.textContent, /Sensitive/);
    assert.equal(query('#convex-new-password').value, ''); assert.equal(query('#convex-confirm-password').value, '');
  });
}

for (const [status, message] of [[429, /Too many attempts/], [400, /couldn’t process that request/], [503, /couldn’t process that request/]]) {
  test(`convex: asking for a code with a ${status} answer stays on step 1`, async () => {
    responses.set('/api/auth/forgot-password', reply({ error: 'Sensitive provider detail' }, status));
    await mountConvex('request'); await change('#convex-reset-email', 'person@example.invalid'); await submit();
    assert.match(query('[role="alert"]').textContent, message); assert.doesNotMatch(container.textContent, /Sensitive/); assert.equal(stepOf(), 'email');
  });
}

test('convex: every step is disabled and makes no request when reset is not enabled', async () => {
  for (const mode of ['request', 'reset']) {
    await mountConvex(mode, { authEnabled: false });
    assert.match(query('[role="status"]').textContent, /not enabled yet/);
    for (const control of container.querySelectorAll('input, button[type="submit"]')) assert.equal(control.disabled, true);
    await submit();
  }
  assert.equal(calls.length, 0);
});

test('convex: the form keeps nothing in browser storage and has no hidden credential fields on any step', async () => {
  await toCodeStep(); assert.equal(query('input[type="hidden"]'), null);
  await change('#convex-reset-code', '12345678'); await submit(); assert.equal(query('input[type="hidden"]'), null); assert.equal(document.cookie, '');
});
