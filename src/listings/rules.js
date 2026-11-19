// What a listing must have, in one place. The screens and the tests use these;
// supabase/002_listings.sql enforces the same limits in the database.

export const MODES = [
  { id: 'rent', label: 'Rent it out', priceLabel: 'Rent per month (R)' },
  { id: 'sell', label: 'Sell it', priceLabel: 'Asking price (R)' },
];

export const KINDS = [
  { id: 'flat', label: 'Flat' },
  { id: 'house', label: 'House' },
  { id: 'townhouse', label: 'Townhouse' },
  { id: 'backyard_room', label: 'Backyard room' },
  { id: 'cottage', label: 'Cottage' },
  { id: 'shared_room', label: 'Shared room' },
];

/** The must-haves renters filter on (Sprint 2). */
export const FEATURES = [
  { id: 'power_backup', label: 'Power backup (solar or inverter)' },
  { id: 'water_backup', label: 'Water tank' },
  { id: 'prepaid', label: 'Prepaid electricity' },
  { id: 'pets', label: 'Pets allowed' },
  { id: 'wifi', label: 'Wi-Fi or fibre' },
  { id: 'furnished', label: 'Furnished' },
  { id: 'security', label: 'Security (gate, guard or alarm)' },
];

export const PRICE_LIMITS = {
  rent: { min: 300, max: 500000 },
  sell: { min: 10000, max: 1000000000 },
};

export const PHOTOS = { min: 5, max: 12 };
export const DESCRIPTION_MAX = 1000;

/** The tour: one clip per room, each up to 30 seconds, 2 minutes in all. */
export const TOUR = { clipMaxSeconds: 30, totalMaxSeconds: 120, minClips: 4 };

export const STATUSES = {
  draft: { label: 'Draft', chip: 'chip--waiting', about: 'Not sent yet. Finish the details, photos and video tour, then send it for checking.' },
  in_review: { label: 'Being checked', chip: 'chip--waiting', about: 'We are checking the photos and video tour. This usually takes a day.' },
  changes_needed: { label: 'Changes needed', chip: 'chip--bad', about: 'Make the changes below, then send it again.' },
  live: { label: 'Live', chip: 'chip--good', about: 'Renters and buyers can see it.' },
  taken_down: { label: 'Taken down', chip: 'chip--waiting', about: 'Hidden from everyone. Edit it and send it again to put it back.' },
};

/** States in which the owner may still change the listing. */
export function isEditable(status) {
  return status === 'draft' || status === 'changes_needed' || status === 'taken_down';
}

export function findKind(id) {
  return KINDS.find((kind) => kind.id === id);
}

