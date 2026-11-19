import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizePhone, showPhone, whatsappLink, toStartsAt, checkViewingTime, todayInSouthAfrica, viewingParts,
  viewingStatus, upcomingViewings, shortTime, initials, enquiryTitle, enquiryPrice, looksRisky, firstMessage, MESSAGE_MAX,
} from '../src/enquiries/rules.js';
import { parseRoute, hashFor, resolveRoute, safeNext, tabFor, PROTECTED_SCREENS } from '../src/router.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1b2c3d4e5f60';

test('S4: Enquiries and conversations need an account', () => {
  assert.deepEqual(parseRoute('#/enquiries'), { screen: 'enquiries' });
  assert.deepEqual(parseRoute(`#/enquiries/${ID}`), { screen: 'enquiry', id: ID });
  assert.equal(hashFor({ screen: 'enquiry', id: ID }), `#/enquiries/${ID}`);
  for (const screen of ['enquiries', 'enquiry']) {
    assert.ok(PROTECTED_SCREENS.includes(screen));
    assert.equal(resolveRoute({ screen, id: ID }, false).screen, 'signin');
    assert.equal(tabFor(screen), 'enquiries');
  }
  assert.equal(safeNext(`#/enquiries/${ID}`), `#/enquiries/${ID}`);
  assert.equal(safeNext(`#/place/${ID}`), `#/place/${ID}`, 'Log in to ask the owner comes back to the place');
  assert.deepEqual(parseRoute('#/enquiries/abc'), { screen: 'explore' });
  const app = read('../src/app.js');
  assert.match(app, /enquiries: renderEnquiries/);
  assert.match(app, /enquiry: renderConversation/);
});

