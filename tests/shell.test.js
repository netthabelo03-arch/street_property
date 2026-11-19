import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, tabs } from '../src/shell.js';
import { MODES } from '../src/screens/explore.js';

const session = { user: { email: 'lerato.d@example.com' } };

test('the top bar shows the first name, else the email name, else Account', () => {
  assert.equal(displayName({ full_name: 'Lerato Dlamini' }, session), 'Lerato');
  assert.equal(displayName({ full_name: '  ' }, session), 'lerato.d');
  assert.equal(displayName(null, null), 'Account');
});

test('the tab bar has the five tabs of the design; only Explore and Profile work yet', () => {
  assert.deepEqual(tabs().map((tab) => tab.text), ['Explore', 'Map', 'Saved', 'Enquiries', 'Profile']);
  assert.deepEqual(tabs().filter((tab) => tab.href).map((tab) => tab.id), ['explore', 'profile']);
});

test('Explore switches between renting and buying; Buy searches listings for sale', () => {
  assert.deepEqual(Object.keys(MODES), ['rent', 'sell'], 'the same ids as a listing\'s mode');
  assert.equal(MODES.rent.label, 'Rent');
  assert.equal(MODES.sell.label, 'Buy');
});
