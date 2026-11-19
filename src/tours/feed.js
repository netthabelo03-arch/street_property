// Small pure helpers for the tour feed.

import { formatRands, tourRooms } from '../listings/rules.js';

/** The label at the top of the feed: "Melville · under R10 000". */
export function feedLabel(filters) {
  const where = filters.text.trim() ? filters.text.trim().replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'All areas';
  let price = 'any price';
  if (filters.maxPrice !== null && filters.minPrice !== null) price = `${formatRands(filters.minPrice)} to ${formatRands(filters.maxPrice)}`;
  else if (filters.maxPrice !== null) price = `under ${formatRands(filters.maxPrice)}`;
  else if (filters.minPrice !== null) price = `from ${formatRands(filters.minPrice)}`;
  return `${where} · ${filters.mode === 'rent' ? 'to rent' : 'for sale'} · ${price}`;
}

/** Clips in walking order: outside first, then the rooms as the place has them. */
export function orderClips(clips, listing) {
  const rooms = tourRooms(listing);
  const rank = (clip) => {
    const index = rooms.findIndex((room) => room.id === clip.room);
    return index === -1 ? 99 : index;
  };
  return [...clips].filter((clip) => clip.url).sort((a, b) => rank(a) - rank(b));
}

/** The name of a room for the label on screen. */
export function roomLabel(listing, roomId) {
  return tourRooms(listing).find((room) => room.id === roomId)?.name ?? String(roomId).replace('_', ' ');
}

/** A link to the listing anyone can open. */
export function shareUrl(listingId, location) {
  return `${location.origin}${location.pathname}#/place/${listingId}`;
}

/**
 * Which way a finger moved: 'next' (up), 'previous' (down) or null when it
 * was a tap or mostly sideways.
 */
export function swipeDirection(dx, dy, minimum = 60) {
  if (Math.abs(dy) < minimum || Math.abs(dy) < Math.abs(dx) * 1.2) return null;
  return dy < 0 ? 'next' : 'previous';
}

/** Load the next page when this many places are left to watch. */
export const LOAD_MORE_WHEN_LEFT = 3;

export function shouldLoadMore(index, loaded, total) {
  return loaded < total && loaded - index - 1 <= LOAD_MORE_WHEN_LEFT;
}
