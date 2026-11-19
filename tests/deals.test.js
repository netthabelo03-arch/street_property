import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto, createHash } from 'node:crypto';
import {
  dealSteps, nextAction, checkLeaseTerms, checkSignatureName, roomName, roomProgress, photoStamp, photoPath,
  leaseFingerprint, shortFingerprint, LEASE_MONTHS,
} from '../src/deals/rules.js';
import { tourRooms } from '../src/listings/rules.js';
import { parseRoute, hashFor, resolveRoute, tabFor, safeNext, PROTECTED_SCREENS } from '../src/router.js';
import { friendlyListingError } from '../src/listings/errors.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1b2c3d4e5f60';
const base = {
  my_side: 'renter', other_name: 'Thabo', status: 'agreeing', listing_verified: true, met_both: true,
  owner_signed_at: null, renter_signed_at: null, owner_checked_at: null, renter_checked_at: null, keys_at: null,
};

test('S8: deal, lease and move-in check screens need an account and sit under Enquiries', () => {
  const cases = {
    [`#/deals/${ID}`]: { screen: 'deal', id: ID },
    [`#/deals/${ID}/lease`]: { screen: 'deal-lease', id: ID },
    [`#/deals/${ID}/check`]: { screen: 'deal-check', id: ID },
  };
  for (const [hash, route] of Object.entries(cases)) {
    assert.deepEqual(parseRoute(hash), route, hash);
    assert.equal(hashFor(route), hash);
    assert.ok(PROTECTED_SCREENS.includes(route.screen));
    assert.deepEqual(resolveRoute(route, false), { screen: 'signin' });
    assert.equal(tabFor(route.screen), 'enquiries');
    assert.equal(safeNext(hash), hash);
  }
  assert.equal(parseRoute('#/deals/not-an-id').screen, 'explore');
  assert.equal(parseRoute(`#/deals/${ID}/other`).screen, 'explore');
});

test('S8/S9: the deal has seven steps in the order they happen', () => {
  const none = { ...base, safe_state: 'none' };
  const steps = dealSteps(none);
  assert.deepEqual(steps.map((s) => s.id), ['verified', 'met', 'renter', 'lease', 'deposit', 'check', 'keys']);
  assert.deepEqual(steps.map((s) => s.state), ['done', 'done', 'done', 'now', 'next', 'next', 'next']);
  const signed = dealSteps({ ...none, status: 'signed', listing_verified: false, met_both: false });
  assert.deepEqual(signed.map((s) => s.state), ['skipped', 'skipped', 'done', 'done', 'now', 'next', 'next']);
  const paid = dealSteps({ ...none, status: 'signed', safe_state: 'paid', owner_checked_at: 'x', renter_checked_at: 'y' });
  assert.deepEqual(paid.map((s) => s.state), ['done', 'done', 'done', 'done', 'done', 'done', 'now']);
  const unpaid = dealSteps({ ...none, status: 'moved_in', owner_checked_at: 'x', renter_checked_at: 'y', keys_at: 'z' });
  assert.equal(unpaid.find((s) => s.id === 'deposit').state, 'skipped');
  assert.ok(unpaid.filter((s) => s.id !== 'deposit').every((s) => s.state === 'done'));
  assert.ok(dealSteps({ ...none, status: 'cancelled' }).every((s) => s.state !== 'now'));
});

test('S8: each side is told what to do next', () => {
  assert.match(nextAction({ ...base, my_side: 'owner', other_name: 'Lerato' }), /Fill in the lease/);
  assert.match(nextAction(base), /Waiting for Thabo to send the lease/);
  assert.match(nextAction({ ...base, status: 'signing' }), /Read the lease and sign/);
  assert.match(nextAction({ ...base, status: 'signing', renter_signed_at: 'x' }), /Waiting for Thabo to sign/);
  assert.match(nextAction({ ...base, status: 'signed', safe_state: 'none', owner_can_receive: true }), /Pay the first month/);
  assert.match(nextAction({ ...base, status: 'signed', safe_state: 'none', owner_can_receive: false }), /Waiting for Thabo to set up Street Safe payouts/);
  assert.match(nextAction({ ...base, my_side: 'owner', status: 'signed', safe_state: 'none', owner_can_receive: false }), /Set up Street Safe payouts/);
  assert.match(nextAction({ ...base, status: 'signed', safe_state: 'waiting' }), /on its way/);
  assert.match(nextAction({ ...base, status: 'signed', safe_state: 'paid' }), /photograph every room/);
  assert.match(nextAction({ ...base, status: 'signed', safe_state: 'paid', renter_checked_at: 'x' }), /Waiting for Thabo to sign the move-in check/);
  assert.match(nextAction({ ...base, status: 'signed', safe_state: 'paid', renter_checked_at: 'x', owner_checked_at: 'y' }), /Got the keys/);
  assert.match(nextAction({ ...base, status: 'moved_in' }), /Welcome home/);
  assert.match(nextAction({ ...base, status: 'cancelled' }), /called off/);
});

