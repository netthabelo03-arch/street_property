// Demo only: saved places kept in this tab.

import { db, seed } from './state.js';

const saved = new Set();

export async function savedIds() { return new Set(saved); }
export async function saveListing(listingId) { saved.add(listingId); }
export async function unsaveListing(listingId) { saved.delete(listingId); }
export async function mySaved() {
  await seed();
  return [...saved].map((id) => {
    const listing = db.listings.find((item) => item.id === id);
    const live = listing?.status === 'live';
    const cover = db.photos.filter((photo) => photo.listing_id === id).sort((a, b) => a.position - b.position)[0];
    const clips = db.clips.filter((clip) => clip.listing_id === id);
    return live
      ? { ...listing, live, coverUrl: cover?.url ?? null, clip_count: clips.length, tour_seconds: clips.reduce((sum, clip) => sum + Number(clip.seconds), 0) }
      : { id, live: false };
  });
}
