import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

function rulesFor(selector) {
  return css
    .split(`${selector}{`)
    .slice(1)
    .map((remainder) => remainder.slice(0, remainder.indexOf('}')));
}

function latestRule(selector) {
  const rules = rulesFor(selector);
  assert.ok(rules.length, `Expected a CSS rule for ${selector}`);
  return rules.at(-1);
}

test('Kandura model photos retain their natural aspect ratio across customer and Admin views', () => {
  const imageRules = [
    '.model-option-item .dynamic-option-choice>.dynamic-option-image,.model-option-item .dynamic-option-choice>.model-photo-fallback',
    '.model-option-gallery img',
    '.model-admin-photo-preview>img',
    '.kandura-model-admin-image img',
    '.kandura-model-photo-grid>article>img',
    '.model-managed-option .custom-option-image-preview',
  ];

  for (const selector of imageRules) {
    const rules = rulesFor(selector);
    const combined = rules.join(' ');
    assert.match(combined, /object-fit:contain(?:!important)?/, `${selector} must preserve the whole photo`);
    assert.match(combined, /height:auto/, `${selector} must follow the uploaded image's intrinsic ratio`);
    assert.doesNotMatch(combined, /object-fit:cover/, `${selector} must not crop the photo`);
    assert.doesNotMatch(combined, /(?<!max-)height:\d+px/, `${selector} must not use a fixed crop-prone height`);
  }
});

test('model photo containers do not clip the naturally sized image', () => {
  assert.ok(rulesFor('.model-option-item .dynamic-option-choice').some((rule) => /overflow:visible/.test(rule)));
  assert.doesNotMatch(latestRule('.model-admin-photo-preview'), /overflow:hidden/);
  assert.doesNotMatch(latestRule('.kandura-model-admin-card'), /overflow:hidden/);
  assert.doesNotMatch(latestRule('.kandura-model-admin-image'), /overflow:hidden/);
  assert.doesNotMatch(css, /\.model-option-item \.dynamic-option-choice>\.dynamic-option-image[^}]*height:(?:98|136)px!important/);
  assert.doesNotMatch(css, /\.model-option-gallery img\{[^}]*height:(?:68|78)px/);
});
