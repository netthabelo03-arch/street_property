import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRoute, resolveRoute, hashFor, safeNext, tabFor, PROTECTED_SCREENS, GUEST_SCREENS } from '../src/router.js';
import { ROLES, findRole, isRole, canList } from '../src/roles.js';
import { isConfigured } from '../src/config.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('an empty or unknown address shows Explore', () => {
  for (const hash of ['', '#', '#/', undefined, null, '#/home', '#/signin/extra', '#access_token=abc', '#/<script>']) {
    assert.deepEqual(parseRoute(hash), { screen: 'explore' });
  }
});

test('named screens are understood', () => {
  for (const screen of ['signup', 'signin', 'forgot', 'new-password', 'profile', 'terms', 'privacy']) {
    assert.deepEqual(parseRoute(`#/${screen}`), { screen });
  }
});

test('the profile needs an account; log-in screens send signed-in people to Explore', () => {
  assert.deepEqual(resolveRoute({ screen: 'profile' }, false), { screen: 'signin' });
  assert.deepEqual(resolveRoute({ screen: 'profile' }, true), { screen: 'profile' });
  for (const screen of GUEST_SCREENS) assert.deepEqual(resolveRoute({ screen }, true), { screen: 'explore' });
  assert.deepEqual(resolveRoute({ screen: 'explore' }, false), { screen: 'explore' });
  assert.ok(PROTECTED_SCREENS.includes('new-password'));
});

test('addresses round-trip, and only safe ones are remembered for after log-in', () => {
  assert.equal(hashFor({ screen: 'explore' }), '#/');
  assert.equal(hashFor({ screen: 'profile' }), '#/profile');
  assert.equal(safeNext('#/profile'), '#/profile');
  for (const bad of ['#/', '#/signin', '#/new-password', 'https://evil.example', '#/profile/x', null, 42]) assert.equal(safeNext(bad), null);
  assert.equal(tabFor('profile'), 'profile');
  assert.equal(tabFor('explore'), 'explore');
});

test('the three roles: renter, owner and agent; only owners and agents list places', () => {
  assert.deepEqual(ROLES.map((role) => role.id), ['renter', 'owner', 'agent']);
  assert.equal(findRole('owner').short, 'Owner');
  assert.equal(isRole('admin'), false);
  assert.equal(isRole('goer'), false);
  assert.equal(canList('owner'), true);
  assert.equal(canList('agent'), true);
  assert.equal(canList('renter'), false);
  assert.match(findRole('agent').about, /Fidelity Fund Certificate/);
});

test('until it is connected to Supabase, the app says accounts are not switched on', () => {
  assert.equal(isConfigured(), false);
});

test('the database script matches the app', () => {
  const sql = read('../supabase/001_profiles.sql');
  assert.match(sql, /check \(role in \('renter', 'owner', 'agent'\)\)/);
  assert.match(sql, /else 'renter' end/);
  assert.match(sql, /grant update \(full_name, role\) on public\.profiles to authenticated;/);
  assert.match(sql, /revoke all on public\.admins from anon, authenticated;/, 'nobody can make themselves an admin');
  assert.match(sql, /create or replace function public\.is_admin\(\)/);
  for (const role of ROLES) assert.ok(sql.includes(`'${role.id}'`), role.id);
});

test('the app uses Street Property names, not plusespot ones', () => {
  for (const file of ['../index.html', '../manifest.webmanifest', '../src/dom.js', '../src/auth/api.js', '../src/app.js', '../sw.js']) {
    const text = read(file);
    assert.doesNotMatch(text, /plusespot|Goer|Discover/, file);
  }
  assert.match(read('../src/auth/api.js'), /role: 'renter'/);
});
