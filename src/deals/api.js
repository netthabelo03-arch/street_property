// The Street Safe deal: "We met" at the viewing, the lease, the move-in check
// and the keys. Everything is written through database functions; move-in
// photos sit in a private bucket only the two people (and admins) can open.

import { getClient } from '../auth/client.js';
import { stampPhoto } from '../media/photos.js';
import { CHECK_PHOTO, photoPath } from './rules.js';

const BUCKET = 'deal-photos';

function check({ data, error }) {
  if (error) throw error;
  return data;
}

/** Tap "We met" at the address. Returns 'waiting' or 'both'. */
export async function markMet(viewingId, { lat, lng, accuracy }) {
  const client = await getClient();
  return check(await client.rpc('mark_met', { p_viewing: viewingId, p_lat: lat, p_lng: lng, p_accuracy: accuracy ?? null }));
}

/** Who has tapped "We met" for a viewing. */
export async function metState(viewingId) {
  if (!viewingId) return null;
  const client = await getClient();
  return check(await client.from('viewings').select('met_renter_at, met_owner_at').eq('id', viewingId).maybeSingle());
}

/** The deal started from this conversation, if there is one. */
export async function dealFor(enquiryId) {
  const client = await getClient();
  const row = check(await client.from('deals').select('id, status').eq('enquiry_id', enquiryId).maybeSingle());
  return row ?? null;
}

export async function myDeals() {
  const client = await getClient();
  return check(await client.rpc('my_deals'));
}

export async function getDeal(id) {
  const client = await getClient();
  const rows = check(await client.rpc('deal_view', { p_deal: id }));
  return rows[0] ?? null;
}

export async function sendLease(id, { rent, deposit, start, months, special, parts = 1 }) {
  const client = await getClient();
  check(await client.rpc('send_lease', {
    p_deal: id,
    p_rent: Number(rent),
    p_deposit: deposit === '' || deposit === null || deposit === undefined ? null : Number(deposit),
    p_start: start,
    p_months: Number(months),
    p_special: special || null,
    p_parts: Number(parts) || 1,
  }));
}

/** Sign the lease text whose fingerprint the person was shown. */
export async function signLease(id, name, hash) {
  const client = await getClient();
  return check(await client.rpc('sign_lease', { p_deal: id, p_name: name, p_hash: hash }));
}

export async function cancelDeal(id) {
  const client = await getClient();
  check(await client.rpc('cancel_deal', { p_deal: id }));
}

/** Every move-in photo and note, with links that work for an hour. */
export async function inspection(id) {
  const client = await getClient();
  const [photos, notes] = await Promise.all([
    client.from('inspection_photos').select('id, room, path, taken_by, created_at').eq('deal_id', id).order('created_at'),
    client.from('inspection_rooms').select('room, note, updated_at').eq('deal_id', id),
  ]);
  const photoRows = check(photos);
  const noteRows = check(notes);
  if (photoRows.length) {
    const signed = check(await client.storage.from(BUCKET).createSignedUrls(photoRows.map((p) => p.path), 3600));
    const byPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
    for (const photo of photoRows) photo.url = byPath.get(photo.path) ?? null;
  }
  return { photos: photoRows, notes: Object.fromEntries(noteRows.map((n) => [n.room, n.note ?? ''])) };
}

/** Stamp, upload and record one move-in photo. */
export async function addRoomPhoto(dealId, room, file, stamp) {
  const client = await getClient();
  const body = await stampPhoto(file, stamp, CHECK_PHOTO);
  const path = photoPath(dealId, room);
  check(await client.storage.from(BUCKET).upload(path, body, { contentType: 'image/jpeg', upsert: false }));
  try {
    check(await client.rpc('add_inspection_photo', { p_deal: dealId, p_room: room, p_path: path }));
  } catch (error) {
    await client.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
}

export async function setRoomNote(dealId, room, note) {
  const client = await getClient();
  check(await client.rpc('set_room_note', { p_deal: dealId, p_room: room, p_note: note }));
}

export async function signInspection(id) {
  const client = await getClient();
  return check(await client.rpc('sign_inspection', { p_deal: id }));
}

export async function confirmKeys(id) {
  const client = await getClient();
  check(await client.rpc('confirm_keys', { p_deal: id }));
}

// Street Safe (TradeSafe) -------------------------------------------------------

/**
 * Call the street-safe Edge Function. Returns its answer, { waiting: true }
 * when payments are not switched on yet, or throws { hint } for a problem.
 */
export async function streetSafe(action, body = {}) {
  const client = await getClient();
  const { data, error } = await client.functions.invoke('street-safe', { body: { action, ...body } });
  if (error) {
    let code = 'street_safe_down';
    try {
      const answer = await error.context.json();
      if (answer?.error) code = answer.error;
    } catch {
      // keep the general problem
    }
    throw { hint: code };
  }
  return data;
}

/** The caller's payout account: bank, type and last 4 digits only. */
export async function myPayoutAccount(userId) {
  const client = await getClient();
  return check(await client.from('safe_accounts').select('bank, account_last4, account_type, can_receive, updated_at').eq('user_id', userId).maybeSingle());
}

/** The later parts of a deposit plan (part 2 and 3), with what is paid. */
export async function depositParts(dealId) {
  const client = await getClient();
  return check(await client.from('deposit_payments').select('part, amount_rands, due_date, safe_state, paid_at').eq('deal_id', dealId).order('part'));
}

// Rent record and reviews (Sprint 10) -----------------------------------------------

export async function rentRecord(dealId) {
  const client = await getClient();
  return check(await client.from('rent_payments').select('month_no, due_date, amount_rands, state, method, note, paid_at').eq('deal_id', dealId).order('month_no'));
}

export async function markRentReceived(dealId, month, note) {
  const client = await getClient();
  check(await client.rpc('mark_rent_received', { p_deal: dealId, p_month: month, p_note: note || null }));
}

export async function reviewDeal(dealId, stars, words) {
  const client = await getClient();
  return check(await client.rpc('review_deal', { p_deal: dealId, p_stars: stars, p_words: words || null }));
}

export async function dealReviews(dealId) {
  const client = await getClient();
  return check(await client.rpc('deal_reviews_for', { p_deal: dealId }));
}

/** { average, reviews } for someone as an owner ('owner') or as a renter ('renter'). */
export async function ratingSummary(userId, side) {
  const client = await getClient();
  const rows = check(await client.rpc('rating_summary', { p_user: userId, p_side: side }));
  return rows[0] ?? { average: null, reviews: 0 };
}

export async function reviewsAbout(userId, side) {
  const client = await getClient();
  return check(await client.rpc('reviews_about', { p_user: userId, p_side: side }));
}

export async function renterRatingFor(enquiryId) {
  const client = await getClient();
  const rows = check(await client.rpc('renter_rating_for', { p_enquiry: enquiryId }));
  return rows[0] ?? { average: null, reviews: 0 };
}
