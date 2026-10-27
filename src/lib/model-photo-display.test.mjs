import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

function ruleFor(selector) {
  const start = css.indexOf(`${selector}{`);
  assert.notEqual(start, -1, `Expected a CSS rule for ${selector}`);
  const end = css.indexOf('}', start);
  assert.notEqual(end, -1, `Expected the CSS rule for ${selector} to close`);
  return css.slice(start, end + 1);
}

test('Kandura model photos use contain in customer and Admin image areas', () => {
  const selectors = [
    '.model-option-item .dynamic-option-choice>.dynamic-option-image,.model-option-item .dynamic-option-choice>.model-photo-fallback',
    '.model-option-gallery img',
    '.model-admin-photo-preview>img',
    '.kandura-model-admin-image img',
    '.kandura-model-photo-grid>article>img',
    '.model-managed-option .custom-option-image-preview',
  ];

  for (const selector of selectors) {
    const rule = ruleFor(selector);
    assert.match(rule, /object-fit:contain(?:!important)?/, `${selector} must preserve the whole photo`);
    assert.doesNotMatch(rule, /object-fit:cover/, `${selector} must not crop the photo`);
  }
});
