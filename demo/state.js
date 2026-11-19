// Demo only: the people and listings the demo starts with, kept in memory.
// Reloading the page starts the demo again from the beginning.

import { samplePhoto, sampleClip, sceneFor } from './media.js';
import { tourRooms } from '../src/listings/rules.js';

export const PEOPLE = {
  owner: { id: '00000000-0000-4000-8000-000000000001', email: 'lerato@demo.streetproperty', full_name: 'Lerato Dlamini', role: 'owner', admin: false },
  admin: { id: '00000000-0000-4000-8000-000000000002', email: 'admin@demo.streetproperty', full_name: 'Sam (Street Property)', role: 'renter', admin: true },
  renter: { id: '00000000-0000-4000-8000-000000000003', email: 'sipho@demo.streetproperty', full_name: 'Sipho Nkosi', role: 'renter', admin: false },
};
const OTHER_OWNER = '00000000-0000-4000-8000-000000000004';

export const db = {
  persona: 'renter',
  listings: [],
  photos: [],
  clips: [],
  codes: new Map(), // listing id + day → code
};

const hoursAgo = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();

function listing(fields) {
  return {
    id: crypto.randomUUID(),
    lister: 'owner',
    deposit_rands: null,
    parking: 0,
    features: [],
    description: '',
    available_from: null,
    review_note: null,
    filmed_lat: null,
    filmed_lng: null,
    created_at: hoursAgo(72),
    updated_at: hoursAgo(2),
    submitted_at: null,
    reviewed_at: null,
    ...fields,
  };
}

export function newCode() {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
}

const PHOTO_SETS = {
  flat: [['outside', 'Outside'], ['lounge', 'Lounge'], ['kitchen', 'Kitchen'], ['bedroom', 'Bedroom 1'], ['bedroom', 'Bedroom 2'], ['bathroom', 'Bathroom']],
  room: [['outside', 'Outside'], ['bedroom', 'The room'], ['bathroom', 'Bathroom'], ['kitchen', 'Kitchen'], ['outside', 'Yard']],
  house: [['outside', 'Outside'], ['lounge', 'Lounge'], ['kitchen', 'Kitchen'], ['bedroom', 'Main bedroom'], ['bedroom', 'Bedroom 2'], ['bathroom', 'Bathroom']],
};

async function addSamplePhotos(item, set) {
  for (const [index, [scene, label]] of set.entries()) {
    const blob = await samplePhoto(scene, label, 0.3 + (index % 3) * 0.2);
    db.photos.push({ id: crypto.randomUUID(), listing_id: item.id, path: `demo/${item.id}/photos/${index}.jpg`, position: index, url: URL.createObjectURL(blob) });
  }
}

/** Clips without a video yet; the video is made the first time it is needed. */
function addSampleClips(item, roomIds, filmedHoursAgo) {
  const rooms = tourRooms(item);
  const code = newCode();
  const where = { lat: item.filmed_lat ?? -26.2385, lng: item.filmed_lng ?? 27.9086 };
  roomIds.forEach((room, index) => {
    const name = rooms.find((r) => r.id === room)?.name ?? room;
    db.clips.push({
      id: crypto.randomUUID(),
      listing_id: item.id,
      room,
      path: `demo/${item.id}/tour/${room}.webm`,
      seconds: [18, 22, 20, 15, 14, 12][index % 6],
      lat: where.lat + (index ? (Math.random() - 0.5) * 0.0002 : 0),
      lng: where.lng + (index ? (Math.random() - 0.5) * 0.0002 : 0),
      accuracy_m: 6 + index,
      code,
      recorded_at: hoursAgo(filmedHoursAgo - index * 0.02),
      url: null,
      making: null,
      scene: sceneFor(name),
      label: name,
    });
  });
}

