import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versionBlock, stampedIndex, fileVersion } from '../tools/stamp.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('D-012: index.html gives every app file its current versioned address (run node tools/stamp.mjs)', () => {
  const html = read('../index.html');
  assert.equal(stampedIndex(html, versionBlock()), html, 'index.html is out of date: run node tools/stamp.mjs');
});

test('D-012: the app is started through the import map, so its files are versioned too', () => {
  const html = read('../index.html');
  assert.match(html, /<script type="module">import '\.\/src\/app\.js';<\/script>/);
  assert.doesNotMatch(html, /<script type="module" src=/);
  assert.ok(html.indexOf('type="importmap"') < html.indexOf("import './src/app.js'"), 'the import map comes first');
  const map = JSON.parse(html.slice(html.indexOf('{', html.indexOf('type="importmap"')), html.indexOf('</script>', html.indexOf('type="importmap"'))));
  for (const [from, to] of Object.entries(map.imports)) assert.match(to, new RegExp(`^${from.replace(/[.]/g, '\\.')}\\?v=[0-9a-f]{10}$`));
  assert.ok(map.imports['./src/screens/deal.js']);
});

test('D-012: a failed start reloads once, never in a loop', () => {
  const html = read('../index.html');
  assert.match(html, /sessionStorage\.getItem\('street-property\.reloaded'\)/);
  assert.match(read('../src/app.js'), /window\.__streetStarted = true/);
});

test('D-012: the service worker checks with the server and keeps one copy per file', () => {
  const sw = read('../sw.js');
  assert.match(sw, /cache: 'no-cache'/);
  assert.match(sw, /searchParams\.has\('v'\)/);
  assert.equal(fileVersion('abc'), 'ba7816bf8f');
});

test('HostAfrica: cPanel copies only the app, and .htaccess keeps the rest private', () => {
  const yml = read('../.cpanel.yml');
  assert.match(yml, /cp -f index\.html sw\.js manifest\.webmanifest \.htaccess \$DEPLOYPATH/);
  assert.match(yml, /cp -Rf src icons \$DEPLOYPATH/);
  assert.doesNotMatch(yml, /supabase|tests|docs/);
  const access = read('../.htaccess');
  assert.match(access, /RewriteRule \^\(supabase\|tests\|docs\|tools\|\\\.git\)\(\/\|\$\) - \[F,L\]/);
  assert.match(access, /Header set Cache-Control "no-cache"/);
  assert.match(access, /RewriteCond %\{HTTPS\} !=on/);
});
