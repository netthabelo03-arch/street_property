import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  defaultFilters, cleanFilters, withMode, toSearchArgs, activeCount, priceSummary, quickChips,
  checkPriceRange, countLine, publicStreet, publicPlace, cardFacts, MUST_HAVES, BED_CHOICES, PAGE_SIZE,
} from '../src/explore/filters.js';
import { parseRands, FEATURES, KINDS } from '../src/listings/rules.js';
import { parseRoute, hashFor, resolveRoute, tabFor, PROTECTED_SCREENS } from '../src/router.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1b2c3d4e5f60';

test('S2: Explore, Filters and listing pages are open to everyone', () => {
  assert.deepEqual(parseRoute('#/filters'), { screen: 'filters' });
  assert.deepEqual(parseRoute(`#/place/${ID}`), { screen: 'place', id: ID });
  assert.equal(hashFor({ screen: 'place', id: ID }), `#/place/${ID}`);
  assert.equal(hashFor({ screen: 'filters' }), '#/filters');
  for (const screen of ['filters', 'place']) {
    assert.ok(!PROTECTED_SCREENS.includes(screen));
    assert.equal(resolveRoute({ screen, id: ID }, false).screen, screen);
    assert.equal(tabFor(screen), 'explore');
  }
  for (const bad of ['#/place', '#/place/abc', `#/place/${ID}/x`, '#/filters/x']) assert.deepEqual(parseRoute(bad), { screen: 'explore' }, bad);
  const app = read('../src/app.js');
  assert.match(app, /filters: renderFilters/);
  assert.match(app, /place: renderPlace/);
});

test('S2: a fresh search is everything to rent, no filters', () => {
  const filters = defaultFilters();
  assert.equal(activeCount(filters), 0);
  assert.deepEqual(toSearchArgs(filters), {
    p_mode: 'rent', p_text: null, p_min_price: null, p_max_price: null, p_min_beds: null,
    p_kinds: null, p_features: null, p_parking: false, p_verified: false, p_limit: PAGE_SIZE, p_offset: 0,
  });
});

test('S2: filters become the database search, page by page', () => {
  const filters = { ...defaultFilters(), text: '  orlando west ', minPrice: 3000, maxPrice: 6000, minBeds: 2, kinds: ['flat', 'cottage'], musts: ['power', 'parking', 'pets'] };
  const args = toSearchArgs(filters, 2);
  assert.equal(args.p_text, 'orlando west');
  assert.deepEqual(args.p_features, ['power_backup', 'pets']);
  assert.equal(args.p_parking, true, 'parking is a count, not a feature');
  assert.equal(args.p_offset, 2 * PAGE_SIZE);
  assert.equal(activeCount(filters), 6, 'price, beds, types and three must-haves');
  for (const item of MUST_HAVES.filter((m) => m.feature)) assert.ok(FEATURES.some((f) => f.id === item.feature), item.feature);
});

test('S2: switching rent and buy clears the price only', () => {
  const filters = { ...defaultFilters(), minPrice: 3000, maxPrice: 6000, minBeds: 2, musts: ['pets'] };
  const buying = withMode(filters, 'sell');
  assert.equal(buying.mode, 'sell');
  assert.equal(buying.minPrice, null);
  assert.equal(buying.maxPrice, null);
  assert.equal(buying.minBeds, 2);
  assert.deepEqual(buying.musts, ['pets']);
  assert.equal(withMode(filters, 'rent'), filters);
});

test('S2: stored filters are cleaned before use', () => {
  const cleaned = cleanFilters({ mode: 'steal', text: 42, minPrice: -5, maxPrice: 7000, minBeds: 7, kinds: ['flat', 'castle'], musts: ['pets', 'pool'], tours: 'yes' });
  assert.deepEqual(cleaned, { mode: 'rent', text: '', minPrice: null, maxPrice: 7000, minBeds: null, kinds: ['flat'], musts: ['pets'], tours: false });
  assert.deepEqual(cleanFilters(null), defaultFilters());
  assert.deepEqual(BED_CHOICES.map((b) => b.label), ['Any', '1+', '2+', '3+', '4+']);
});

