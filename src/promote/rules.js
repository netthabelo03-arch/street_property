// Promote: paid boosts, the free ad tools and the true monthly cost.
import { formatRands } from '../listings/rules.js';

// The prices must match boost_price() in supabase/014_promote.sql and PRICES
// in supabase/functions/promote/index.ts (the tests check this).

export const BOOSTS = [
  { tier: 'week', rands: 49, days: 7, name: 'Boost', what: 'Shown first in Explore, the map and Tours for 7 days.' },
  { tier: 'fortnight', rands: 99, days: 14, name: 'Boost plus', what: '14 days, shown above week boosts.' },
  { tier: 'month', rands: 179, days: 30, name: 'Featured', what: '30 days at the very top, with a Featured badge.' },
];

/** "Boosted until 3 December" / "Featured until 3 December", or null. */
export function boostLine(listing, now = new Date()) {
  if (!listing?.boost_until || new Date(listing.boost_until) <= now) return null;
  const until = new Date(listing.boost_until).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', timeZone: 'Africa/Johannesburg' });
  return `${listing.boost_tier === 'month' ? 'Featured' : 'Boosted'} until ${until}`;
}

/** Is the Featured badge showing (a month boost that has not ended)? */
export function isFeatured(listing, now = new Date()) {
  if (typeof listing?.featured === 'boolean') return listing.featured;
  return listing?.boost_tier === 'month' && Boolean(listing.boost_until) && new Date(listing.boost_until) > now;
}

/** The public address of a listing, for links and QR codes. */
export function listingLink(id, base = `${location.origin}${location.pathname}`) {
  return `${base}#/place/${id}`;
}

/** The words that go with a social post. */
export function socialCaption(listing, link) {
  const what = listing.mode === 'sell' ? 'For sale' : 'To let';
  const beds = listing.bedrooms ? `${listing.bedrooms}-bedroom ` : '';
  const kind = String(listing.kind ?? 'place').replace(/_/g, ' ');
  const price = `${formatRands(listing.price_rands)}${listing.mode === 'sell' ? '' : ' a month'}`;
  const lines = [
    `${what}: ${beds}${kind} in ${listing.area}, ${listing.city}. ${price}.`,
    listing.verified_at ? 'Street Verified: owner and address checked.' : null,
    'Watch the video tour, filmed at the place, and ask the owner on Street Property:',
    link,
  ];
  return lines.filter(Boolean).join('\n');
}

// True monthly cost ------------------------------------------------------------------

/** A starting guess for prepaid electricity a month, by bedrooms. People can change it. */
export function electricityGuess(bedrooms) {
  const beds = Math.max(0, Number(bedrooms) || 0);
  return [450, 650, 900, 1200, 1500][Math.min(beds, 4)];
}

/**
 * Rent plus what living there really costs a month, and what moving in costs.
 * Every extra is the renter's own estimate (a number of rands, 0 if none).
 */
export function trueMonthlyCost({ rent, deposit, extras = {} }) {
  const parts = Object.entries(extras)
    .map(([key, value]) => [key, Math.max(0, Math.round(Number(value) || 0))]);
  const extra = parts.reduce((sum, [, value]) => sum + value, 0);
  const monthly = Math.round(Number(rent) || 0) + extra;
  const moveIn = Math.round(Number(rent) || 0) + Math.round(Number(deposit) || 0);
  return { monthly, extra, moveIn, parts: Object.fromEntries(parts) };
}

/** The share of take-home pay the true cost takes, as a whole percent, or null. */
export function shareOfPay(monthly, takeHome) {
  const pay = Number(takeHome) || 0;
  if (pay <= 0) return null;
  return Math.round((monthly / pay) * 100);
}
