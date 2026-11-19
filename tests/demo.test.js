import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const exportsOf = (source) => [...source.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]).sort();

test('the demo stands in for every function the screens use', () => {
  const pairs = [
    ['../src/listings/api.js', '../demo/listings-api.js'],
    ['../src/auth/api.js', '../demo/auth-api.js'],
    ['../src/media/recorder.js', '../demo/recorder.js'],
  ];
  for (const [real, demo] of pairs) {
    const missing = exportsOf(read(real)).filter((name) => !exportsOf(read(demo)).includes(name));
    assert.deepEqual(missing, [], `${demo} is missing ${missing.join(', ')}`);
  }
});

test('the demo page swaps exactly those three files and loads the real app', () => {
  const html = read('../demo.html');
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(map.imports, {
    './src/auth/api.js': './demo/auth-api.js',
    './src/listings/api.js': './demo/listings-api.js',
    './src/media/recorder.js': './demo/recorder.js',
  });
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'), 'the import map comes before any module');
  assert.match(html, /<script type="module" src="src\/app\.js"><\/script>/);
  assert.match(html, /noindex/);
});

test('the demo keeps the real recording code', () => {
  const real = read('../src/media/recorder.js');
  const demo = read('../demo/recorder.js');
  const body = (source) => source.slice(source.indexOf('export function startRecording'));
  assert.equal(body(demo), body(real));
});