test('S8: lease terms are checked like the database does', () => {
  const ok = { rent: '6500', deposit: '6500', start: '2026-12-01', months: '12', special: '' };
  assert.deepEqual(checkLeaseTerms(ok, '2026-11-19'), {});
  assert.deepEqual(checkLeaseTerms({ ...ok, deposit: '' }, '2026-11-19'), {});
  assert.ok(checkLeaseTerms({ ...ok, rent: '200' }, '2026-11-19').rent);
  assert.ok(checkLeaseTerms({ ...ok, rent: '65.5' }, '2026-11-19').rent);
  assert.ok(checkLeaseTerms({ ...ok, deposit: '-1' }, '2026-11-19').deposit);
  assert.ok(checkLeaseTerms({ ...ok, start: '2026-11-18' }, '2026-11-19').start);
  assert.ok(checkLeaseTerms({ ...ok, start: '2028-01-01' }, '2026-11-19').start);
  assert.ok(checkLeaseTerms({ ...ok, months: '9' }, '2026-11-19').months);
  assert.ok(checkLeaseTerms({ ...ok, special: 'x'.repeat(1001) }, '2026-11-19').special);
  assert.deepEqual(LEASE_MONTHS, [6, 12, 24, 36]);
});

test('S8: a signature is a full name', () => {
  assert.equal(checkSignatureName('Lerato Dlamini'), null);
  assert.ok(checkSignatureName('Lerato'));
  assert.ok(checkSignatureName('  '));
  assert.ok(checkSignatureName(`A ${'b'.repeat(120)}`));
});

test('S8: the lease fingerprint matches the database (SHA-256 hex)', async () => {
  const text = 'RESIDENTIAL LEASE AGREEMENT\nTenant: Lerato Dlamini — R6 500';
  const hash = await leaseFingerprint(text, webcrypto.subtle);
  assert.equal(hash, createHash('sha256').update(text, 'utf8').digest('hex'));
  assert.equal(shortFingerprint('a1b2c3d4e5f6'), 'A1B2 C3D4');
});

test('S8: move-in rooms match the tour rooms and are named for people', () => {
  const sql = read('../supabase/010_deals.sql');
  assert.match(sql, /function public\.deal_rooms/);
  const flat = tourRooms({ kind: 'flat', bedrooms: 2, bathrooms: 1 }).map((r) => r.id);
  assert.deepEqual(flat, ['outside', 'lounge', 'kitchen', 'bedroom_1', 'bedroom_2', 'bathroom_1', 'meters']);
  const room = tourRooms({ kind: 'backyard_room', bedrooms: 0, bathrooms: 0 }).map((r) => r.id);
  assert.deepEqual(room, ['outside', 'bedroom_1', 'bathroom_1', 'kitchen', 'meters']);
  assert.equal(roomName('bedroom_2', flat), 'Bedroom 2');
  assert.equal(roomName('bathroom_1', flat), 'Bathroom');
  assert.equal(roomName('outside', flat), 'Outside and gate');
  const progress = roomProgress(flat, [{ room: 'outside' }, { room: 'outside' }, { room: 'kitchen' }]);
  assert.deepEqual(progress, { done: 2, total: 7, complete: false });
  assert.equal(roomProgress(['a'], [{ room: 'a' }]).complete, true);
});

test('S8: photos are stamped with place, room and time, and saved in the deal’s room folder', () => {
  const stamp = photoStamp({ area: 'Orlando West', room: 'Kitchen', at: new Date('2026-11-19T12:05:00Z') });
  assert.match(stamp, /^Orlando West {2}· {2}Kitchen {2}· {2}19 Nov 2026/);
  assert.match(stamp, /14:05/);
  assert.match(photoPath(ID, 'kitchen', () => 'abc'), new RegExp(`^${ID}/kitchen/\\d+-abc\\.jpg$`));
});

test('S8: deal problems have plain sentences', () => {
  for (const hint of ['not_at_address', 'lease_changed', 'signature_name', 'rooms_missing', 'check_first', 'deal_cancelled', 'not_viewing_time']) {
    const text = friendlyListingError({ hint });
    assert.ok(text && !/hint|error/i.test(text), hint);
  }
});

test('S8: the database keeps deals private and the lease template marked as a draft', () => {
  const sql = read('../supabase/010_deals.sql');
  assert.match(sql, /LEASE TEMPLATE BELOW IS A DRAFT/);
  assert.match(sql, /to be reviewed by a lawyer/);
  assert.match(sql, /'deal-photos', 'deal-photos', false/);
  assert.match(sql, /revoke all on public\.deals, public\.inspection_rooms, public\.inspection_photos from anon, authenticated/);
  assert.match(sql, /p_hash is distinct from d\.lease_hash/);
  const dry = read('../supabase/tests/010_dryrun.sql');
  assert.match(dry, /all 13 checks passed/);
});

test('S8: the screens are wired up', () => {
  const app = read('../src/app.js');
  for (const name of ['renderDeal', 'renderDealLease', 'renderDealCheck']) assert.match(app, new RegExp(name));
  const convo = read('../src/screens/conversation.js');
  assert.match(convo, /We met/);
  assert.match(convo, /Street Safe deal/);
  const deal = read('../src/screens/deal.js');
  assert.match(deal, /Draft lease template/);
  assert.match(deal, /capture: 'environment'/);
});
