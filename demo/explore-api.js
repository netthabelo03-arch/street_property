// Demo only: stands in for src/explore/api.js. Searches the demo's listings
// with the same rules as search_listings() in the database.

import { db, seed, ensureClipVideos } from './state.js';
import { toSearchArgs, PAGE_SIZE } from '../src/explore/filters.js';

function matches(listing, args) {
  if (listing.status !== 'live' || listing.mode !== args.p_mode) return false;
  if (args.p_min_price !== null && listing.price_rands < args.p_min_price) return false;
  if (args.p_max_price !== null && listing.price_rands > args.p_max_price) return false;
  if (args.p_min_beds !== null && listing.bedrooms < args.p_min_beds) return false;
  if (args.p_kinds && !args.p_kinds.includes(listing.kind)) return false;
  if (args.p_features && !args.p_features.every((feature) => listing.features.includes(feature))) return false;
  if (args.p_parking && listing.parking < 1) return false;
  if (args.p_verified && !listing.verified_at) return false;
  const words = String(args.p_text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const where = `${listing.street} ${listing.area} ${listing.city}`.toLowerCase();
  return words.every((word) => where.includes(word));
}

function run(filters, page, size) {
  const args = toSearchArgs(filters, page, size);
  const found = db.listings
    .filter((listing) => matches(listing, args))
    .sort((a, b) => String(b.reviewed_at).localeCompare(String(a.reviewed_at)));
  return { args, found };
}

export async function searchListings(filters, page = 0, { withTours = false } = {}) {
  await seed();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const { args, found } = run(filters, page, PAGE_SIZE);
  const slice = found.slice(args.p_offset, args.p_offset + args.p_limit);
  const items = await Promise.all(slice.map(async (listing) => {
    const photos = db.photos.filter((photo) => photo.listing_id === listing.id).sort((a, b) => a.position - b.position);
    const clips = db.clips.filter((clip) => clip.listing_id === listing.id);
    const outside = clips.find((clip) => clip.room === 'outside') ?? clips[0];
    if (withTours && outside) await ensureClipVideos([outside]);
    return {
      ...listing,
      cover_path: photos[0]?.path ?? null,
      tour_path: outside?.path ?? null,
      tour_seconds: clips.reduce((sum, clip) => sum + Number(clip.seconds), 0),
      clip_count: clips.length,
      total: found.length,
      coverUrl: photos[0]?.url ?? null,
      tourUrl: withTours ? outside?.url ?? null : null,
    };
  }));
  return { items, total: items.length ? found.length : (page === 0 ? 0 : null) };
}

export async function countListings(filters) {
  await seed();
  return run(filters, 0, 1).found.length;
}

export async function searchArea(filters, bounds) {
  await seed();
  const { found } = run({ ...filters, text: '' }, 0, 50);
  const inside = found
    .map((listing) => ({ ...listing, approx_lat: Math.round(listing.filmed_lat * 1000) / 1000, approx_lng: Math.round(listing.filmed_lng * 1000) / 1000 }))
    .filter((l) => l.approx_lat >= bounds.south && l.approx_lat <= bounds.north && l.approx_lng >= bounds.west && l.approx_lng <= bounds.east);
  const items = inside.slice(0, 50).map((listing) => {
    const photos = db.photos.filter((photo) => photo.listing_id === listing.id).sort((a, b) => a.position - b.position);
    const clips = db.clips.filter((clip) => clip.listing_id === listing.id);
    return { ...listing, coverUrl: photos[0]?.url ?? null, tourUrl: null, clip_count: clips.length, tour_seconds: clips.reduce((sum, clip) => sum + Number(clip.seconds), 0) };
  });
  return { items, total: inside.length };
}
