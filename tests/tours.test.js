import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feedLabel, orderClips, roomLabel, shareUrl, swipeDirection, shouldLoadMore } from '../src/tours/feed.js';
import { defaultFilters } from '../src/explore/filters.js';
import { parseRoute, resolveRoute, safeNext, tabFor, PROTECTED_SCREENS } from '../src/router.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('S5: the tour feed is open to everyone; Saved needs an account', () => {
  assert.deepEqual(parseRoute('#/tours'), { screen: 'tours' });
  assert.deepEqual(parseRoute('#/saved'), { screen: 'saved' });
  assert.ok(!PROTECTED_SCREENS.includes('tours'));
  assert.equal(resolveRoute({ screen: 'tours' }, false).screen, 'tours');
  assert.equal(resolveRoute({ screen: 'saved' }, false).screen, 'signin');
  assert.equal(safeNext('#/tours'), '#/tours', 'Save while logged out comes back to the feed');
  assert.equal(tabFor('saved'), 'saved');
  const app = read('../src/app.js');
  assert.match(app, /tours: renderTours/);
  assert.match(app, /saved: renderSaved/);
  assert.match(read('../src/screens/explore.js'), /href: '#\/tours'/, 'the Tours chip opens the feed');
});

test('S5: the label at the top says what the feed is showing', () => {
  const f = defaultFilters();
  assert.equal(feedLabel(f), 'All areas · to rent · any price');
  assert.equal(feedLabel({ ...f, text: 'melville', maxPrice: 10000 }), 'Melville · to rent · under R10 000');
  assert.equal(feedLabel({ ...f, mode: 'sell', text: 'orlando west', minPrice: 500000 }), 'Orlando West · for sale · from R500 000');
  assert.equal(feedLabel({ ...f, minPrice: 3000, maxPrice: 6000 }), 'All areas · to rent · R3 000 to R6 000');
});

test('S5: rooms play in walking order; clips that cannot play are skipped', () => {
  const listing = { kind: 'flat', bedrooms: 2, bathrooms: 1 };
  const clips = [
    { room: 'bathroom_1', url: 'b' },
    { room: 'outside', url: 'o' },
    { room: 'bedroom_2', url: 'b2' },
    { room: 'kitchen', url: null },
    { room: 'lounge', url: 'l' },
    { room: 'garden', url: 'g' },
  ];
  assert.deepEqual(orderClips(clips, listing).map((c) => c.room), ['outside', 'lounge', 'bedroom_2', 'bathroom_1', 'garden']);
  assert.equal(roomLabel(listing, 'bedroom_2'), 'Bedroom 2');
  assert.equal(roomLabel(listing, 'garden'), 'garden');
});

test('S5: share links open the listing', () => {
  assert.equal(shareUrl('abc', { origin: 'https://netthabelo03-arch.github.io', pathname: '/street_property/' }), 'https://netthabelo03-arch.github.io/street_property/#/place/abc');
});

test('S5: swipes', () => {
  assert.equal(swipeDirection(5, -120), 'next', 'finger up');
  assert.equal(swipeDirection(-10, 90), 'previous', 'finger down');
  assert.equal(swipeDirection(3, 20), null, 'a tap');
  assert.equal(swipeDirection(150, -80), null, 'mostly sideways');
});

test('S5: the next page loads before the end', () => {
  assert.equal(shouldLoadMore(16, 20, 45), true);
  assert.equal(shouldLoadMore(10, 20, 45), false);
  assert.equal(shouldLoadMore(18, 20, 20), false, 'nothing more to load');
});

test('S5: saved places are private and only live places can be saved', () => {
  const sql = read('../supabase/006_saved.sql');
  assert.match(sql, /grant insert \(listing_id\) on public\.saved_listings to authenticated;/, 'user_id is always the person saving');
  assert.match(sql, /l\.status = 'live'/);
  assert.match(sql, /\(select auth\.uid\(\)\) = user_id/);
  assert.match(sql, />= 200 then/);
  assert.match(sql, /security invoker/);
});