test('S2: the chips and count line read naturally', () => {
  const f = defaultFilters();
  assert.equal(priceSummary(f), 'Any price');
  assert.equal(priceSummary({ ...f, maxPrice: 6000 }), 'Up to R6 000');
  assert.equal(priceSummary({ ...f, minPrice: 3000 }), 'From R3 000');
  assert.equal(priceSummary({ ...f, minPrice: 3000, maxPrice: 6000 }), 'R3 000 to R6 000');
  assert.deepEqual(quickChips(f).map((c) => c.label), ['Any price', 'Any beds', 'Must-haves']);
  assert.deepEqual(quickChips({ ...f, minBeds: 2, kinds: ['flat'], musts: ['power'] }).map((c) => c.label), ['Any price', '2+ beds', 'Flat', 'Backup power']);
  assert.deepEqual(quickChips({ ...f, kinds: ['flat', 'house'], musts: ['power', 'pets'] }).map((c) => c.label).slice(2), ['2 types', '2 must-haves']);
  assert.equal(countLine(0, 'rent'), 'No places to rent match');
  assert.equal(countLine(1, 'rent'), '1 place to rent');
  assert.equal(countLine(12, 'sell'), '12 places for sale');
});

test('S2: price boxes: empty means no limit, and the minimum cannot pass the maximum', () => {
  assert.deepEqual(checkPriceRange('', '', parseRands), { min: null, max: null, error: null });
  assert.deepEqual(checkPriceRange('3 000', 'R6,000', parseRands), { min: 3000, max: 6000, error: null });
  assert.match(checkPriceRange('lots', '', parseRands).error, /minimum/);
  assert.match(checkPriceRange('', 'abc', parseRands).error, /maximum/);
  assert.match(checkPriceRange('7000', '6000', parseRands).error, /more than the maximum/);
});

test('S2: the public sees the street without the house number', () => {
  assert.equal(publicStreet('24 Ngakane Street'), 'Ngakane Street');
  assert.equal(publicStreet('1182 Tsamaya Avenue'), 'Tsamaya Avenue');
  assert.equal(publicStreet('12A Vilakazi Street'), 'Vilakazi Street');
  assert.equal(publicStreet('No. 7 Mthimkhulu Street'), 'Mthimkhulu Street');
  assert.equal(publicStreet('15-17 Main Road'), 'Main Road');
  assert.equal(publicStreet('3, 4th Avenue'), '4th Avenue', 'a street that starts with a number keeps it');
  assert.equal(publicStreet('Main Reef Road'), 'Main Reef Road');
  assert.equal(publicStreet('4th Avenue'), '4th Avenue', 'a numbered street is not a house number');
  assert.equal(publicStreet('24 7th Street'), '7th Street');
  assert.equal(publicStreet('3rd Avenue, Linden'), '3rd Avenue, Linden');
  assert.equal(publicStreet('42'), '');
  assert.equal(publicPlace({ street: '24 Ngakane Street', area: 'Orlando West', city: 'Soweto' }), 'Ngakane Street, Orlando West, Soweto');
  assert.equal(publicPlace({ street: '42', area: 'Dube', city: 'Soweto' }), 'Dube, Soweto');
});

test('S2: card facts', () => {
  assert.equal(cardFacts({ kind: 'flat', bedrooms: 2, bathrooms: 1, parking: 1, features: ['prepaid', 'power_backup'] }), '2 beds · 1 bath · 1 parking · Backup power');
  assert.equal(cardFacts({ kind: 'backyard_room', bedrooms: 1, bathrooms: 1, parking: 0, features: [] }), '1 bath');
  assert.equal(cardFacts({ kind: 'house', bedrooms: 1, bathrooms: 2, parking: 0, features: ['pets'] }), '1 bed · 2 baths · Pet friendly');
});

test('S2: the database search matches the app', () => {
  const sql = read('../supabase/003_search.sql');
  assert.match(sql, /security invoker/, 'listing rules still apply to whoever searches');
  assert.match(sql, /l\.status = 'live'/);
  assert.match(sql, /grant execute on function public\.search_listings\([^)]*\) to anon, authenticated;/);
  assert.match(sql, /least\(greatest\(coalesce\(p_limit, 20\), 0\), 50\)/);
  assert.ok(PAGE_SIZE <= 50);
  for (const kind of KINDS) assert.ok(!kind.id.includes("'"));
});
