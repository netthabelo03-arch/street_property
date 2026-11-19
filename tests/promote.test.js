import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOOSTS, boostLine, isFeatured, listingLink, socialCaption, electricityGuess, trueMonthlyCost, shareOfPay } from '../src/promote/rules.js';
import { parseRoute, hashFor, resolveRoute, tabFor, PROTECTED_SCREENS } from '../src/router.js';
import { friendlyListingError } from '../src/listings/errors.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1b2c3d4e5f60';

test('S11: promote needs the owner signed in; the ad page and board are public', () => {
  assert.deepEqual(parseRoute(`#/list/${ID}/promote`), { screen: 'list-promote', id: ID });
  assert.equal(hashFor({ screen: 'list-promote', id: ID }), `#/list/${ID}/promote`);
  assert.ok(PROTECTED_SCREENS.includes('list-promote'));
  assert.deepEqual(resolveRoute({ screen: 'list-promote', id: ID }, false), { screen: 'signin' });
  assert.equal(tabFor('list-promote'), 'profile');
  for (const screen of ['ad', 'board']) {
    const route = { screen, id: ID };
    assert.deepEqual(parseRoute(`#/${screen}/${ID}`), route);
    assert.equal(hashFor(route), `#/${screen}/${ID}`);
    assert.ok(!PROTECTED_SCREENS.includes(screen));
    assert.deepEqual(resolveRoute(route, false), route);
  }
});

test('S11: coming back from Paystack (?trxref=…) still opens the Promote page', () => {
  assert.deepEqual(parseRoute(`#/list/${ID}/promote?trxref=abc&reference=abc`), { screen: 'list-promote', id: ID });
});

test('S11: the prices are the same in the app, the database and the payment function', () => {
  assert.deepEqual(BOOSTS.map((b) => [b.tier, b.rands, b.days]), [['week', 49, 7], ['fortnight', 99, 14], ['month', 179, 30]]);
  const sql = read('../supabase/014_promote.sql');
  assert.match(sql, /\('week', 49, 7\), \('fortnight', 99, 14\), \('month', 179, 30\)/);
  const fn = read('../supabase/functions/promote/index.ts');
  assert.match(fn, /week: \{ rands: 49, days: 7 \}, fortnight: \{ rands: 99, days: 14 \}, month: \{ rands: 179, days: 30 \}/);
});

test('S11: a boost reads plainly and only the month boost is Featured', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  assert.equal(boostLine({ boost_until: '2026-12-03T10:00:00Z', boost_tier: 'week' }, now), 'Boosted until 3 December');
  assert.equal(boostLine({ boost_until: '2026-12-03T10:00:00Z', boost_tier: 'month' }, now), 'Featured until 3 December');
  assert.equal(boostLine({ boost_until: '2026-11-01T10:00:00Z', boost_tier: 'month' }, now), null);
  assert.equal(isFeatured({ boost_until: '2026-12-03T10:00:00Z', boost_tier: 'month' }, now), true);
  assert.equal(isFeatured({ boost_until: '2026-12-03T10:00:00Z', boost_tier: 'fortnight' }, now), false);
  assert.equal(isFeatured({ featured: true }), true);
});

test('S11: the social post words and link', () => {
  const link = listingLink(ID, 'https://example.test/street_property/');
  assert.equal(link, `https://example.test/street_property/#/place/${ID}`);
  const words = socialCaption({ mode: 'rent', bedrooms: 2, kind: 'flat', area: 'Orlando West', city: 'Soweto', price_rands: 6500, verified_at: 'x' }, link);
  assert.match(words, /^To let: 2-bedroom flat in Orlando West, Soweto\. R6 500 a month\./);
  assert.match(words, /Street Verified/);
  assert.ok(words.endsWith(link));
  assert.match(socialCaption({ mode: 'sell', bedrooms: 0, kind: 'backyard_room', area: 'A', city: 'B', price_rands: 450000 }, link), /^For sale: backyard room in A, B\. R450 000\./);
});

test('S11: the true monthly cost adds the renter’s estimates', () => {
  assert.equal(electricityGuess(0), 450);
  assert.equal(electricityGuess(2), 900);
  assert.equal(electricityGuess(9), 1500);
  const cost = trueMonthlyCost({ rent: 6500, deposit: 6500, extras: { electricity: '900', water: '', transport: '1200', bad: '-50' } });
  assert.deepEqual([cost.monthly, cost.extra, cost.moveIn], [8600, 2100, 13000]);
  assert.equal(shareOfPay(8600, 20000), 43);
  assert.equal(shareOfPay(8600, ''), null);
});

test('S11: boosts are paid only after Paystack confirms, for the right amount', () => {
  const fn = read('../supabase/functions/promote/index.ts');
  assert.match(fn, /x-paystack-signature/);
  assert.match(fn, /hmacSha512Hex\(SECRET, raw\)/);
  assert.match(fn, /\/transaction\/verify\//);
  assert.match(fn, /paid\.currency === 'ZAR'/);
  const sql = read('../supabase/014_promote.sql');
  assert.match(sql, /p_amount_cents is distinct from b\.amount_rands \* 100/);
  assert.match(sql, /grant execute on function public\.boost_paid\(uuid, integer\) to service_role/);
  assert.match(sql, /order by m\.boost_rank desc, m\.reviewed_at desc nulls last, m\.id/);
  assert.match(read('../supabase/tests/014_dryrun.sql'), /all 8 checks passed/);
});

test('S11: the QR code library is pinned with an integrity hash', () => {
  const api = read('../src/promote/api.js');
  assert.match(api, /qrcode-generator\/1\.4\.4\/qrcode\.min\.js/);
  assert.match(api, /integrity: 'sha384-[A-Za-z0-9+/=]{64}'/);
});

test('S11: the screens are wired up', () => {
  const app = read('../src/app.js');
  assert.match(app, /'list-promote': renderPromote/);
  assert.match(app, /ad: renderAd/);
  assert.match(app, /board: renderBoard/);
  assert.match(read('../src/screens/place.js'), /What it really costs/);
  assert.match(read('../src/screens/listsend.js'), /Promote this place/);
  assert.match(read('../src/screens/explore.js'), /place-card__badge--featured/);
});

test('S11: promote problems have plain sentences', () => {
  for (const hint of ['boost_not_live', 'boost_tier', 'promote_down', 'boost_too_many']) {
    const text = friendlyListingError({ hint });
    assert.ok(text && !/hint|undefined/i.test(text), hint);
  }
});
