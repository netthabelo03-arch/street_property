// The Street Safe deal: its steps, the lease terms and the move-in check.
// supabase/010_deals.sql enforces the same rules.

export const LEASE_MONTHS = [6, 12, 24, 36];
export const DEPOSIT_PARTS = [1, 2, 3];
export const SPECIAL_TERMS_MAX = 1000;
export const ROOM_NOTE_MAX = 500;
export const ROOM_PHOTOS_MAX = 12;
/** Move-in photos: big enough to show a scratch, small enough for a phone's data. */
export const CHECK_PHOTO = { max: 1600, maxBytes: 4 * 1024 * 1024 };

const ROOM_NAMES = {
  outside: 'Outside and gate',
  lounge: 'Lounge',
  kitchen: 'Kitchen',
  meters: 'Meters and backup',
};

/** "bedroom_2" → "Bedroom 2"; with one bedroom, just "Bedroom". */
export function roomName(id, rooms = []) {
  if (ROOM_NAMES[id]) return ROOM_NAMES[id];
  const match = /^(bedroom|bathroom)_(\d)$/.exec(String(id));
  if (!match) return String(id);
  const word = match[1] === 'bedroom' ? 'Bedroom' : 'Bathroom';
  const many = rooms.filter((room) => room.startsWith(`${match[1]}_`)).length > 1;
  return many ? `${word} ${match[2]}` : word;
}

/** How many rooms have at least one photo. */
export function roomProgress(rooms, photos) {
  const done = rooms.filter((room) => photos.some((photo) => photo.room === room)).length;
  return { done, total: rooms.length, complete: rooms.length > 0 && done === rooms.length };
}

/**
 * The seven steps of the deal, in the order they happen, each 'done', 'now',
 * 'next' or 'skipped' (an optional step that was passed by).
 * @param {object} deal a row from deal_view
 */
export function dealSteps(deal) {
  const signed = ['signed', 'moved_in'].includes(deal.status);
  const checked = Boolean(deal.owner_checked_at && deal.renter_checked_at);
  const paid = ['paid', 'released'].includes(deal.safe_state);
  const over = ['moved_in', 'cancelled'].includes(deal.status) || deal.safe_state === 'refunded';
  const steps = [
    { id: 'verified', title: 'Listing is Street Verified', done: Boolean(deal.listing_verified), optional: true },
    { id: 'met', title: 'Viewing done in person', done: Boolean(deal.met_both), optional: true },
    { id: 'renter', title: 'Renter checked', done: true },
    { id: 'lease', title: 'Lease signed in the app', done: signed },
    { id: 'deposit', title: 'Rent and deposit held by Street Safe', done: paid, payment: true },
    { id: 'check', title: 'Move-in check together', done: checked },
    { id: 'keys', title: 'Keys handed over', done: Boolean(deal.keys_at) },
  ];
  let nowGiven = deal.status === 'cancelled';
  return steps.map((step) => {
    if (step.done) return { ...step, state: 'done' };
    if (step.optional) return { ...step, state: 'skipped' };
    if (step.payment) {
      if (over) return { ...step, state: 'skipped' };
      if (signed && !nowGiven) {
        nowGiven = true;
        return { ...step, state: 'now' };
      }
      return { ...step, state: 'next' };
    }
    if (!nowGiven) {
      nowGiven = true;
      return { ...step, state: 'now' };
    }
    return { ...step, state: 'next' };
  });
}