test('S4: cell numbers are kept in one form', () => {
  for (const typed of ['082 123 4567', '0821234567', '+27 82 123 4567', '27821234567', '(082) 123-4567']) {
    assert.equal(normalizePhone(typed), '+27821234567', typed);
  }
  for (const bad of ['', '12345', '0021234567', '+27 012 345 678', '+44 7700 900123', '082 123 456']) assert.equal(normalizePhone(bad), null, bad);
  assert.equal(showPhone('+27821234567'), '082 123 4567');
  assert.match('+27821234567', new RegExp(read('../supabase/005_enquiries.sql').match(/phone ~ '([^']+)'/)[1]), 'the database accepts what the app keeps');
});

test('S4: WhatsApp opens with a first message', () => {
  assert.equal(whatsappLink('+27821234567', 'Hi Lerato & co'), 'https://wa.me/27821234567?text=Hi%20Lerato%20%26%20co');
});

test('S4: viewing times are South African time', () => {
  assert.equal(toStartsAt('2026-11-22', '10:00'), '2026-11-22T08:00:00.000Z');
  assert.equal(toStartsAt('22/11/2026', '10:00'), null);
  const now = new Date('2026-11-19T08:00:00Z'); // 10:00 in Johannesburg
  assert.equal(checkViewingTime('2026-11-22', '10:00', now).error, null);
  assert.match(checkViewingTime('2026-11-22', '06:30', now).error, /between 07:00 and 19:00/);
  assert.match(checkViewingTime('2026-11-22', '19:30', now).error, /between 07:00 and 19:00/);
  assert.match(checkViewingTime('2026-11-19', '10:30', now).error, /at least an hour/);
  assert.match(checkViewingTime('2027-02-01', '10:00', now).error, /next 60 days/);
  assert.match(checkViewingTime('', '', now).error, /Choose a date/);
  assert.equal(todayInSouthAfrica(new Date('2026-11-19T23:30:00Z')), '2026-11-20', 'after 22:00 UTC it is already tomorrow in SA');
  assert.deepEqual(viewingParts('2026-11-22T08:00:00Z'), { month: 'NOV', day: '22', when: 'Sunday · 10:00' });
});

test('S4: what a viewing means to each person', () => {
  const base = { other_name: 'Lerato', my_side: 'renter' };
  assert.deepEqual(viewingStatus({ ...base, viewing_status: 'proposed', viewing_mine: true }), { text: 'Waiting for Lerato', chip: 'chip--waiting' });
  assert.deepEqual(viewingStatus({ ...base, viewing_status: 'proposed', viewing_mine: false }), { text: 'Lerato suggested this time', chip: 'chip--waiting' });
  assert.equal(viewingStatus({ ...base, viewing_status: 'confirmed' }).text, 'Confirmed');
  assert.equal(viewingStatus({ ...base, viewing_status: null }), null);
  const now = new Date('2026-11-19T08:00:00Z');
  const items = [
    { id: 'a', viewing_status: 'confirmed', viewing_at: '2026-11-25T08:00:00Z' },
    { id: 'b', viewing_status: 'proposed', viewing_at: '2026-11-20T08:00:00Z' },
    { id: 'c', viewing_status: 'cancelled', viewing_at: '2026-11-21T08:00:00Z' },
    { id: 'd', viewing_status: 'confirmed', viewing_at: '2026-11-10T08:00:00Z' },
    { id: 'e', viewing_status: null, viewing_at: null },
  ];
  assert.deepEqual(upcomingViewings(items, now).map((i) => i.id), ['b', 'a']);
});

test('S4: times in the list', () => {
  const now = new Date('2026-11-19T10:00:00Z');
  assert.equal(shortTime('2026-11-19T07:14:00Z', now), '09:14');
  assert.equal(shortTime('2026-11-18T07:14:00Z', now), 'Yesterday');
  assert.equal(shortTime('2026-11-16T07:14:00Z', now), 'Mon');
  assert.equal(shortTime('2026-11-02T07:14:00Z', now), '2 Nov');
  assert.equal(viewingParts('2026-12-05T08:00:00Z').day, '5', 'no leading zero on the date tile');
  assert.equal(initials('Lerato Dlamini'), 'LD');
  assert.equal(initials('The owner'), 'TO');
  assert.equal(initials(''), '?');
});

test('S4: the listing in a conversation', () => {
  const item = { listing_kind: 'flat', listing_bedrooms: 2, listing_area: 'Melville', listing_mode: 'rent', listing_price: 8500 };
  assert.equal(enquiryTitle(item), '2-bed flat in Melville');
  assert.equal(enquiryPrice(item), 'R8 500 a month');
  assert.match(firstMessage('rent'), /still available/);
  assert.match(firstMessage('sell'), /still for sale/);
  assert.equal(MESSAGE_MAX, 1000);
});

test('S4: messages asking for money before a viewing get a warning', () => {
  for (const risky of ['Please pay the deposit first to secure it', 'Send an EFT today', 'Use eWallet', 'My account number is 1234 5678 90', 'Send proof of payment', 'cash send R2000']) {
    assert.ok(looksRisky(risky), risky);
  }
  for (const fine of ['Yes, pets are fine.', 'Saturday at 10 works for me.', 'The room is available from 1 December.', 'Call me on 082']) {
    assert.ok(!looksRisky(fine), fine);
  }
});

test('S4: the database keeps conversations private and writes only through its functions', () => {
  const sql = read('../supabase/005_enquiries.sql');
  assert.match(sql, /revoke all on public\.enquiries, public\.messages, public\.viewings, public\.enquiry_reports from anon, authenticated;/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*on public\.(enquiries|messages|viewings)/);
  assert.match(sql, /\(select auth\.uid\(\)\) in \(renter_id, owner_id\)/);
  assert.match(sql, /'07:00'/);
  assert.match(sql, /'19:00'/);
  assert.match(sql, /interval '60 days'/);
  assert.match(sql, /char_length\(body\) between 1 and 1000/);
  // Address and number only after a confirmed viewing, until two days after it.
  assert.match(sql, /v\.status = 'confirmed' and v\.starts_at > now\(\) - interval '2 days'/);
  assert.match(sql, /p\.share_whatsapp and p\.phone is not null/);
  for (const fn of ['start_enquiry', 'send_message', 'propose_viewing', 'respond_viewing', 'cancel_viewing', 'report_enquiry', 'enquiry_list', 'unread_total']) {
    assert.ok(sql.includes(`'public.${fn}(`), fn);
  }
});

test('S4: Terms and Privacy cover messages and phone sharing', () => {
  const legal = read('../src/screens/legal.js');
  assert.match(legal, /WhatsApp sharing/);
  assert.match(legal, /never the house number/);
  assert.match(legal, /only by the two people/);
});
