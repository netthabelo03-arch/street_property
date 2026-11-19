// What renters and buyers are looking for: rent or buy, words to search,
// price, bedrooms, type of place and must-haves. Kept for the visit, so going
// to a listing and back does not lose the search.

import { formatRands, KINDS, findKind } from '../listings/rules.js';

export const PAGE_SIZE = 20;

export const MUST_HAVES = [
  { id: 'power', label: 'Backup power', hint: 'Solar, inverter or generator', feature: 'power_backup' },
  { id: 'water', label: 'Borehole or water tank', hint: 'Water when the taps run dry', feature: 'water_backup' },
  { id: 'prepaid', label: 'Prepaid electricity', hint: 'Pay for what you use', feature: 'prepaid' },
  { id: 'pets', label: 'Pet friendly', hint: 'Owner allows pets', feature: 'pets' },
  { id: 'parking', label: 'Parking', hint: 'At least one parking bay', parking: true },
];

export const BED_CHOICES = [
  { label: 'Any', min: null },
  { label: '1+', min: 1 },
  { label: '2+', min: 2 },
  { label: '3+', min: 3 },
  { label: '4+', min: 4 },
];

export function defaultFilters() {
  return { mode: 'rent', text: '', minPrice: null, maxPrice: null, minBeds: null, kinds: [], musts: [], tours: false };
}

/** Keep only values the app understands (for filters read back from storage). */
export function cleanFilters(raw) {
  const base = defaultFilters();
  if (!raw || typeof raw !== 'object') return base;
  const whole = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
  return {
    mode: raw.mode === 'sell' ? 'sell' : 'rent',
    text: typeof raw.text === 'string' ? raw.text.slice(0, 80) : '',
    minPrice: whole(raw.minPrice),
    maxPrice: whole(raw.maxPrice),
    minBeds: BED_CHOICES.some((choice) => choice.min === raw.minBeds) ? raw.minBeds : null,
    kinds: Array.isArray(raw.kinds) ? KINDS.map((kind) => kind.id).filter((id) => raw.kinds.includes(id)) : [],
    musts: Array.isArray(raw.musts) ? MUST_HAVES.map((item) => item.id).filter((id) => raw.musts.includes(id)) : [],
    tours: raw.tours === true,
  };
}

/** Switching between rent and buy clears the price: R4 500 means nothing for a sale. */
export function withMode(filters, mode) {
  return mode === filters.mode ? filters : { ...filters, mode, minPrice: null, maxPrice: null };
}

/** The arguments for search_listings() in the database. */
export function toSearchArgs(filters, page = 0, size = PAGE_SIZE) {
  const chosen = MUST_HAVES.filter((item) => filters.musts.includes(item.id));
  const features = chosen.filter((item) => item.feature).map((item) => item.feature);
  return {
    p_mode: filters.mode,
    p_text: filters.text.trim() || null,
    p_min_price: filters.minPrice,
    p_max_price: filters.maxPrice,
    p_min_beds: filters.minBeds,
    p_kinds: filters.kinds.length ? filters.kinds : null,
    p_features: features.length ? features : null,
    p_parking: chosen.some((item) => item.parking),
    p_limit: size,
    p_offset: page * size,
  };
}

/** How many filters are switched on (shown on the Filters button). */
export function activeCount(filters) {
  return (filters.minPrice !== null || filters.maxPrice !== null ? 1 : 0)
    + (filters.minBeds !== null ? 1 : 0)
    + (filters.kinds.length ? 1 : 0)
    + filters.musts.length;
}

export function priceSummary(filters) {
  const { minPrice: min, maxPrice: max } = filters;
  if (min === null && max === null) return 'Any price';
  if (min === null) return `Up to ${formatRands(max)}`;
  if (max === null) return `From ${formatRands(min)}`;
  return `${formatRands(min)} to ${formatRands(max)}`;
}

/** The short chips under the search box, as in the design. */
export function quickChips(filters) {
  const beds = BED_CHOICES.find((choice) => choice.min === filters.minBeds);
  const kinds = filters.kinds.map((id) => findKind(id)?.label).filter(Boolean);
  const musts = MUST_HAVES.filter((item) => filters.musts.includes(item.id)).map((item) => item.label);
  return [
    { id: 'price', label: priceSummary(filters), on: filters.minPrice !== null || filters.maxPrice !== null },
    { id: 'beds', label: beds?.min ? `${beds.label} beds` : 'Any beds', on: filters.minBeds !== null },
    ...(kinds.length ? [{ id: 'kinds', label: kinds.length === 1 ? kinds[0] : `${kinds.length} types`, on: true }] : []),
    { id: 'musts', label: musts.length === 0 ? 'Must-haves' : musts.length === 1 ? musts[0] : `${musts.length} must-haves`, on: musts.length > 0 },
  ];
}

/**
 * Read the price boxes. Empty means no limit.
 * @returns {{ min: number | null, max: number | null, error: string | null }}
 */
export function checkPriceRange(minText, maxText, parse) {
  const read = (text) => (String(text ?? '').trim() === '' ? null : parse(text));
  const min = read(minText);
  const max = read(maxText);
  if (String(minText ?? '').trim() !== '' && min === null) return { min, max, error: 'Enter the minimum in rands, numbers only.' };
  if (String(maxText ?? '').trim() !== '' && max === null) return { min, max, error: 'Enter the maximum in rands, numbers only.' };
  if (min !== null && max !== null && min > max) return { min, max, error: 'The minimum is more than the maximum.' };
  return { min, max, error: null };
}

/** The count line above the results. */
export function countLine(total, mode) {
  const what = mode === 'rent' ? 'to rent' : 'for sale';
  if (total === 0) return `No places ${what} match`;
  return `${total} place${total === 1 ? '' : 's'} ${what}`;
}

/**
 * The street for the public, without the house number: "24 Ngakane Street"
 * shows as "Ngakane Street". The full address is for later in a deal, not for
 * anyone browsing.
 */
export function publicStreet(street) {
  const text = String(street ?? '').trim();
  const withoutNumber = text.replace(/^(no\.?\s*)?\d+[a-z]?(\s*[-/]\s*\d+[a-z]?)?(?=[\s,]|$)\s*,?\s*/i, '').trim();
  return withoutNumber || '';
}

/** "Ngakane Street, Orlando West, Soweto" */
export function publicPlace(listing) {
  const street = listing.street_public ?? publicStreet(listing.street);
  return [street, listing.area, listing.city].filter(Boolean).join(', ');
}

/** "2 beds · 1 bath · 1 parking · Prepaid electricity" */
export function cardFacts(listing) {
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const single = ['backyard_room', 'shared_room'].includes(listing.kind);
  const parts = [];
  if (!single) parts.push(plural(listing.bedrooms, 'bed'));
  parts.push(plural(listing.bathrooms, 'bath'));
  if (listing.parking > 0) parts.push(`${listing.parking} parking`);
  const first = MUST_HAVES.find((item) => item.feature && (listing.features ?? []).includes(item.feature));
  if (first) parts.push(first.label);
  return parts.join(' · ');
}

// Remembered for this visit only (cleared when the browser tab closes).
const KEY = 'street-property-filters';
let current = null;

export function loadFilters() {
  if (current) return current;
  try {
    current = cleanFilters(JSON.parse(sessionStorage.getItem(KEY) ?? 'null'));
  } catch {
    current = defaultFilters();
  }
  return current;
}

export function saveFilters(filters) {
  current = cleanFilters(filters);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // private browsing: keep them in memory only
  }
  return current;
}