/** What the person should do next, in one line. */
export function nextAction(deal) {
  const owner = deal.my_side === 'owner';
  const other = deal.other_name;
  if (deal.status === 'cancelled') return 'This deal was called off.';
  if (deal.status === 'moved_in') return owner ? `${other} has moved in.` : 'You have moved in. Welcome home!';
  if (deal.status === 'agreeing') return owner ? 'Fill in the lease terms and send the lease to sign.' : `Waiting for ${other} to send the lease.`;
  if (deal.status === 'signing') {
    const mine = owner ? deal.owner_signed_at : deal.renter_signed_at;
    return mine ? `Waiting for ${other} to sign the lease.` : 'Read the lease and sign it.';
  }
  if (deal.safe_state === 'none' || deal.safe_state === 'waiting') {
    if (owner) return deal.owner_can_receive ? `${other} can now pay the rent and deposit into Street Safe.` : `Set up Street Safe payouts so ${other} can pay safely.`;
    if (deal.safe_state === 'waiting') return 'Your payment is on its way. It can take up to 36 hours by EFT.';
    return deal.owner_can_receive ? 'Pay the first month\u2019s rent and the deposit into Street Safe.' : `Waiting for ${other} to set up Street Safe payouts.`;
  }
  const mineChecked = owner ? deal.owner_checked_at : deal.renter_checked_at;
  const theirsChecked = owner ? deal.renter_checked_at : deal.owner_checked_at;
  if (!mineChecked || !theirsChecked) {
    return mineChecked ? `Waiting for ${other} to sign the move-in check.` : 'Walk through the place together and photograph every room.';
  }
  return owner ? `Waiting for ${other} to confirm they have the keys.` : 'Got the keys? Confirm it here.';
}

/** The move-in payment into Street Safe: the first month's rent and the deposit (or its first part). */
export function safeTotal(deal) {
  const rent = Number(deal.safe_rent_rands ?? deal.rent_rands ?? 0);
  const deposit = Number(deal.safe_deposit_rands ?? deal.first_deposit_rands ?? deal.deposit_rands ?? 0);
  return rent + deposit;
}

/**
 * A deposit plan, as the database works it out (deposit_plan in
 * 012_deposit_plans.sql): equal parts in whole rands, the first part takes
 * what is left over; part 1 before moving in, part n with the rent n-1 months
 * after the start date.
 */
export function depositPlan(deposit, parts, start) {
  const total = Number(deposit) || 0;
  const count = Math.max(1, Number(parts) || 1);
  const each = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => {
    const due = new Date(`${start}T00:00:00Z`);
    const day = due.getUTCDate();
    due.setUTCDate(1);
    due.setUTCMonth(due.getUTCMonth() + i);
    const last = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
    due.setUTCDate(Math.min(day, last));
    return { part: i + 1, amount: i === 0 ? total - each * (count - 1) : each, due: Number.isNaN(due.getTime()) ? null : due.toISOString().slice(0, 10) };
  });
}

// Payouts --------------------------------------------------------------------------

export const PAYOUT_BANKS = [
  { id: 'absa', name: 'Absa' },
  { id: 'african', name: 'African Bank' },
  { id: 'capitec', name: 'Capitec' },
  { id: 'discovery', name: 'Discovery Bank' },
  { id: 'fnb', name: 'FNB' },
  { id: 'investec', name: 'Investec' },
  { id: 'nedbank', name: 'Nedbank' },
  { id: 'standard', name: 'Standard Bank' },
  { id: 'tyme', name: 'TymeBank' },
];
export const ACCOUNT_TYPES = [
  { id: 'cheque', name: 'Cheque or current' },
  { id: 'savings', name: 'Savings' },
  { id: 'transmission', name: 'Transmission' },
];