/** Make the sample videos for these clips (all at once, about 3 seconds). */
export async function ensureClipVideos(clips) {
  await Promise.all(clips.map((clip) => {
    if (clip.url || clip.blob) return null;
    if (!clip.making) {
      clip.making = sampleClip(clip.scene, clip.label, clip.code, new Date(clip.recorded_at)).then((made) => {
        clip.url = made?.url ?? null;
      });
    }
    return clip.making;
  }));
}

let seeded = null;

/** Fill the demo with its starting listings (once). */
export function seed() {
  if (seeded) return seeded;
  seeded = (async () => {
    const live = listing({
      owner_id: PEOPLE.owner.id, mode: 'rent', kind: 'flat', street: '24 Ngakane Street', area: 'Orlando West', city: 'Soweto',
      price_rands: 4500, deposit_rands: 4500, bedrooms: 2, bathrooms: 1, parking: 1,
      features: ['prepaid', 'power_backup', 'security'], description: 'Quiet street, 5 minutes to the taxi rank and Maponya Mall. Water included.',
      status: 'live', filmed_lat: -26.2385, filmed_lng: 27.9086, submitted_at: hoursAgo(50), reviewed_at: hoursAgo(46),
    });
    const changes = listing({
      owner_id: PEOPLE.owner.id, mode: 'rent', kind: 'backyard_room', street: '7 Mthimkhulu Street', area: 'Tembisa', city: 'Ekurhuleni',
      price_rands: 2200, deposit_rands: 2200, bedrooms: 1, bathrooms: 1, parking: 0, features: ['prepaid', 'wifi'],
      description: 'Own entrance, shared kitchen with one other tenant.', status: 'changes_needed',
      review_note: 'Please film the bathroom too, and the kitchen you share.', filmed_lat: -25.9967, filmed_lng: 28.2266,
      submitted_at: hoursAgo(30), reviewed_at: hoursAgo(26),
    });
    const waiting = listing({
      owner_id: OTHER_OWNER, lister: 'agent', mode: 'rent', kind: 'house', street: '1182 Tsamaya Avenue', area: 'Mamelodi East', city: 'Pretoria',
      price_rands: 6800, deposit_rands: 6800, bedrooms: 3, bathrooms: 2, parking: 2, features: ['water_backup', 'pets', 'security'],
      description: 'Family home with a big yard. Close to schools and the Mamelodi East train station.', status: 'in_review',
      filmed_lat: -25.7179, filmed_lng: 28.3986, submitted_at: hoursAgo(3),
    });
    db.listings.push(live, changes, waiting);
    await Promise.all([
      addSamplePhotos(live, PHOTO_SETS.flat),
      addSamplePhotos(changes, PHOTO_SETS.room),
      addSamplePhotos(waiting, PHOTO_SETS.house),
    ]);
    addSampleClips(live, ['outside', 'lounge', 'kitchen', 'bedroom_1', 'bathroom_1'], 51);
    addSampleClips(changes, ['outside', 'bedroom_1', 'meters'], 31);
    addSampleClips(waiting, ['outside', 'lounge', 'kitchen', 'bedroom_1', 'bathroom_1', 'meters'], 4);
    // More live places from other owners, so Explore has something to show.
    const others = [
      { mode: 'rent', kind: 'cottage', street: '31 Ntsane Street', area: 'Dube', city: 'Soweto', price_rands: 5200, deposit_rands: 5200, bedrooms: 1, bathrooms: 1, parking: 1, features: ['prepaid', 'pets', 'security'], description: 'Garden cottage behind the main house, own gate. Pets welcome.', at: [-26.2361, 27.8925], set: 'room', hours: 20 },
      { mode: 'rent', kind: 'townhouse', street: '8 Leeuwkop Road', area: 'Sunninghill', city: 'Sandton', price_rands: 12900, deposit_rands: 19350, bedrooms: 3, bathrooms: 2, parking: 2, features: ['power_backup', 'water_backup', 'security', 'pets'], description: 'Townhouse in a secure complex with solar backup and a water tank. Close to schools.', at: [-26.0326, 28.0601], set: 'house', hours: 10, lister: 'agent' },
      { mode: 'rent', kind: 'backyard_room', street: '55 Moagi Street', area: 'Mamelodi West', city: 'Pretoria', price_rands: 1800, deposit_rands: 1800, bedrooms: 1, bathrooms: 1, parking: 0, features: ['prepaid', 'wifi'], description: 'Room with own entrance, shared bathroom. Wi-Fi included.', at: [-25.7196, 28.3625], set: 'room', hours: 30 },
      { mode: 'rent', kind: 'flat', street: '14 Seventh Street', area: 'Melville', city: 'Johannesburg', price_rands: 8500, deposit_rands: 8500, bedrooms: 2, bathrooms: 1, parking: 1, features: ['prepaid', 'power_backup', 'furnished'], description: 'Furnished garden flat, walk to 7th Street cafes.', at: [-26.1766, 28.0094], set: 'flat', hours: 6 },
      { mode: 'rent', kind: 'shared_room', street: '3 Vilakazi Street', area: 'Orlando West', city: 'Soweto', price_rands: 1500, deposit_rands: null, bedrooms: 1, bathrooms: 1, parking: 0, features: ['prepaid', 'wifi'], description: 'Room in a shared house for students. Bills included except electricity.', at: [-26.2381, 27.9077], set: 'room', hours: 40 },
      { mode: 'sell', kind: 'house', street: '12 Mphahlele Street', area: 'Pimville', city: 'Soweto', price_rands: 1450000, deposit_rands: null, bedrooms: 3, bathrooms: 2, parking: 2, features: ['water_backup', 'security'], description: 'Family home with a borehole and a garage. Title deed ready.', at: [-26.2650, 27.8960], set: 'house', hours: 12 },
      { mode: 'sell', kind: 'flat', street: '201 Jan Smuts Avenue', area: 'Randburg', city: 'Johannesburg', price_rands: 895000, deposit_rands: null, bedrooms: 2, bathrooms: 1, parking: 1, features: ['security', 'power_backup'], description: 'Fourth-floor flat with a lift and backup power for the building.', at: [-26.0936, 28.0064], set: 'flat', hours: 28, lister: 'agent' },
      { mode: 'sell', kind: 'house', street: '9 3rd Avenue', area: 'Linden', city: 'Johannesburg', price_rands: 2300000, deposit_rands: null, bedrooms: 4, bathrooms: 3, parking: 2, features: ['power_backup', 'pets', 'security'], description: 'Four-bedroom house with a flatlet and solar backup.', at: [-26.1385, 27.9963], set: 'house', hours: 50 },
    ];
    for (const item of others) {
      const extra = listing({
        owner_id: OTHER_OWNER, lister: item.lister ?? 'owner', mode: item.mode, kind: item.kind, street: item.street, area: item.area, city: item.city,
        price_rands: item.price_rands, deposit_rands: item.deposit_rands, bedrooms: item.bedrooms, bathrooms: item.bathrooms, parking: item.parking,
        features: item.features, description: item.description, status: 'live', filmed_lat: item.at[0], filmed_lng: item.at[1],
        submitted_at: hoursAgo(item.hours + 4), reviewed_at: hoursAgo(item.hours),
      });
      db.listings.push(extra);
      await addSamplePhotos(extra, PHOTO_SETS[item.set].slice(0, 5));
      const tour = item.set === 'room' ? ['outside', 'bedroom_1', 'bathroom_1', 'meters'] : ['outside', 'lounge', 'kitchen', 'bedroom_1', 'bathroom_1'];
      addSampleClips(extra, tour, item.hours + 5);
    }
    // One clip in the waiting listing was filmed somewhere else, for the reviewer to spot.
    const far = db.clips.filter((clip) => clip.listing_id === waiting.id).at(-1);
    far.lat = -25.7479;
    far.lng = 28.2293; // Pretoria CBD, about 17 km away
  })();
  return seeded;
}

export function me() {
  return PEOPLE[db.persona] ?? null;
}
