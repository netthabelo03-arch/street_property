// Everything the listing screens need from Supabase. Each function throws on
// failure; screens show friendlyListingError(error).

import { getClient } from '../auth/client.js';

// Everyone may read these. The full street and the exact spot where the tour
// was filmed are private: owners and admins get them from listing_private().
const COLUMNS = 'id, owner_id, lister, mode, kind, street_public, area, city, price_rands, deposit_rands, bedrooms, bathrooms, parking, features, description, available_from, status, review_note, approx_lat, approx_lng, created_at, updated_at, submitted_at, reviewed_at';
const PHOTO_BUCKET = 'listing-photos';
const TOUR_BUCKET = 'listing-tours';
const LINK_SECONDS = 60 * 60;

function check({ data, error }) {
  if (error) throw error;
  return data;
}

/** Add the full street and exact spot to listings the caller owns (or to any, for an admin). */
async function withPrivate(listings) {
  if (listings.length === 0) return listings;
  const client = await getClient();
  const rows = check(await client.rpc('listing_private', { p_ids: listings.map((listing) => listing.id) }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return listings.map((listing) => {
    const extra = byId.get(listing.id);
    return extra ? { ...listing, street: extra.street, filmed_lat: extra.filmed_lat, filmed_lng: extra.filmed_lng } : listing;
  });
}

/** The signed-in person's listings, newest first. */
export async function myListings(userId) {
  const client = await getClient();
  return withPrivate(check(await client.from('listings').select(COLUMNS).eq('owner_id', userId).order('created_at', { ascending: false })));
}

/**
 * One listing, or null when it does not exist or may not be seen.
 * With `{ private: true }` (owner and admin screens) it includes the full street.
 */
export async function getListing(id, { private: withAddress = false } = {}) {
  const client = await getClient();
  const listing = check(await client.from('listings').select(COLUMNS).eq('id', id).maybeSingle());
  if (!listing || !withAddress) return listing;
  return (await withPrivate([listing]))[0];
}

export async function createListing(values) {
  const client = await getClient();
  const listing = check(await client.from('listings').insert(values).select(COLUMNS).single());
  return { ...listing, street: values.street };
}

export async function updateListing(id, values) {
  const client = await getClient();
  const listing = check(await client.from('listings').update(values).eq('id', id).select(COLUMNS).single());
  return { ...listing, street: values.street };
}

/** Delete a draft and its files. */
export async function deleteDraft(listing, photos, clips) {
  const client = await getClient();
  const photoPaths = photos.map((photo) => photo.path);
  const clipPaths = clips.map((clip) => clip.path);
  if (photoPaths.length) check(await client.storage.from(PHOTO_BUCKET).remove(photoPaths));
  if (clipPaths.length) check(await client.storage.from(TOUR_BUCKET).remove(clipPaths));
  check(await client.from('listings').delete().eq('id', listing.id));
}

/** Short-lived links to a set of files, in the same order (null where a link failed). */
async function links(bucket, paths) {
  if (paths.length === 0) return [];
  const client = await getClient();
  const data = check(await client.storage.from(bucket).createSignedUrls(paths, LINK_SECONDS));
  const byPath = new Map(data.map((item) => [item.path, item.signedUrl ?? null]));
  return paths.map((path) => byPath.get(path) ?? null);
}

/** The listing's photos in order, each with a link to show it. */
export async function listPhotos(listingId) {
  const client = await getClient();
  const rows = check(await client.from('listing_photos').select('id, path, position').eq('listing_id', listingId).order('position').order('created_at'));
  const urls = await links(PHOTO_BUCKET, rows.map((row) => row.path));
  return rows.map((row, index) => ({ ...row, url: urls[index] }));
}

/** Upload one (already shrunk) photo and add it at the end. */
export async function addPhoto({ userId, listingId, blob, position }) {
  const client = await getClient();
  const path = `${userId}/${listingId}/photos/${crypto.randomUUID()}.jpg`;
  check(await client.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
  try {
    return check(await client.from('listing_photos').insert({ listing_id: listingId, path, position }).select('id, path, position').single());
  } catch (error) {
    await client.storage.from(PHOTO_BUCKET).remove([path]);
    throw error;
  }
}

export async function removePhoto(photo) {
  const client = await getClient();
  check(await client.from('listing_photos').delete().eq('id', photo.id));
  await client.storage.from(PHOTO_BUCKET).remove([photo.path]);
}

/** Save a new order: `photos` in the order they should show. */
export async function reorderPhotos(photos) {
  const client = await getClient();
  await Promise.all(photos.map(async (photo, position) => {
    if (photo.position !== position) check(await client.from('listing_photos').update({ position }).eq('id', photo.id));
  }));
}

/**
 * The tour clips, each with a link to play it. With `{ places: true }`
 * (the reviewer) each also has where it was filmed.
 */
export async function listClips(listingId, { places = false } = {}) {
  const client = await getClient();
  const rows = check(await client.from('tour_clips').select('id, room, path, seconds, code, recorded_at').eq('listing_id', listingId).order('recorded_at'));
  const urls = await links(TOUR_BUCKET, rows.map((row) => row.path));
  let where = new Map();
  if (places && rows.length) {
    where = new Map(check(await client.rpc('clip_places', { p_listing: listingId })).map((row) => [row.id, row]));
  }
  return rows.map((row, index) => ({
    ...row,
    url: urls[index],
    ...(where.has(row.id) ? { lat: where.get(row.id).lat, lng: where.get(row.id).lng, accuracy_m: where.get(row.id).accuracy_m } : {}),
  }));
}

/** Today's code to show in the corner of every clip. */
export async function todaysCode(listingId) {
  const client = await getClient();
  return check(await client.rpc('tour_code', { p_listing: listingId }));
}

/** Upload a recorded clip and save it for the room (replacing an older one). */
export async function addClip({ userId, listingId, room, blob, type, extension, seconds, position }) {
  const client = await getClient();
  const path = `${userId}/${listingId}/tour/${room}-${crypto.randomUUID()}.${extension}`;
  check(await client.storage.from(TOUR_BUCKET).upload(path, blob, { contentType: type.split(';')[0], upsert: false }));
  let oldPath;
  try {
    oldPath = check(await client.rpc('add_tour_clip', {
      p_listing: listingId,
      p_room: room,
      p_path: path,
      p_seconds: Math.round(seconds * 10) / 10,
      p_lat: position.lat,
      p_lng: position.lng,
      p_accuracy: position.accuracy ?? null,
    }));
  } catch (error) {
    await client.storage.from(TOUR_BUCKET).remove([path]);
    throw error;
  }
  if (oldPath) await client.storage.from(TOUR_BUCKET).remove([oldPath]);
}

export async function removeClip(clip) {
  const client = await getClient();
  check(await client.from('tour_clips').delete().eq('id', clip.id));
  await client.storage.from(TOUR_BUCKET).remove([clip.path]);
}

export async function submitListing(id) {
  const client = await getClient();
  check(await client.rpc('submit_listing', { p_listing: id }));
}

/** Stop a review (back to draft) or take a live listing down. Returns the new state. */
export async function withdrawListing(id) {
  const client = await getClient();
  return check(await client.rpc('withdraw_listing', { p_listing: id }));
}

/** For admins: listings waiting to be checked, oldest first. */
export async function reviewQueue() {
  const client = await getClient();
  return withPrivate(check(await client.from('listings').select(COLUMNS).eq('status', 'in_review').order('submitted_at', { ascending: true })));
}

/** For admins: approve, or ask for changes with a note. Returns the new state. */
export async function reviewListing(id, approve, note) {
  const client = await getClient();
  return check(await client.rpc('review_listing', { p_listing: id, p_approve: approve, p_note: note ?? null }));
}
