// Searching live listings for Explore. Anyone may call these, signed in or not.

import { getClient } from '../auth/client.js';
import { toSearchArgs, PAGE_SIZE } from './filters.js';

const LINK_SECONDS = 60 * 60;

async function links(bucket, paths) {
  const wanted = paths.filter(Boolean);
  if (wanted.length === 0) return new Map();
  const client = await getClient();
  const { data, error } = await client.storage.from(bucket).createSignedUrls(wanted, LINK_SECONDS);
  if (error) throw error;
  return new Map(data.map((item) => [item.path, item.signedUrl ?? null]));
}

/**
 * One page of live listings matching the filters, newest first.
 * Each comes with `coverUrl`, and `tourUrl` (the outside clip) when `withTours`.
 * @returns {Promise<{ items: object[], total: number }>}
 */
export async function searchListings(filters, page = 0, { withTours = false } = {}) {
  const client = await getClient();
  const { data, error } = await client.rpc('search_listings', toSearchArgs(filters, page, PAGE_SIZE));
  if (error) throw error;
  const [covers, tours] = await Promise.all([
    links('listing-photos', data.map((row) => row.cover_path)),
    withTours ? links('listing-tours', data.map((row) => row.tour_path)) : new Map(),
  ]);
  return {
    items: data.map((row) => ({ ...row, coverUrl: covers.get(row.cover_path) ?? null, tourUrl: tours.get(row.tour_path) ?? null })),
    total: data.length ? Number(data[0].total) : (page === 0 ? 0 : null),
  };
}

/** Only the number of matches, for the "Show N places" button on Filters. */
export async function countListings(filters) {
  const client = await getClient();
  const { data, error } = await client.rpc('search_listings', toSearchArgs(filters, 0, 1));
  if (error) throw error;
  return data.length ? Number(data[0].total) : 0;
}
