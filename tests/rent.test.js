import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rentStatus, rentToPay, ratingLine, monthWords } from '../src/deals/rules.js';
import { parseRoute, hashFor, resolveRoute, tabFor, PROTECTED_SCREENS } from '../src/router.js';
import { friendlyListingError } from '../src/listings/errors.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1b2c3d4e5f60';

test('S10: the rent record needs an account and sits under Enquiries', () => {
  const route = { screen: 'deal-rent', id: ID };
  assert.deepEqual(parseRoute(`#/deals/${ID}/rent`), route);
  assert.equal(hashFor(route), `#/deals/${ID}/rent`);
  assert.ok(PROTECTED_SCREENS.includes('deal-rent'));
  assert.deepEqual(resolveRoute(route, false), { screen: 'signin' });
  assert.equal(tabFor('deal-rent'), 'enquiries');
});

test('S10: each month of rent is paid, paying, late, due or later', () => {
  const today = '2027-02-10';
  assert.equal(rentStatus({ state: 'paid', due_date: '2027-01-01' }, today), 'paid');
  assert.equal(rentStatus({ state: 'waiting', due_date: '2027-02-01' }, today), 'paying');
  assert.equal(rentStatus({ state: 'due', due_date: '2027-02-06' }, today), 'late');
  assert.equal(rentStatus({ state: 'due', due_date: '2027-02-07' }, today), 'due');
  assert.equal(rentStatus({ state: 'due', due_date: '2027-02-20' }, today), 'due');
  assert.equal(rentStatus({ state: 'due', due_date: '2027-03-01' }, today), 'later');
});

test('S10: the renter pays the earliest unpaid month, once it is due', () => {
  const lines = [
    { month_no: 1, state: 'paid', due_date: '2027-01-01' },
    { month_no: 2, state: 'due', due_date: '2027-02-01' },
    { month_no: 3, state: 'due', due_date: '2027-03-01' },
  ];
  assert.equal(rentToPay(lines, '2027-01-25').month_no, 2);
  assert.equal(rentToPay(lines, '2027-01-10'), null);
  assert.equal(rentToPay(lines.map((l) => ({ ...l, state: 'paid' })), '2027-03-01'), null);
  assert.equal(monthWords('2027-02-01'), 'February 2027');
});

test('S10: ratings read plainly, and are hidden until there is one', () => {
  assert.equal(ratingLine({ average: 4.75, reviews: 5 }, 'owner'), '★ 4.8 from 5 renters');
  assert.equal(ratingLine({ average: 4, reviews: 1 }, 'renter'), '★ 4.0 from 1 owner');
  assert.equal(ratingLine({ average: null, reviews: 0 }, 'owner'), null);
  assert.equal(ratingLine(null, 'owner'), null);
});

test('S10: the database keeps receipts, reminds daily and keeps reviews blind', () => {
  const sql = read('../supabase/013_rent_reviews.sql');
  assert.match(sql, /create trigger start_rent_record after update of status on public\.deals/);
  assert.match(sql, /cron\.schedule\('street-property-rent-reminders', '0 5 \* \* \*'/);
  assert.match(sql, /grant execute on function public\.safe_record_rent\(uuid, integer, text, text\) to service_role/);
  assert.match(sql, /revoke all on public\.deal_reviews from anon, authenticated/);
  assert.match(sql, /interval '14 days'/);
  assert.match(sql, /grant execute on function public\.rating_summary\(uuid, text\) to anon, authenticated/);
  assert.match(read('../supabase/tests/013_dryrun.sql'), /all 10 checks passed/);
});

test('S10: rent through Street Safe is passed straight to the owner, in order', () => {
  const fn = read('../supabase/functions/street-safe/index.ts');
  assert.match(fn, /action === 'pay_rent'/);
  assert.match(fn, /throw new UserProblem\('rent_in_order'\)/);
  assert.match(fn, /rent_payments'\)\.select\([^)]*\)\.eq\('safe_tx', txId\)/);
  assert.match(fn, /async function settlePassThrough/);
});

test('S10: the screens are wired up', () => {
  assert.match(read('../src/app.js'), /'deal-rent': renderDealRent/);
  assert.match(read('../src/screens/deal.js'), /Rate your deal/);
  assert.match(read('../src/screens/place.js'), /ratingSummary\(listing\.owner_id, 'owner'\)/);
  assert.match(read('../src/screens/renter.js'), /renterRatingFor\(route\.id\)/);
});

test('S10: rent and review problems have plain sentences', () => {
  for (const hint of ['rent_in_order', 'rent_too_early', 'rent_paying', 'review_too_early', 'review_done', 'review_stars']) {
    const text = friendlyListingError({ hint });
    assert.ok(text && !/hint|undefined/i.test(text), hint);
  }
});
