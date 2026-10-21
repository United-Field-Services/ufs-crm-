// Responsive CSS/DOM contracts, not pixel-level browser or iOS verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const css = postcss.parse(readFileSync(new URL('../app/profile.css', import.meta.url), 'utf8'));
function style(selector, width) {
  const result = {};
  css.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type !== 'atrule' || parent.name !== 'media') continue;
      const max = parent.params.match(/max-width:\s*(\d+)px/);
      if (max && width > Number(max[1])) return;
    }
    rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
  });
  return result;
}

for (const width of [320, 360, 390, 430, 540, 541, 768, 780]) test(`mobile profile reserves its name column at ${width}px`, () => {
  const header = style('.profile-header', width);
  const identity = style('.profile-identity', width);
  const status = style('.profile-header-status', width);
  const avatar = width <= 540 ? 49 : 66;
  assert.equal(header.display, 'grid');
  assert.equal(header['grid-template-columns'], `${avatar}px minmax(0, 1fr)`);
  assert.equal(identity['min-width'], '0');
  assert.equal(status['grid-column'], '2');
  assert.equal(status.margin, '0');
  assert.equal(status['margin-left'], undefined);
  assert.equal(status['margin-top'], undefined);
  assert.equal(status['flex-wrap'], 'wrap');
  assert.equal(status['min-width'], '0');
  // A synthetic card with 16px page gutters keeps the same name width regardless
  // of the badges' content or font size: they occupy their own grid row.
  const padding = width <= 540 ? 18 : 23;
  const nameWidth = width - 32 - padding * 2 - avatar - Number.parseFloat(header.gap);
  assert.ok(nameWidth >= 191, `Expected a readable name column; modeled width ${nameWidth}`);
});

test('mobile full names have no fixed-height or truncation constraints when text grows', () => {
  const heading = style('.profile-root .profile-name-row h2', 320);
  assert.equal(heading['overflow-wrap'], 'anywhere');
  assert.ok(Number.parseFloat(heading['font-size']) >= 21);
  for (const selector of ['.profile-header', '.profile-identity', '.profile-name-row', '.profile-root .profile-name-row h2']) {
    const rules = style(selector, 320);
    for (const property of ['height', 'max-height', 'line-clamp', '-webkit-line-clamp', 'text-overflow']) assert.equal(rules[property], undefined, `${selector} must not clip expanded names`);
    assert.notEqual(rules['white-space'], 'nowrap');
    assert.notEqual(rules.overflow, 'hidden');
  }
});

test('long job/location metadata can wrap and desktop keeps its existing row', () => {
  for (const selector of ['.profile-identity > p', '.profile-identity-meta > span', '.profile-view-label']) {
    const rules = style(selector, 390);
    assert.equal(rules['overflow-wrap'], 'anywhere');
    assert.equal(rules['min-width'], '0');
  }
  for (const width of [781, 1024, 1440]) {
    assert.equal(style('.profile-header', width).display, 'flex');
    assert.equal(style('.profile-header-status', width)['flex-direction'], 'column');
    assert.equal(style('.profile-header-status', width)['grid-column'], undefined);
  }
});
