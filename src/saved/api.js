// Saved places (the heart). Each person sees and changes only their own.

import { getClient } from '../auth/client.js';

function check({ data, error }) {
  if (error) throw error;
  return data;
}

/** Ids of everything the person saved, for showing filled hearts. */
export async function savedIds(userId) {
  const client = await getClient();
  const rows = check(await client.from('saved_listings').select('listing_id').eq('user_id', userId));
  return new Set(rows.map((row) => row.listing_id));
}

export async function saveListing(listingId) {
  const client = await getClient();
  const { error } = await client.from('saved_listings').insert({ listing_id: listingId });
  // Already saved (perhaps on another device) is fine.
  if (error && error.code !== '23505') throw error;
}

export async function unsaveListing(listingId, userId) {
  const client = await getClient();
  check(await client.from('saved_listings').delete().eq('listing_id', listingId).eq('user_id', userId));
}

/** The saved list, newest first, with cover photo links. Places no longer live have live = false. */
export async function mySaved() {
  const client = await getClient();
  const rows = check(await client.rpc('my_saved'));
  const paths = rows.map((row) => row.cover_path).filter(Boolean);
  let urls = new Map();
  if (paths.length) {
    const signed = check(await client.storage.from('listing-photos').createSignedUrls(paths, 3600));
    urls = new Map(signed.map((item) => [item.path, item.signedUrl ?? null]));
  }
  return rows.map((row) => ({ ...row, coverUrl: urls.get(row.cover_path) ?? null }));
}
