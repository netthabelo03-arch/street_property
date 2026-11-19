// Demo only: stands in for src/listings/api.js. Same functions, same rules
// (who may see and change what, and the same error hints as the database),
// but everything stays in this browser tab.

import { db, me, seed, ensureClipVideos, newCode } from './state.js';
import { PHOTOS, TOUR, isEditable } from '../src/listings/rules.js';

const wait = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const refuse = (hint, message = hint) => {
  throw { code: 'P0001', hint, message };
};
const copy = (item) => (item ? { ...item, features: [...item.features] } : item);
const PUBLIC_FIELDS = ['id', 'path', 'position', 'url'];
const CLIP_FIELDS = ['id', 'room', 'path', 'seconds', 'lat', 'lng', 'accuracy_m', 'code', 'recorded_at', 'url'];
const pick = (item, fields) => Object.fromEntries(fields.map((field) => [field, item[field]]));

function canSee(listing) {
  const person = me();
  return listing.status === 'live' || listing.owner_id === person?.id || person?.admin === true;
}

function ownEditable(id) {
  const listing = db.listings.find((item) => item.id === id);
  if (!listing || listing.owner_id !== me()?.id) refuse('listing_not_found', 'Listing not found');
  if (!isEditable(listing.status)) refuse('listing_locked', 'This listing cannot be changed right now');
  return listing;
}

function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
}

export async function myListings(userId) {
  await seed();
  await wait();
  return db.listings.filter((item) => item.owner_id === userId).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(copy);
}

export async function getListing(id) {
  await seed();
  await wait(150);
  const found = db.listings.find((item) => item.id === id);
  return found && canSee(found) ? copy(found) : null;
}

export async function createListing(values) {
  await seed();
  await wait();
  const person = me();
  if (!['owner', 'agent'].includes(person?.role)) refuse('not_a_lister', 'Only owners and agents can list a place');
  const now = new Date().toISOString();
  const listing = {
    ...values,
    id: crypto.randomUUID(),
    owner_id: person.id,
    lister: person.role,
    status: 'draft',
    review_note: null,
    filmed_lat: null,
    filmed_lng: null,
    created_at: now,
    updated_at: now,
    submitted_at: null,
    reviewed_at: null,
  };
  if (listing.mode === 'sell') listing.deposit_rands = null;
  db.listings.push(listing);
  return copy(listing);
}

export async function updateListing(id, values) {
  await wait();
  const listing = ownEditable(id);
  Object.assign(listing, values, { updated_at: new Date().toISOString() });
  if (listing.mode === 'sell') listing.deposit_rands = null;
  return copy(listing);
}

export async function deleteDraft(listing) {
  await wait();
  const found = ownEditable(listing.id);
  if (found.status !== 'draft') refuse('listing_locked');
  db.listings = db.listings.filter((item) => item !== found);
  db.photos = db.photos.filter((photo) => photo.listing_id !== found.id);
  db.clips = db.clips.filter((clip) => clip.listing_id !== found.id);
}

export async function listPhotos(listingId) {
  await seed();
  const listing = db.listings.find((item) => item.id === listingId);
  if (!listing || !canSee(listing)) return [];
  return db.photos.filter((photo) => photo.listing_id === listingId).sort((a, b) => a.position - b.position).map((photo) => pick(photo, PUBLIC_FIELDS));
}

export async function addPhoto({ listingId, blob, position }) {
  await wait(300);
  ownEditable(listingId);
  if (db.photos.filter((photo) => photo.listing_id === listingId).length >= PHOTOS.max) refuse('too_many_photos', 'A listing can have up to 12 photos');
  const photo = { id: crypto.randomUUID(), listing_id: listingId, path: `demo/${listingId}/photos/${crypto.randomUUID()}.jpg`, position, url: URL.createObjectURL(blob) };
  db.photos.push(photo);
  return pick(photo, ['id', 'path', 'position']);
}

export async function removePhoto(photo) {
  await wait();
  const found = db.photos.find((item) => item.id === photo.id);
  if (found) ownEditable(found.listing_id);
  db.photos = db.photos.filter((item) => item.id !== photo.id);
}

