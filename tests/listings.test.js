import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MODES, KINDS, FEATURES, PRICE_LIMITS, PHOTOS, TOUR, STATUSES,
  isEditable, parseRands, formatRands, listingTitle, priceLine, checkDetails,
  tourRooms, formatSeconds, secondsLeft, missingForReview, distanceMeters, clipDistances,
  pickVideoType, videoExtension, fitWithin, isUuid, formatDistance,
} from '../src/listings/rules.js';
import { friendlyListingError, cameraProblem } from '../src/listings/errors.js';
import { parseRoute, hashFor, safeNext, resolveRoute, tabFor, PROTECTED_SCREENS } from '../src/router.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sql = read('../supabase/002_listings.sql');
const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1b2c3d4e5f60';

const good = {
  mode: 'rent', kind: 'flat', street: '12 Vilakazi Street', area: 'Orlando West', city: 'Soweto',
  price: '4 500', deposit: '4500', availableFrom: '2026-12-01', bedrooms: 2, bathrooms: 1, parking: 1,
  features: ['prepaid', 'pets', 'made_up'], description: '  Close to the taxi rank.  ',
};

test('S1: listing addresses round-trip and need an account', () => {
  const cases = {
    '#/my-listings': { screen: 'my-listings' },
    '#/list/new': { screen: 'list-new' },
    [`#/list/${ID}`]: { screen: 'list-details', id: ID },
    [`#/list/${ID}/tour`]: { screen: 'list-tour', id: ID },
    [`#/list/${ID}/send`]: { screen: 'list-send', id: ID },
    '#/review': { screen: 'review' },
    [`#/review/${ID}`]: { screen: 'review-listing', id: ID },
  };
  for (const [hash, route] of Object.entries(cases)) {
    assert.deepEqual(parseRoute(hash), route, hash);
    assert.equal(hashFor(route), hash);
    assert.ok(PROTECTED_SCREENS.includes(route.screen));
    assert.deepEqual(resolveRoute(route, false), { screen: 'signin' });
    assert.equal(safeNext(hash), hash, 'brought back after logging in');
    assert.equal(tabFor(route.screen), 'profile');
  }
  for (const bad of ['#/list', '#/list/123', `#/list/${ID}/edit`, `#/list/${ID}/tour/x`, '#/review/abc', '#/list/new/tour']) {
    assert.deepEqual(parseRoute(bad), { screen: 'explore' }, bad);
  }
  assert.deepEqual(parseRoute(`#/list/${ID.toUpperCase()}`), { screen: 'list-details', id: ID });
});

test('S1: every listing screen is wired into the app', () => {
  const app = read('../src/app.js');
  for (const screen of PROTECTED_SCREENS) assert.match(app, new RegExp(`'?${screen}'?: render`), screen);
});

test('S1: rands are read the way people type them and shown South African style', () => {
  assert.equal(parseRands('4500'), 4500);
  assert.equal(parseRands('R 4 500'), 4500);
  assert.equal(parseRands('4,500.00'), 4500);
  assert.equal(parseRands('r850000'), 850000);
  for (const bad of ['', 'four', '-5', '4.5k', null, '1e5']) assert.equal(parseRands(bad), null, String(bad));
  assert.equal(formatRands(4500), 'R4 500');
  assert.equal(formatRands(1250000), 'R1 250 000');
  assert.equal(formatRands(300), 'R300');
});

test('S1: a good listing passes, and is cleaned on the way', () => {
  const { errors, values } = checkDetails(good);
  assert.deepEqual(errors, {});
  assert.equal(values.price_rands, 4500);
  assert.equal(values.deposit_rands, 4500);
  assert.deepEqual(values.features, ['prepaid', 'pets'], 'unknown features are dropped');
  assert.equal(values.description, 'Close to the taxi rank.');
  assert.equal(values.available_from, '2026-12-01');
});

