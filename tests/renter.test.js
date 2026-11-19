import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coverLine, renterStates, checkShare, householdLine, moveInLine, LEASE_CHOICES } from '../src/renter/rules.js';
import { parseRoute, hashFor, resolveRoute, tabFor, PROTECTED_SCREENS } from '../src/router.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1b2c3d4e5f60';

test('S7: renter check, owner view and reports screens need an account', () => {
  const cases = {
    '#/renter-check': { screen: 'renter-check' },
    [`#/enquiries/${ID}/check`]: { screen: 'enquiry-check', id: ID },
    '#/review/reports': { screen: 'review-reports' },
    [`#/review/check/income/${ID}`]: { screen: 'review-check', kind: 'income', id: ID },
  };
  for (const [hash, route] of Object.entries(cases)) {
    assert.deepEqual(parseRoute(hash), route, hash);
    assert.equal(hashFor(route), hash);
    assert.ok(PROTECTED_SCREENS.includes(route.screen), route.screen);
    assert.equal(resolveRoute(route, false).screen, 'signin');
  }
  assert.equal(tabFor('enquiry-check'), 'enquiries');
  assert.equal(tabFor('renter-check'), 'profile');
  const app = read('../src/app.js');
  for (const name of ["'renter-check': renderRenterCheck", "'enquiry-check': renderEnquiryCheck", "'review-reports': renderReports"]) assert.ok(app.includes(name), name);
});

test('S7: how the pay compares to the rent', () => {
  assert.deepEqual(coverLine(3.1), { text: '3.1×', words: 'take-home pay covers the rent', strength: 'strong' });
  assert.equal(coverLine(2.6).strength, 'fair');
  assert.equal(coverLine(1.8).strength, 'low');
  assert.equal(coverLine(null), null);
});

test('S7: what the renter sees about their own check', () => {
  assert.deepEqual(renterStates(null).map((s) => s.state), ['needed', 'needed']);
  const r = renterStates({ identity_status: 'approved', income_status: 'expired' });
  assert.deepEqual(r.map((s) => s.state), ['done', 'expired']);
  assert.match(r[1].note, /3 months/);
  assert.equal(renterStates({ income_status: 'rejected', income_note: 'Payslip is from 2024.' })[1].note, 'Payslip is from 2024.');
});

test('S7: sharing: move-in within a year, a real lease length, a short household note', () => {
  const today = '2026-11-19';
  assert.deepEqual(checkShare({ moveIn: '2026-12-01', leaseMonths: 12, household: 'Me and 1 child' }, today), {});
  assert.deepEqual(checkShare({ moveIn: null, leaseMonths: null, household: '' }, today), {});
  assert.ok(checkShare({ moveIn: '2026-11-01' }, today).moveIn);
  assert.ok(checkShare({ moveIn: '2028-01-01' }, today).moveIn);
  assert.ok(checkShare({ leaseMonths: 18 }, today).leaseMonths);
  assert.ok(checkShare({ household: 'x'.repeat(121) }, today).household);
  assert.deepEqual(LEASE_CHOICES, [6, 12, 24, 36]);
  assert.match(read('../supabase/008_renter_check.sql'), /lease_months in \(6, 12, 24, 36\)/);
});

test('S7: the owner reads it in plain words', () => {
  assert.equal(householdLine({ household: 'Me and 1 child', has_pets: false }), 'Me and 1 child · no pets');
  assert.equal(householdLine({ household: null, has_pets: null }), 'Household not given');
  assert.equal(moveInLine({ move_in: '2026-12-01', lease_months: 12 }), 'Wants to move in 1 December, for 12 months');
  assert.equal(moveInLine({ move_in: null, lease_months: 6 }), 'For 6 months');
  assert.equal(moveInLine({}), 'Move-in date not given');
});

test('S7: the owner never sees documents or the amount, only the ratio', () => {
  const sql = read('../supabase/008_renter_check.sql');
  assert.match(sql, /round\(n\.monthly_income_rands::numeric \/ l\.price_rands, 1\)/);
  assert.match(sql, /and \(e\.shared_at is not null or e\.renter_id = auth\.uid\(\) or e\.owner_decision is not null\)/);
  assert.match(sql, /grant select \(user_id, status, monthly_income_rands, note, submitted_at, decided_at, valid_until\) on public\.income_checks/);
  assert.match(sql, /using \(\(select auth\.uid\(\)\) = user_id or \(select public\.is_admin\(\)\)\)/, 'only the renter and admins read an income check');
  assert.match(sql, /valid_until = case when p_approve then current_date \+ 90 end/);
  assert.match(sql, /doc_paths = '\{\}'/);
  // Not this time removes the shared details.
  assert.match(sql, /owner_decision = 'declined', decided_at = now\(\),\s+shared_at = null/);
});

test('S7: emails: private outbox, one per conversation per 15 minutes, can be turned off', () => {
  const sql = read('../supabase/009_reports_email.sql');
  assert.match(sql, /revoke all on public\.email_outbox from anon, authenticated;/);
  assert.match(sql, /interval '15 minutes'/);
  assert.match(sql, /email_notifications/);
  assert.match(sql, /exception when others then\s+-- Never block the app/);
  const fn = read('../supabase/functions/send-emails/index.ts');
  assert.match(fn, /BREVO_API_KEY/);
  assert.match(fn, /RESEND_API_KEY/);
  assert.match(fn, /Turn them off in your Profile/);
  assert.match(fn, /\.eq\('attempts', email\.attempts\)/, 'an email is claimed before sending, so it is never sent twice');
  assert.doesNotMatch(fn, /re_[A-Za-z0-9]{10,}|xkeysib-/, 'no API key in the code');
});

test('S7: reports can only be read by admins, and only while open', () => {
  const sql = read('../supabase/009_reports_email.sql');
  assert.match(sql, /where r\.id = p_report and r\.resolved_at is null/);
  assert.match(sql, /Only admins handle reports/);
  assert.match(read('../src/screens/legal.js'), /deleted as soon as the check is done/);
});
