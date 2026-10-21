// Synthetic React DOM tests. No real credentials, accounts, or network calls.
// JSDOM verifies interaction logic, not browser layout or hosted authentication.
import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import postcss from 'postcss';

const rootPath = fileURLToPath(new URL('../', import.meta.url));
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://synthetic.invalid/login' });
const restored = new Map();
let navigations = [];
const windowProxy = new Proxy(dom.window, {
  get(target, key) {
    if (key === 'location') return { assign: path => navigations.push(path) };
    return Reflect.get(target, key, target);
  },
});
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLFormElement', 'Event', 'MouseEvent']) {
  restored.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value: name === 'window' ? windowProxy : dom.window[name], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.__ufsLoginUiConfigured = false;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '../../lib/standalone-auth' && context.parentURL?.endsWith('/app/login/page.tsx')) return { url: 'ufs-login-ui:config', shortCircuit: true };
    try { return next(specifier, context); } catch (error) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
        for (const ext of ['.tsx', '.ts']) try { return next(specifier + ext, context); } catch {}
      }
      throw error;
    }
  },
  load(url, context, next) {
    if (url === 'ufs-login-ui:config') return { format: 'module', source: 'export function standaloneConfigured() { return globalThis.__ufsLoginUiConfigured; }', shortCircuit: true };
    if (url.startsWith('file:') && fileURLToPath(url).startsWith(rootPath) && !url.includes('/node_modules/')) {
      if (url.endsWith('.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
      if (/\.tsx?$/.test(url)) return { format: 'module', source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { renderToStaticMarkup } = await import('react-dom/server');
const { default: LoginForm } = await import('../app/login/login-form.tsx');
const { default: LoginPage } = await import('../app/login/page.tsx');
const realFetch = globalThis.fetch;
let calls, responses, container, root;
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
const factor = { id: 'synthetic-factor', friendlyName: 'Synthetic authenticator' };

beforeEach(() => {
  navigations = [];
  calls = [];
  responses = new Map([
    ['/api/auth/session', reply({ authenticated: false, enabled: true })],
    ['/api/auth/login', reply({ ok: true, authenticated: true })],
    ['/api/auth/logout', reply({ ok: true })],
  ]);
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init, body: init.body ? JSON.parse(init.body) : undefined });
    if (!responses.has(path)) throw new Error('Unexpected synthetic request');
    const response = responses.get(path);
    return typeof response === 'function' ? response(init) : await response;
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  globalThis.fetch = realFetch;
});
after(() => {
  hook.deregister();
  dom.window.close();
  for (const [name, descriptor] of restored) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  delete globalThis.__ufsLoginUiConfigured;
});

async function mount(props = {}) { await act(async () => root.render(createElement(LoginForm, { authEnabled: true, ...props }))); }
const query = selector => container.querySelector(selector);
const button = label => [...container.querySelectorAll('button')].find(item => item.textContent.includes(label));
async function change(selector, value) {
  const node = query(selector);
  assert.ok(node, 'Expected form control');
  const prototype = node.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
  await act(async () => {
    node.dispatchEvent(new dom.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
async function credentials() { await change('#ufs-email', '  person@example.invalid  '); await change('#ufs-password', 'synthetic-password'); }
async function submit() { await act(async () => query('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))); }
function pending() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('public page is data-free, has no provider/signup links, only password help, and filters URL reasons', async () => {
  const page = await LoginPage({ searchParams: Promise.resolve({ reason: '<script>private-input</script>' }) });
  const html = renderToStaticMarkup(page);
  assert.match(html, /UFS People/);
  assert.match(html, /Sign-in is temporarily unavailable/);
  assert.equal(html.match(/<a\s[^>]*>/g)?.length, 1);
  assert.match(html, /<a href="\/forgot-password">Forgot your password\?<\/a>/);
  assert.doesNotMatch(html.replace(/<a href="\/forgot-password">Forgot your password\?<\/a>/, ''), /ChatGPT|Google|sign.?up|forgot|reset|private-input|<script>|<a\s/i);
  const source = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"].*(?:workspace|server|employees|schema|import-manifest)/);
});

test('unconfigured authentication never fetches and disables credentials and submit', async () => {
  await mount({ authEnabled: false });
  assert.match(container.textContent, /Sign-in is temporarily unavailable/);
  assert.equal(calls.length, 0);
  for (const node of container.querySelectorAll('input, button')) assert.equal(node.disabled, true);
  await submit();
  assert.equal(calls.length, 0);
});

test('session-disabled response fails closed', async () => {
  responses.set('/api/auth/session', reply({ enabled: false, authenticated: false }));
  await mount();
  assert.match(container.textContent, /Sign-in is temporarily unavailable/);
  assert.equal(query('#ufs-email').disabled, true);
  await submit();
  assert.deepEqual(calls.map(item => item.path), ['/api/auth/session']);
});

test('session check blocks credential submission until resolved', async () => {
  const deferred = pending();
  responses.set('/api/auth/session', deferred.promise);
  await mount();
  assert.equal(query('#ufs-email').disabled, true);
  assert.match(container.textContent, /Checking your session/);
  await submit();
  assert.equal(calls.length, 1);
  await act(async () => deferred.resolve(reply({ enabled: true, authenticated: false })));
  assert.equal(query('#ufs-email').disabled, false);
});

test('authenticated session navigates only to fixed workspace root', async () => {
  responses.set('/api/auth/session', reply({ enabled: true, authenticated: true }));
  await mount();
  assert.deepEqual(navigations, ['/']);
  assert.match(container.textContent, /Opening your workspace/);
});

test('failed session check gives generic accessible feedback and allows credentials', async () => {
  responses.set('/api/auth/session', reply({ error: 'Sensitive provider response' }, 503));
  await mount();
  assert.match(query('[role="alert"]').textContent, /Please sign in to continue/);
  assert.doesNotMatch(container.textContent, /Sensitive provider/);
  assert.equal(document.activeElement, query('[role="alert"]'));
  assert.equal(query('#ufs-email').disabled, false);
});

test('credential submit uses same-origin JSON, clears password immediately, and ignores duplicate submits', async () => {
  const deferred = pending();
  responses.set('/api/auth/login', deferred.promise);
  await mount();
  assert.equal(query('#ufs-email').autocomplete, 'username');
  assert.equal(query('#ufs-password').autocomplete, 'current-password');
  assert.equal(query('#ufs-password').type, 'password');
  await credentials();
  await submit();
  assert.equal(query('#ufs-password').value, '');
  await submit();
  const posts = calls.filter(item => item.path === '/api/auth/login');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, { email: 'person@example.invalid', password: 'synthetic-password' });
  for (const call of calls) {
    assert.equal(call.init.credentials, 'same-origin');
    assert.equal(call.init.cache, 'no-store');
    assert.equal(call.init.redirect, 'error');
  }
  assert.equal(posts[0].init.headers['Content-Type'], 'application/json');
  await act(async () => deferred.resolve(reply({ ok: true, authenticated: true })));
  assert.deepEqual(navigations, ['/']);
});

test('rejected credentials reveal no account/provider details and require password re-entry', async () => {
  responses.set('/api/auth/login', reply({ error: 'This account exists but has wrong password' }, 401));
  await mount();
  await credentials();
  await submit();
  assert.match(query('[role="alert"]').textContent, /Check your email and password/);
  assert.doesNotMatch(container.textContent, /account exists|wrong password/);
  assert.equal(query('#ufs-password').value, '');
  assert.equal(query('#ufs-email').value, 'person@example.invalid');
  assert.equal(document.activeElement, query('[role="alert"]'));
  assert.deepEqual(navigations, []);
});

test('malformed successful login response does not open the workspace', async () => {
  responses.set('/api/auth/login', reply({ ok: true }));
  await mount();
  await credentials();
  await submit();
  assert.deepEqual(navigations, []);
  assert.ok(query('[role="alert"]'));
});

test('nonboolean authenticated session response fails closed instead of redirecting', async () => {
  responses.set('/api/auth/session', reply({ enabled: true, authenticated: 'true' }));
  await mount();
  assert.deepEqual(navigations, []);
  assert.match(query('[role="alert"]').textContent, /Please sign in to continue/);
});

// Authenticator sign-in was retired on October 15, 2026. The page must never
// offer it, even if an older server response still mentions it.
test('legacy MFA session response shows only the password form and no authenticator controls', async () => {
  responses.set('/api/auth/session', reply({ enabled: true, authenticated: false, mfaRequired: true, factors: [factor], allowEnrollment: true }));
  await mount();
  assert.equal(query('#ufs-code'), null);
  assert.equal(query('#ufs-factor'), null);
  assert.equal(query('img'), null);
  assert.equal(button('Set up authenticator'), undefined);
  assert.equal(query('[data-stage]').getAttribute('data-stage'), 'credentials');
  assert.deepEqual(navigations, []);
  assert.deepEqual(calls.map(item => item.path), ['/api/auth/session']);
});

test('legacy MFA-required login response never opens the workspace or shows authenticator controls', async () => {
  responses.set('/api/auth/login', reply({ ok: true, authenticated: false, mfaRequired: true, factors: [factor] }));
  await mount();
  await credentials();
  await submit();
  assert.deepEqual(navigations, []);
  assert.ok(query('[role="alert"]'));
  assert.equal(query('#ufs-code'), null);
  assert.equal(button('Set up authenticator'), undefined);
  assert.deepEqual(calls.map(item => item.path), ['/api/auth/session', '/api/auth/login']);
});

test('unknown reason values and inherited object properties are not rendered', async () => {
  await mount({ reason: 'constructor' });
  assert.doesNotMatch(container.textContent, /function Object|constructor/);
  await mount({ reason: '<script>untrusted reason</script>' });
  assert.doesNotMatch(container.textContent, /untrusted reason/);
});

test('login source keeps credentials out of persistence and has scoped responsive styles', () => {
  const source = readFileSync(new URL('../app/login/login-form.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.|dangerouslySetInnerHTML|document\.cookie/);
  const css = readFileSync(new URL('../app/login/login.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
});

// Resolve declaration order for exact selectors at a synthetic viewport width.
// This checks explicit responsive rules; it does not simulate browser geometry.
function stylesAtWidth(selector, width) {
  const css = postcss.parse(readFileSync(new URL('../app/login/login.css', import.meta.url), 'utf8'));
  const declarations = {};
  css.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type !== 'atrule') continue;
      if (parent.name !== 'media') return;
      const maximum = parent.params.match(/max-width\s*:\s*([\d.]+)px/);
      const minimum = parent.params.match(/min-width\s*:\s*([\d.]+)px/);
      if ((!maximum && !minimum) || (maximum && width > Number(maximum[1])) || (minimum && width < Number(minimum[1]))) return;
    }
    rule.walkDecls(declaration => { declarations[declaration.prop] = declaration.value; });
  });
  return declarations;
}

for (const width of [320, 360, 390, 430, 700]) {
  test(`mobile ${width}px: marketing hero is hidden and the brand strip is compact`, () => {
    assert.equal(stylesAtWidth('.ufs-login-intro', width).display, 'none');
    assert.equal(stylesAtWidth('.ufs-login-orbit', width).display, 'none');
    const brand = stylesAtWidth('.ufs-login-welcome', width);
    const padding = brand.padding.split(/\s+/).map(value => Number.parseFloat(value));
    assert.ok(padding[0] <= 20, 'Brand strip top padding must stay compact');
    assert.ok((padding[2] ?? padding[0]) <= 20, 'Brand strip bottom padding must stay compact');
    assert.ok(Number.parseFloat(stylesAtWidth('.ufs-login-brand strong', width)['font-size']) <= 24);
  });

  test(`mobile ${width}px: keyboard layout stays in natural document flow with readable fields`, () => {
    const main = stylesAtWidth('.ufs-login', width);
    assert.ok(main.display !== 'grid' || (main['align-items'] ?? main['place-items']?.split(/\s+/)[0]) !== 'center', 'The page must not recenter around the keyboard');
    for (const selector of ['.ufs-login', '.ufs-login-layout', '.ufs-login-panel', '.ufs-login-card']) {
      const styles = stylesAtWidth(selector, width);
      assert.ok(!styles.height || styles.height === 'auto', `${selector} must not fix its height`);
      assert.ok(!styles['max-height'] || styles['max-height'] === 'none', `${selector} must not constrain vertical scrolling`);
      assert.ok(!['fixed', 'absolute'].includes(styles.position), `${selector} must remain in the page flow`);
      assert.ok(!['hidden', 'clip'].includes(styles['overflow-y']), `${selector} must not trap vertical overflow`);
    }
    assert.equal(stylesAtWidth('.ufs-login-layout', width)['min-height'], '0');
    assert.ok(Number.parseFloat(stylesAtWidth('.ufs-login-field input', width)['font-size']) >= 16);
    assert.ok(Number.parseFloat(stylesAtWidth('.ufs-login-field select', width)['font-size']) >= 16);
  });
}

test('responsive line break preserves the space in “for your”', async () => {
  const page = await LoginPage({});
  const document = new JSDOM(renderToStaticMarkup(page)).window.document;
  assert.equal(document.querySelector('#ufs-welcome-title').textContent.replace(/\s+/g, ' ').trim(), 'A home for your workday.');
  assert.doesNotMatch(document.body.textContent, /foryour/);
});

test('credentials retain logical keyboard order and do not autofocus email', async () => {
  await mount();
  const form = query('form');
  const controls = [...form.querySelectorAll('input, select, button')];
  assert.deepEqual(controls.map(control => control.tagName === 'BUTTON' ? control.type : control.name), ['email', 'password', 'submit']);
  for (const control of controls) {
    assert.equal(control.tabIndex, 0);
    assert.equal(control.disabled, false);
  }
  for (const input of form.querySelectorAll('input')) {
    assert.equal(input.autofocus, false);
    assert.ok(form.querySelector(`label[for="${input.id}"]`));
  }
  assert.notEqual(document.activeElement, query('#ufs-email'));
  assert.equal(query('[data-stage]').getAttribute('data-stage'), 'credentials');
  assert.equal(query('#ufs-email').type, 'email');
  assert.equal(query('#ufs-password').type, 'password');
});