test('S1: each wrong detail gets its own message', () => {
  const { errors } = checkDetails({ ...good, mode: 'lease', kind: 'castle', street: 'x', area: '', city: ' ', description: 'a'.repeat(1001) });
  assert.deepEqual(Object.keys(errors).sort(), ['area', 'city', 'description', 'kind', 'mode', 'street']);
  assert.match(checkDetails({ ...good, price: '200' }).errors.price, /R300 and R500 000/);
  assert.match(checkDetails({ ...good, price: 'lots' }).errors.price, /numbers only/);
  assert.match(checkDetails({ ...good, deposit: 'two months' }).errors.deposit, /numbers only/);
  assert.equal(checkDetails({ ...good, deposit: '' }).values.deposit_rands, null, 'deposit is optional');
});

test('S1: selling uses sale prices and drops the deposit and date', () => {
  const sell = checkDetails({ ...good, mode: 'sell', price: '850 000' });
  assert.deepEqual(sell.errors, {});
  assert.equal(sell.values.price_rands, 850000);
  assert.equal(sell.values.deposit_rands, null);
  assert.equal(sell.values.available_from, null);
  assert.ok(checkDetails({ ...good, mode: 'sell', price: '4500' }).errors.price, 'R4 500 is not a sale price');
  assert.equal(MODES.find((m) => m.id === 'sell').priceLabel, 'Asking price (R)');
});

test('S1: counts outside 0 to 20 fall back to 0', () => {
  const { values } = checkDetails({ ...good, bedrooms: 25, bathrooms: -1, parking: 2.5 });
  assert.deepEqual([values.bedrooms, values.bathrooms, values.parking], [0, 0, 0]);
});

test('S1: titles and prices read naturally', () => {
  assert.equal(listingTitle({ kind: 'flat', bedrooms: 2, area: 'Soweto' }), '2-bed flat in Soweto');
  assert.equal(listingTitle({ kind: 'backyard_room', bedrooms: 1, area: 'Tembisa' }), 'Backyard room in Tembisa');
  assert.equal(listingTitle({ kind: 'house', bedrooms: 0, area: '' }), 'House');
  assert.equal(priceLine({ mode: 'rent', price_rands: 3800 }), 'R3 800 a month');
  assert.equal(priceLine({ mode: 'sell', price_rands: 950000 }), 'R950 000');
});

test('S1: the rooms to film follow the place', () => {
  const flat = tourRooms({ kind: 'flat', bedrooms: 2, bathrooms: 1 }).map((r) => r.id);
  assert.deepEqual(flat, ['outside', 'lounge', 'kitchen', 'bedroom_1', 'bedroom_2', 'bathroom_1', 'meters']);
  const room = tourRooms({ kind: 'backyard_room', bedrooms: 1, bathrooms: 1 }).map((r) => r.id);
  assert.deepEqual(room, ['outside', 'bedroom_1', 'bathroom_1', 'kitchen', 'meters']);
  const big = tourRooms({ kind: 'house', bedrooms: 15, bathrooms: 0 });
  assert.equal(big.filter((r) => r.id.startsWith('bedroom_')).length, 9, 'at most 9 bedrooms (database room names)');
  assert.equal(big.filter((r) => r.id.startsWith('bathroom_')).length, 1, 'always at least one bathroom');
  assert.equal(tourRooms({ kind: 'flat', bedrooms: 1, bathrooms: 1 }).find((r) => r.id === 'bedroom_1').name, 'Bedroom');
  for (const r of big) assert.match(r.id, /^(outside|lounge|kitchen|dining|garden|meters|bedroom_[1-9]|bathroom_[1-9])$/, 'room ids match the database check');
  assert.equal(tourRooms({ kind: 'flat' })[0].required, true);
});

