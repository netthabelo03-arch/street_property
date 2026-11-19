import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/theme/tokens.css', import.meta.url), 'utf8');
const token = (name) => {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  assert.ok(match, name);
  return match[1];
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

test('the theme is dark: charcoal ground, light text', () => {
  assert.ok(luminance(token('color-ground')) < 0.02);
  assert.ok(luminance(token('color-text')) > 0.8);
});

test('text is readable (at least 4.5 to 1) on every background it sits on', () => {
  const pairs = [
    ['color-text', 'color-ground'], ['color-text', 'color-panel'], ['color-text-soft', 'color-panel'],
    ['color-text-muted', 'color-ground'], ['color-text-muted', 'color-panel'],
    ['color-link', 'color-ground'], ['color-link', 'color-panel'],
    ['color-on-accent', 'color-accent'],
    ['color-danger', 'color-danger-bg'], ['color-warning', 'color-warning-bg'], ['color-success-text', 'color-success-bg'],
  ];
  for (const [fore, back] of pairs) {
    const ratio = contrast(token(fore), token(back));
    assert.ok(ratio >= 4.5, `${fore} on ${back}: ${ratio.toFixed(2)}`);
  }
});

test('every comment in the style sheets is closed, so no rules are swallowed', () => {
  for (const file of ['../src/app.css', '../src/street.css', '../src/theme/tokens.css', '../demo/demo.css']) {
    const css = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const comment of css.match(/\/\*[\s\S]*?\*\//g) ?? []) {
      assert.ok(!comment.slice(2).includes('/*'), `${file}: a comment opens inside another one: ${comment.slice(0, 60)}`);
    }
    const opens = (css.match(/\/\*/g) ?? []).length;
    const closes = (css.match(/\*\//g) ?? []).length;
    assert.equal(opens, closes, `${file}: ${opens} comments opened, ${closes} closed`);
  }
});
