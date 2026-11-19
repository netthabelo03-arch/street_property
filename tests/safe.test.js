import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkPayout, validIdNumber, payoutLine, safeTotal, PAYOUT_BANKS, ACCOUNT_TYPES } from '../src/deals/rules.js';
import { parseRoute, hashFor, resolveRoute, tabFor, PROTECTED_SCREENS } from '../src/router.js';
import { friendlyListingError } from '../src/listings/errors.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('S9: the payouts screen needs an account and sits under Profile', () => {
  assert.deepEqual(parseRoute('#/payouts'), { screen: 'payouts' });
  assert.equal(hashFor({ screen: 'payouts' }), '#/payouts');
  assert.ok(PROTECTED_SCREENS.includes('payouts'));
  assert.deepEqual(resolveRoute({ screen: 'payouts' }, false), { screen: 'signin' });
  assert.equal(tabFor('payouts'), 'profile');
});

test('S9: SA ID numbers are checked with their check digit', () => {
  assert.equal(validIdNumber('8001015009087'), true);
  assert.equal(validIdNumber('8001015009088'), false);
  assert.equal(validIdNumber('800101500908'), false);
  assert.equal(validIdNumber('80010150090 87'), true);
});

test('S9: payout details are checked before anything is sent', () => {
  const ok = { bank: 'fnb', accountType: 'cheque', accountNumber: '62000123456', idNumber: '8001015009087' };
  assert.deepEqual(checkPayout(ok), {});
  assert.ok(checkPayout({ ...ok, bank: 'monzo' }).bank);
  assert.ok(checkPayout({ ...ok, accountType: '' }).accountType);
  assert.ok(checkPayout({ ...ok, accountNumber: '12-34' }).accountNumber);
  assert.ok(checkPayout({ ...ok, idNumber: '1234' }).idNumber);
});

test('S9: the payout account is shown by bank and last 4 digits only', () => {
  assert.equal(payoutLine({ can_receive: true, bank: 'fnb', account_type: 'cheque', account_last4: '4417' }), 'FNB cheque or current account ending 4417');
  assert.equal(payoutLine({ can_receive: false }), null);
  assert.equal(payoutLine(null), null);
});

test('S9: Street Safe holds the first month’s rent and the deposit', () => {
  assert.equal(safeTotal({ rent_rands: 6500, deposit_rands: 6500 }), 13000);
  assert.equal(safeTotal({ rent_rands: 6500, deposit_rands: null }), 6500);
  assert.equal(safeTotal({ rent_rands: 9, deposit_rands: 9, safe_rent_rands: 6500, safe_deposit_rands: 0 }), 6500);
});

test('S9: the Edge Function and the app agree on banks and account types', () => {
  const fn = read('../supabase/functions/street-safe/index.ts');
  for (const bank of PAYOUT_BANKS) assert.match(fn, new RegExp(`\\b${bank.id}: '`), bank.id);
  for (const type of ACCOUNT_TYPES) assert.match(fn, new RegExp(`\\b${type.id}: '`), type.id);
});

test('S9: bank details never stay with Street Property', () => {
  const sql = read('../supabase/011_street_safe.sql');
  assert.match(sql, /account_last4 text check \(account_last4 is null or account_last4 ~ '\^\[0-9\]\{4\}\$'\)/);
  assert.doesNotMatch(sql, /account_number|id_number/);
  assert.match(sql, /grant select \(user_id, bank, account_last4, account_type, can_receive, updated_at\) on public\.safe_accounts to authenticated/);
  assert.match(sql, /grant execute on function public\.safe_record\(uuid, text, text, integer, integer, text\[\]\) to service_role/);
  const fn = read('../supabase/functions/street-safe/index.ts');
  assert.match(fn, /account_last4: accountNumber\.slice\(-4\)/);
  assert.match(fn, /Never log the variables/);
  assert.doesNotMatch(fn, /console\.(log|error)\([^)]*accountNumber/);
});

test('S9: callbacks are never trusted: the state is asked from TradeSafe', () => {
  const fn = read('../supabase/functions/street-safe/index.ts');
  assert.match(fn, /url\.searchParams\.get\('callback'\) !== CALLBACK_KEY/);
  assert.match(fn, /query transaction\(\$id: ID!\)/);
  assert.match(fn, /deal\.status === 'cancelled'[\s\S]*transactionCancel/);
  assert.match(fn, /deal\.status === 'moved_in'[\s\S]*allocationAcceptDelivery/);
  assert.match(read('../supabase/tests/011_dryrun.sql'), /all 8 checks passed/);
});

test('S9: payment problems have plain sentences', () => {
  for (const hint of ['street_safe_down', 'owner_not_ready', 'phone_needed', 'pay_after_lease', 'id_number']) {
    const text = friendlyListingError({ hint });
    assert.ok(text && !/hint|undefined/i.test(text), hint);
  }
});