test('S1: tour time adds up to 2 minutes; filming a room again frees its time', () => {
  const clips = [{ room: 'outside', seconds: 25 }, { room: 'lounge', seconds: 30 }, { room: 'kitchen', seconds: 30 }];
  assert.equal(secondsLeft(clips, 'bedroom_1'), 35);
  assert.equal(secondsLeft(clips, 'lounge'), 65);
  assert.equal(secondsLeft([...clips, { room: 'bedroom_1', seconds: 40 }], 'meters'), 0);
  assert.equal(formatSeconds(83), '1:23');
  assert.equal(formatSeconds(120), '2:00');
  assert.equal(formatSeconds(4.6), '0:05');
  assert.equal(TOUR.totalMaxSeconds, 120);
  assert.equal(TOUR.clipMaxSeconds, 30);
});

test('S1: sending needs 5 photos, the outside and 3 more rooms', () => {
  const photos = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));
  const clip = (room) => ({ room, seconds: 10 });
  assert.deepEqual(missingForReview({ photos: photos(5), clips: ['outside', 'lounge', 'kitchen', 'bedroom_1'].map(clip) }), []);
  const nothing = missingForReview({ photos: [], clips: [] });
  assert.equal(nothing.length, 3);
  assert.match(nothing[0], /Add 5 more photos/);
  assert.match(missingForReview({ photos: photos(4), clips: [] })[0], /Add 1 more photo \(/);
  const noOutside = missingForReview({ photos: photos(6), clips: ['lounge', 'kitchen', 'bedroom_1', 'meters'].map(clip) });
  assert.deepEqual(noOutside, ['Film the outside and gate.']);
  assert.equal(PHOTOS.min, 5);
  assert.equal(PHOTOS.max, 12);
});

test('S1: the reviewer sees clips filmed far from the outside clip', () => {
  const vilakazi = { lat: -26.2385, lng: 27.9086 };
  assert.ok(Math.abs(distanceMeters(vilakazi, { lat: -26.2385, lng: 27.9096 }) - 100) < 3, '0.001° of longitude here is about 100 m');
  const clips = [
    { room: 'outside', ...vilakazi, accuracy_m: 10 },
    { room: 'lounge', lat: -26.2386, lng: 27.9087, accuracy_m: 8 },
    { room: 'kitchen', lat: -26.2041, lng: 28.0473, accuracy_m: 15 }, // Johannesburg CBD
    { room: 'bedroom_1', lat: -26.2385, lng: 27.9106, accuracy_m: 80 }, // 200 m, but the phone was unsure
  ];
  const found = clipDistances(clips);
  assert.deepEqual(found.map((d) => d.far), [false, false, true, false]);
  assert.ok(found[2].metres > 10000);
  assert.deepEqual(clipDistances([{ room: 'lounge', lat: 0, lng: 0 }]), [{ room: 'lounge', metres: null, far: false }]);
});

test('S1: the phone picks a video type it can record', () => {
  assert.equal(pickVideoType((t) => t === 'video/mp4'), 'video/mp4', 'iPhone');
  assert.equal(pickVideoType((t) => t.startsWith('video/webm')), 'video/webm;codecs=vp9', 'Android Chrome');
  assert.equal(pickVideoType(() => false), null);
  assert.equal(videoExtension('video/mp4;codecs=avc1'), 'mp4');
  assert.equal(videoExtension('video/webm;codecs=vp8'), 'webm');
});

test('S1: photos are shrunk to 1600 pixels on the long side, never enlarged', () => {
  assert.deepEqual(fitWithin(4032, 3024), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3024, 4032), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
});

test('S1: states, and which ones the owner may edit', () => {
  assert.deepEqual(Object.keys(STATUSES), ['draft', 'in_review', 'changes_needed', 'live', 'taken_down']);
  assert.deepEqual(Object.keys(STATUSES).filter(isEditable), ['draft', 'changes_needed', 'taken_down']);
  assert.ok(isUuid(ID));
  assert.equal(isUuid('not-a-uuid'), false);
});