export async function reorderPhotos(photos) {
  await wait();
  photos.forEach((photo, position) => {
    const found = db.photos.find((item) => item.id === photo.id);
    if (found) {
      ownEditable(found.listing_id);
      found.position = position;
    }
  });
}

export async function listClips(listingId) {
  await seed();
  const listing = db.listings.find((item) => item.id === listingId);
  if (!listing || !canSee(listing)) return [];
  const clips = db.clips.filter((clip) => clip.listing_id === listingId).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  await ensureClipVideos(clips);
  return clips.map((clip) => pick(clip, CLIP_FIELDS));
}

export async function todaysCode(listingId) {
  await wait(100);
  ownEditable(listingId);
  const key = `${listingId}/${today()}`;
  if (!db.codes.has(key)) db.codes.set(key, newCode());
  return db.codes.get(key);
}

export async function addClip({ listingId, room, blob, seconds, position }) {
  await wait(600);
  ownEditable(listingId);
  if (position?.lat == null || position?.lng == null) refuse('location_needed');
  if (seconds < 1 || seconds > TOUR.clipMaxSeconds) refuse('clip_length');
  const others = db.clips.filter((clip) => clip.listing_id === listingId && clip.room !== room);
  if (others.reduce((sum, clip) => sum + Number(clip.seconds), 0) + seconds > TOUR.totalMaxSeconds) refuse('tour_too_long');
  db.clips = db.clips.filter((clip) => !(clip.listing_id === listingId && clip.room === room));
  db.clips.push({
    id: crypto.randomUUID(),
    listing_id: listingId,
    room,
    path: `demo/${listingId}/tour/${room}`,
    seconds: Math.round(seconds * 10) / 10,
    lat: position.lat,
    lng: position.lng,
    accuracy_m: position.accuracy ?? null,
    code: await todaysCode(listingId),
    recorded_at: new Date().toISOString(),
    blob,
    url: URL.createObjectURL(blob),
  });
}

export async function removeClip(clip) {
  await wait();
  const found = db.clips.find((item) => item.id === clip.id);
  if (found) ownEditable(found.listing_id);
  db.clips = db.clips.filter((item) => item.id !== clip.id);
}

export async function submitListing(id) {
  await wait(500);
  const listing = ownEditable(id);
  if (db.photos.filter((photo) => photo.listing_id === id).length < PHOTOS.min) refuse('need_photos');
  const clips = db.clips.filter((clip) => clip.listing_id === id);
  const outside = clips.find((clip) => clip.room === 'outside');
  if (!outside || clips.length < TOUR.minClips) refuse('need_tour');
  Object.assign(listing, { status: 'in_review', submitted_at: new Date().toISOString(), review_note: null, filmed_lat: outside.lat, filmed_lng: outside.lng });
}

export async function withdrawListing(id) {
  await wait(400);
  const listing = db.listings.find((item) => item.id === id);
  if (!listing || listing.owner_id !== me()?.id) refuse('listing_not_found');
  const next = { in_review: 'draft', live: 'taken_down' }[listing.status];
  if (!next) refuse('listing_locked');
  listing.status = next;
  return next;
}

export async function reviewQueue() {
  await seed();
  await wait();
  if (!me()?.admin) return [];
  return db.listings.filter((item) => item.status === 'in_review').sort((a, b) => a.submitted_at.localeCompare(b.submitted_at)).map(copy);
}

export async function reviewListing(id, approve, note) {
  await wait(500);
  if (!me()?.admin) refuse('not_admin');
  const listing = db.listings.find((item) => item.id === id);
  if (!listing) refuse('listing_not_found');
  if (listing.status !== 'in_review') refuse('not_in_review');
  const text = String(note ?? '').trim();
  if (!approve && text.length < 5) refuse('note_needed');
  Object.assign(listing, {
    status: approve ? 'live' : 'changes_needed',
    review_note: approve ? null : text,
    reviewed_at: new Date().toISOString(),
  });
  return listing.status;
}
