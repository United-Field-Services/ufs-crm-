// Synthetic rendering only; source links are fixtures, not employee records.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

const componentURL = new URL('../app/parity-guide.tsx', import.meta.url).href;
const hooks = registerHooks({
  load(url, context, next) {
    if (url !== componentURL) return next(url, context);
    return { format: 'module', source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText, shortCircuit: true };
  },
});
const { ParityGuide } = await import(componentURL);
after(() => hooks.deregister());

test('feature coverage uses UFS People product branding', () => {
  const html = renderToStaticMarkup(createElement(ParityGuide));
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector('.parity-guide h3').textContent, 'UFS People review & feature coverage');
  assert.doesNotMatch(html, /TalentHR/);
});

test('source-report provenance and audit metadata stay accurate', () => {
  const sourceUrl = 'https://example.invalid/authorized-source-report';
  const html = renderToStaticMarkup(createElement(ParityGuide, { sourceUrl }));
  const document = new JSDOM(html).window.document;
  const source = document.querySelector('.parity-footer a');
  assert.equal(source.textContent, 'TalentHR source report');
  assert.equal(source.href, sourceUrl);
  assert.match(document.querySelector('.parity-footer').textContent, /Access depends on your TalentHR sign-in/);
  assert.match(document.querySelector('.parity-guide .panel-heading').textContent, /Schema and workflow audit · October 11, 2026 · Private review/);
});
