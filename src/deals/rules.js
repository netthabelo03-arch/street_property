// The Street Safe deal: its steps, the lease terms and the move-in check.
// supabase/010_deals.sql enforces the same rules.

export const LEASE_MONTHS = [6, 12, 24, 36];
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
 * The seven steps of the deal, each 'done', 'now', 'next' or 'coming'.
 * @param {object} deal a row from deal_view
 */
export function dealSteps(deal) {
  const signed = ['signed', 'moved_in'].includes(deal.status);
  const checked = Boolean(deal.owner_checked_at && deal.renter_checked_at);
  const steps = [
    { id: 'verified', title: 'Listing is Street Verified', done: Boolean(deal.listing_verified), optional: true },
    { id: 'met', title: 'Viewing done in person', done: Boolean(deal.met_both), optional: true },
    { id: 'renter', title: 'Renter checked', done: true },
    { id: 'deposit', title: 'Deposit held by Street Safe', coming: true },
    { id: 'lease', title: 'Lease signed in the app', done: signed },
    { id: 'check', title: 'Move-in check together', done: checked },
    { id: 'keys', title: 'Keys handed over', done: Boolean(deal.keys_at) },
  ];
  let nowGiven = deal.status === 'cancelled';
  return steps.map((step) => {
    if (step.coming) return { ...step, state: 'coming' };
    if (step.done) return { ...step, state: 'done' };
    if (step.optional) return { ...step, state: 'skipped' };
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
  const mineChecked = owner ? deal.owner_checked_at : deal.renter_checked_at;
  const theirsChecked = owner ? deal.renter_checked_at : deal.owner_checked_at;
  if (!mineChecked || !theirsChecked) {
    return mineChecked ? `Waiting for ${other} to sign the move-in check.` : 'Walk through the place together and photograph every room.';
  }
  return owner ? `Waiting for ${other} to confirm they have the keys.` : 'Got the keys? Confirm it here.';
}

/** The same checks the database makes before the lease is sent. */
export function checkLeaseTerms({ rent, deposit, start, months, special }, today) {
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