/** A South African ID number: 13 digits with a valid check digit (Luhn). */
export function validIdNumber(text) {
  const digits = String(text ?? '').replace(/\s/g, '');
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i += 1) {
    let n = Number(digits[12 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** The same checks the Edge Function makes, before anything is sent. */
export function checkPayout({ bank, accountType, accountNumber, idNumber }) {
  const errors = {};
  if (!PAYOUT_BANKS.some((b) => b.id === bank)) errors.bank = 'Choose your bank.';
  if (!ACCOUNT_TYPES.some((t) => t.id === accountType)) errors.accountType = 'Choose the account type.';
  if (!/^\d{6,16}$/.test(String(accountNumber ?? '').replace(/\s/g, ''))) errors.accountNumber = 'Check the account number: digits only.';
  if (!validIdNumber(idNumber)) errors.idNumber = 'Enter your 13-digit South African ID number.';
  return errors;
}

/** "FNB cheque account ending 4417" */
export function payoutLine(account) {
  if (!account?.can_receive) return null;
  const bank = PAYOUT_BANKS.find((b) => b.id === account.bank)?.name ?? account.bank;
  const type = ACCOUNT_TYPES.find((t) => t.id === account.account_type)?.name.toLowerCase() ?? 'bank';
  return `${bank} ${type} account ending ${account.account_last4}`;
}

/** The same checks the database makes before the lease is sent. */
export function checkLeaseTerms({ rent, deposit, start, months, special, parts = 1 }, today) {
  const errors = {};
  const rentNumber = Number(rent);
  if (!Number.isInteger(rentNumber) || rentNumber < 300 || rentNumber > 500000) errors.rent = 'Enter the monthly rent, from R300.';
  if (deposit !== '' && deposit !== null && deposit !== undefined) {
    const value = Number(deposit);
    if (!Number.isInteger(value) || value < 0 || value > 10000000) errors.deposit = 'Check the deposit amount.';
  }
  const days = (new Date(`${start}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start)) || Number.isNaN(days) || days < 0 || days > 365) errors.start = 'Choose a start date in the next 12 months.';
  if (!LEASE_MONTHS.includes(Number(months))) errors.months = 'Choose 6, 12, 24 or 36 months.';
  if (String(special ?? '').length > SPECIAL_TERMS_MAX) errors.special = `Keep special terms under ${SPECIAL_TERMS_MAX} characters.`;
  const count = Number(parts ?? 1);
  if (!DEPOSIT_PARTS.includes(count)) errors.parts = 'Choose 1, 2 or 3 deposit parts.';
  else if (count > 1 && (Number(deposit) || 0) < 300 * count) errors.parts = 'A deposit paid in parts must be at least R300 a part.';
  else if (count > Number(months)) errors.parts = 'The lease is shorter than the deposit plan.';
  return errors;
}

/** A signature is a full name: at least a first name and a surname. */
export function checkSignatureName(name) {
  const text = String(name ?? '').trim();
  if (text.length < 3 || text.length > 120 || !/\s/.test(text)) return 'Type your full name: first name and surname.';
  return null;
}

/** The text burned into a move-in photo: the place, the room and the time. */
export function photoStamp({ area, room, at = new Date() }) {
  const time = at.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  return [area, room, time].filter(Boolean).join('  ·  ');
}

/** A random, safe file name for a photo in the deal's room folder. */
export function photoPath(dealId, room, random = () => Math.random().toString(36).slice(2, 10)) {
  return `${dealId}/${room}/${Date.now()}-${random()}.jpg`;
}

/** SHA-256 of the lease text, as the database stores it (hex). */
export async function leaseFingerprint(text, subtle = globalThis.crypto?.subtle) {
  const bytes = new TextEncoder().encode(text);
  const hash = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** "a1b2c3d4…" → "A1B2 C3D4" for people to compare. */
export function shortFingerprint(hash) {
  return String(hash ?? '').slice(0, 8).toUpperCase().replace(/(.{4})/, '$1 ');
}

// Rent record (Sprint 10) ----------------------------------------------------------

/** "January 2027" */
export function monthWords(day) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Where a month of rent stands: 'paid', 'paying' (Street Safe payment on its
 * way), 'late' (more than 3 days after the due date), 'due' (from 10 days
 * before the due date), or 'later'.
 */
export function rentStatus(line, today) {
  if (line.state === 'paid') return 'paid';
  if (line.state === 'waiting') return 'paying';
  const days = Math.round((new Date(`${line.due_date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
  if (days < -3) return 'late';
  if (days <= 10) return 'due';
  return 'later';
}

/** The month the renter can pay now: the earliest unpaid one, if it is due. */
export function rentToPay(lines, today) {
  const first = lines.find((line) => line.state !== 'paid');
  if (!first) return null;
  return ['due', 'late', 'paying'].includes(rentStatus(first, today)) ? first : null;
}

/** "4.8 from 5 renters" / "New: no reviews yet" */
export function ratingLine(summary, side) {
  const count = Number(summary?.reviews ?? 0);
  if (!count) return null;
  const who = side === 'owner' ? (count === 1 ? 'renter' : 'renters') : (count === 1 ? 'owner' : 'owners');
  return `★ ${Number(summary.average).toFixed(1)} from ${count} ${who}`;
}

export const REVIEW_WORDS_MAX = 500;