test('S1: database messages become plain sentences', () => {
  assert.match(friendlyListingError({ code: 'P0001', hint: 'not_a_lister', message: 'x' }), /profile/);
  assert.match(friendlyListingError({ code: 'P0001', hint: 'tour_too_long' }), /2 minutes/);
  assert.match(friendlyListingError({ code: 'P0001', hint: 'need_photos' }), /5 photos/);
  assert.match(friendlyListingError({ message: 'A listing can have up to 12 photos' }), /up to 12/);
  assert.match(friendlyListingError({ code: 'location_denied' }), /Allow location/);
  assert.match(friendlyListingError(cameraProblem({ name: 'NotAllowedError' })), /camera is blocked/);
  assert.match(friendlyListingError(cameraProblem({ name: 'NotReadableError' })), /No camera/);
  assert.match(friendlyListingError({ message: 'The object exceeded the maximum allowed size' }), /too large/);
  assert.match(friendlyListingError(new TypeError('Failed to fetch')), /No connection/);
});

test('S1: the database script matches the app', () => {
  for (const kind of KINDS) assert.ok(sql.includes(`'${kind.id}'`), kind.id);
  for (const feature of FEATURES) assert.ok(sql.includes(`'${feature.id}'`), feature.id);
  for (const status of Object.keys(STATUSES)) assert.ok(sql.includes(`'${status}'`), status);
  assert.match(sql, new RegExp(`mode = 'rent' and price_rands between ${PRICE_LIMITS.rent.min} and ${PRICE_LIMITS.rent.max}`));
  assert.match(sql, new RegExp(`mode = 'sell' and price_rands between ${PRICE_LIMITS.sell.min} and ${PRICE_LIMITS.sell.max}`));
  assert.match(sql, new RegExp(`photo_count < ${PHOTOS.min}`));
  assert.match(sql, new RegExp(`>= ${PHOTOS.max} then`));
  assert.match(sql, new RegExp(`clip_count < ${TOUR.minClips}`));
  assert.match(sql, new RegExp(`> ${TOUR.totalMaxSeconds} then`));
  assert.match(sql, new RegExp(`seconds between 1 and ${TOUR.clipMaxSeconds}`));
  assert.match(sql, /select p_status in \('draft', 'changes_needed', 'taken_down'\)/);
});

test('S1: the app can never set a listing\'s state, review or location itself', () => {
  const grants = sql.match(/grant (insert|update) \(([^)]*)\)\s+on public\.listings/g);
  assert.equal(grants.length, 2);
  for (const grant of grants) {
    for (const locked of ['status', 'review_note', 'reviewed_by', 'reviewed_at', 'submitted_at', 'filmed_lat', 'owner_id', 'lister']) {
      assert.ok(!new RegExp(`[(, ]${locked}[,)]`).test(grant), `${locked} must not be writable`);
    }
  }
  assert.match(sql, /revoke all on public\.tour_clips from anon, authenticated;/);
  assert.doesNotMatch(sql, /grant insert[^;]*on public\.tour_clips/, 'clips only through add_tour_clip()');
  assert.match(sql, /revoke all on public\.tour_codes from anon, authenticated;/);
  assert.match(sql, /\('listing-photos', 'listing-photos', false,/);
  assert.match(sql, /\('listing-tours', 'listing-tours', false,/);
  for (const fn of ['tour_code', 'add_tour_clip', 'submit_listing', 'withdraw_listing', 'review_listing']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`), fn);
  }
});

test('S1: distances read naturally for the reviewer', () => {
  assert.equal(formatDistance(6), '6 m');
  assert.equal(formatDistance(999.4), '999 m');
  assert.equal(formatDistance(1000), '1 km');
  assert.equal(formatDistance(1500), '1.5 km');
  assert.equal(formatDistance(2345), '2.35 km');
  assert.equal(formatDistance(17283), '17.3 km');
  assert.equal(formatDistance(20000), '20 km');
});
