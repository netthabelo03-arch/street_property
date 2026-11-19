import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pinPrice, areaArgs, mapCountLine, spreadPins } from '../src/map/pins.js';
import { publicStreet } from '../src/explore/filters.js';
import { parseRoute, tabFor, PROTECTED_SCREENS } from '../src/router.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('S3: the Map tab is open to everyone', () => {
  assert.deepEqual(parseRoute('#/map'), { screen: 'map' });
  assert.ok(!PROTECTED_SCREENS.includes('map'));
  assert.equal(tabFor('map'), 'map');
  assert.match(read('../src/app.js'), /map: renderMap/);
});

test('S3: pins show short prices', () => {
  assert.equal(pinPrice({ mode: 'rent', price_rands: 4500 }), 'R4 500');
  assert.equal(pinPrice({ mode: 'rent', price_rands: 12900 }), 'R12 900');
  assert.equal(pinPrice({ mode: 'sell', price_rands: 895000 }), 'R895k');
  assert.equal(pinPrice({ mode: 'sell', price_rands: 1450000 }), 'R1.45m');
  assert.equal(pinPrice({ mode: 'sell', price_rands: 2000000 }), 'R2m');
});

test('S3: the map searches a little more than it shows', () => {
  const args = areaArgs({ south: -26.3, north: -26.1, west: 27.8, east: 28.0 });
  assert.ok(args.p_south < -26.3 && args.p_north > -26.1 && args.p_west < 27.8 && args.p_east > 28.0);
  assert.ok(Math.abs(args.p_south - -26.31) < 1e-9);
});

test('S3: the line under the map', () => {
  assert.equal(mapCountLine(0, 0, 'rent'), 'No places to rent in this area. Move the map or zoom out.');
  assert.equal(mapCountLine(3, 3, 'sell'), '3 places for sale here');
  assert.equal(mapCountLine(1, 1, 'rent'), '1 place to rent here');
  assert.match(mapCountLine(50, 80, 'rent'), /50 newest of 80.*Zoom in/);
});

test('S3: places rounded to the same spot do not hide each other', () => {
  const spot = { approx_lat: -26.239, approx_lng: 27.909 };
  const spread = spreadPins([{ id: 1, ...spot }, { id: 2, ...spot }, { id: 3, ...spot }, { id: 4, approx_lat: -26.1, approx_lng: 28 }]);
  assert.deepEqual([spread[0].lat, spread[0].lng], [-26.239, 27.909]);
  const keys = new Set(spread.map((pin) => `${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}`));
  assert.equal(keys.size, 4);
  for (const pin of spread.slice(1, 3)) assert.ok(Math.abs(pin.lat - spot.approx_lat) < 0.001, 'still in the same block');
});

test('S3: the database rounds the spot and drops the house number the same way the app does', () => {
  const sql = read('../supabase/004_map.sql');
  const pattern = sql.match(/'(\^\(no.*?)',\s*''/s)[1];
  const sqlRule = new RegExp(pattern, 'i');
  for (const street of ['24 Ngakane Street', '4th Avenue', 'No. 7 Mthimkhulu Street', '15-17 Main Road', '24 7th Street', 'Main Reef Road']) {
    assert.equal(street.trim().replace(sqlRule, '').trim(), publicStreet(street), street);
  }
  assert.match(sql, /round\(filmed_lat::numeric, 3\)/, 'about 100 m');
});

test('S3: nobody but the owner and admins can read the exact address or spot', () => {
  const sql = read('../supabase/004_map.sql');
  const grant = sql.match(/grant select \(([^)]*)\) on public\.listings to anon, authenticated;/)[1];
  for (const hidden of ['street,', 'filmed_lat', 'filmed_lng']) assert.ok(!new RegExp(`(^|[\\s,])${hidden}`).test(grant), hidden);
  assert.ok(grant.includes('street_public') && grant.includes('approx_lat'));
  const clipGrant = sql.match(/grant select \(([^)]*)\) on public\.tour_clips to anon, authenticated;/)[1];
  for (const hidden of ['lat', 'lng', 'accuracy_m']) assert.ok(!clipGrant.split(/,\s*/).includes(hidden), hidden);
  assert.match(sql, /l\.owner_id = auth\.uid\(\) or public\.is_admin\(\)/);
  // The app never asks for them directly.
  const api = read('../src/listings/api.js');
  const columns = api.match(/const COLUMNS = '([^']*)'/)[1].split(/,\s*/);
  for (const hidden of ['street', 'filmed_lat', 'filmed_lng']) assert.ok(!columns.includes(hidden), hidden);
  assert.doesNotMatch(api, /select\('[^']*\blat\b[^']*'\)/, 'clips are read without their spot');
});

test('S3: the map library is pinned to the exact file checked', () => {
  const loader = read('../src/map/leaflet.js');
  assert.match(loader, /leaflet\/1\.9\.4\/leaflet\.min\.js/);
  assert.match(loader, /integrity: 'sha384-[A-Za-z0-9+/]{64}'/);
  assert.match(loader, /crossOrigin = 'anonymous'/);
});