/** Turn what was typed into whole rands: "R 4 500", "4,500" and "4500.00" all give 4500. */
export function parseRands(text) {
  const cleaned = String(text ?? '').replace(/[Rr\s,]/g, '').replace(/\.00?$/, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

/** R4 500 (South African style, space between thousands). */
export function formatRands(value) {
  return `R${Math.round(Number(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}

/** "2-bed flat in Soweto", the title used on cards and in the review queue. */
export function listingTitle(listing) {
  const kind = (findKind(listing.kind)?.label ?? 'Place').toLowerCase();
  const rooms = ['backyard_room', 'shared_room'].includes(listing.kind) || !listing.bedrooms ? '' : `${listing.bedrooms}-bed `;
  const where = String(listing.area ?? '').trim();
  return `${rooms}${kind}${where ? ` in ${where}` : ''}`.replace(/^./, (first) => first.toUpperCase());
}

/** The price line: "R4 500 a month" or "R850 000". */
export function priceLine(listing) {
  return listing.mode === 'rent' ? `${formatRands(listing.price_rands)} a month` : formatRands(listing.price_rands);
}

/**
 * Check the details form. Returns the cleaned values and an error message for
 * each field that needs fixing (empty object when everything is fine).
 */
export function checkDetails(input) {
  const errors = {};
  const mode = MODES.some((item) => item.id === input.mode) ? input.mode : null;
  if (!mode) errors.mode = 'Choose rent or sell.';
  if (!findKind(input.kind)) errors.kind = 'Choose the type of place.';

  const street = String(input.street ?? '').trim();
  const area = String(input.area ?? '').trim();
  const city = String(input.city ?? '').trim();
  if (street.length < 3) errors.street = 'Enter the street address, for example 12 Vilakazi Street.';
  else if (street.length > 120) errors.street = 'Keep the street address under 120 characters.';
  if (area.length < 2) errors.area = 'Enter the suburb or township.';
  else if (area.length > 80) errors.area = 'Keep this under 80 characters.';
  if (city.length < 2) errors.city = 'Enter the city or town.';
  else if (city.length > 80) errors.city = 'Keep this under 80 characters.';

  const price = parseRands(input.price);
  if (mode) {
    const { min, max } = PRICE_LIMITS[mode];
    if (price === null) errors.price = 'Enter the amount in rands, numbers only.';
    else if (price < min || price > max) errors.price = `Enter an amount between ${formatRands(min)} and ${formatRands(max)}.`;
  }

  let deposit = null;
  if (mode === 'rent' && String(input.deposit ?? '').trim() !== '') {
    deposit = parseRands(input.deposit);
    if (deposit === null) errors.deposit = 'Enter the deposit in rands, numbers only, or leave it empty.';
    else if (deposit > 10000000) errors.deposit = 'That deposit looks too big. Check the amount.';
  }

  const counts = {};
  for (const key of ['bedrooms', 'bathrooms', 'parking']) {
    const value = Number(input[key]);
    counts[key] = Number.isInteger(value) && value >= 0 && value <= 20 ? value : 0;
  }

  const features = FEATURES.map((item) => item.id).filter((id) => (input.features ?? []).includes(id));
  const description = String(input.description ?? '').trim();
  if (description.length > DESCRIPTION_MAX) errors.description = `Keep the description under ${DESCRIPTION_MAX} characters.`;

  let availableFrom = null;
  if (mode === 'rent' && input.availableFrom) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input.availableFrom)) availableFrom = input.availableFrom;
    else errors.availableFrom = 'Choose a date, or leave it empty.';
  }

  return {
    errors,
    values: {
      mode,
      kind: input.kind,
      street,
      area,
      city,
      price_rands: price,
      deposit_rands: deposit,
      bedrooms: counts.bedrooms,
      bathrooms: counts.bathrooms,
      parking: counts.parking,
      features,
      description,
      available_from: availableFrom,
    },
  };
}

/**
 * The rooms to film for this place: outside first, then the rooms it has,
 * then the meters. `required` marks the one clip every tour must have.
 */
export function tourRooms(listing) {
  const bedrooms = Math.min(Math.max(Number(listing?.bedrooms) || 0, 0), 9);
  const bathrooms = Math.min(Math.max(Number(listing?.bathrooms) || 0, 0), 9);
  const singleRoom = ['backyard_room', 'shared_room'].includes(listing?.kind);
  const rooms = [{ id: 'outside', name: 'Outside and gate', hint: 'Street, gate, parking', required: true }];
  if (singleRoom) {
    rooms.push({ id: 'bedroom_1', name: 'The room', hint: 'Turn slowly from the door' });
  } else {
    rooms.push({ id: 'lounge', name: 'Lounge', hint: 'Turn slowly from the door' });
    rooms.push({ id: 'kitchen', name: 'Kitchen', hint: 'Stove, sink, cupboards' });
    for (let n = 1; n <= Math.max(bedrooms, 1); n += 1) {
      rooms.push({ id: `bedroom_${n}`, name: bedrooms > 1 ? `Bedroom ${n}` : 'Bedroom', hint: 'Window and cupboards' });
    }
  }
  for (let n = 1; n <= Math.max(bathrooms, 1); n += 1) {
    rooms.push({ id: `bathroom_${n}`, name: bathrooms > 1 ? `Bathroom ${n}` : 'Bathroom', hint: 'Shower or bath, geyser' });
  }
  if (singleRoom) rooms.push({ id: 'kitchen', name: 'Kitchen', hint: 'Shared or own: stove, sink' });
  rooms.push({ id: 'meters', name: 'Meters and backup', hint: 'Prepaid meter, inverter, tank' });
  return rooms;
}

/** 83 → "1:23" */
export function formatSeconds(total) {
  const seconds = Math.max(0, Math.round(Number(total) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Seconds still free in the tour, if the clip for `room` were filmed again. */
export function secondsLeft(clips, room) {
  const used = clips.filter((clip) => clip.room !== room).reduce((sum, clip) => sum + Number(clip.seconds), 0);
  return Math.max(0, TOUR.totalMaxSeconds - used);
}

/** What still stops the listing from being sent, as plain sentences (empty when ready). */
export function missingForReview({ photos, clips }) {
  const missing = [];
  if (photos.length < PHOTOS.min) {
    const more = PHOTOS.min - photos.length;
    missing.push(`Add ${more} more photo${more === 1 ? '' : 's'} (at least ${PHOTOS.min}).`);
  }
  if (!clips.some((clip) => clip.room === 'outside')) missing.push('Film the outside and gate.');
  if (clips.length < TOUR.minClips) {
    const more = TOUR.minClips - clips.length;
    missing.push(`Film ${more} more room${more === 1 ? '' : 's'} (at least ${TOUR.minClips} clips in all).`);
  }
  return missing;
}

/** Distance in metres between two points on the earth. */
export function distanceMeters(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 45 → "45 m", 17283 → "17.3 km" */
export function formatDistance(metres) {
  const value = Math.round(Number(metres) || 0);
  return value < 1000 ? `${value} m` : `${(value / 1000).toFixed(value < 10000 ? 2 : 1).replace(/\.?0+$/, '')} km`;
}

/**
 * For the reviewer: how far each clip was filmed from the outside clip. A clip
 * more than `limit` metres away (allowing for the phone's stated accuracy) is
 * flagged.
 * @returns {{ room: string, metres: number | null, far: boolean }[]}
 */
export function clipDistances(clips, limit = 150) {
  const outside = clips.find((clip) => clip.room === 'outside');
  return clips.map((clip) => {
    if (!outside) return { room: clip.room, metres: null, far: false };
    const metres = Math.round(distanceMeters(outside, clip));
    const slack = Math.min(Number(clip.accuracy_m) || 0, 100) + Math.min(Number(outside.accuracy_m) || 0, 100);
    return { room: clip.room, metres, far: metres > limit + slack };
  });
}

/** The video type this phone can record, best first; null when it cannot record. */
export function pickVideoType(isSupported) {
  const choices = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return choices.find((type) => isSupported(type)) ?? null;
}

/** File ending for a recorded video type. */
export function videoExtension(type) {
  return String(type).startsWith('video/mp4') ? 'mp4' : 'webm';
}

/** Photo size after shrinking in the phone: the long side at most `max` pixels. */
export function fitWithin(width, height, max = 1600) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value) {
  return UUID.test(String(value ?? ''));
}
