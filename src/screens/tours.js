// The tour feed: one place at a time, full screen, its video tour playing room
// by room. Swipe up for the next place, down for the one before; tap the right
// side for the next room, the left side to go back. Follows Explore's
// Rent / Buy, search words and filters. Save, Ask, Share and Book a viewing
// are always in reach.

import { searchListings } from '../explore/api.js';
import { loadFilters, publicPlace, activeCount } from '../explore/filters.js';
import { listClips } from '../listings/api.js';
import { listingTitle, formatRands, priceLine } from '../listings/rules.js';
import { savedIds, saveListing, unsaveListing } from '../saved/api.js';
import { feedLabel, orderClips, roomLabel, shareUrl, swipeDirection, shouldLoadMore } from '../tours/feed.js';
import { friendlyListingError } from '../listings/errors.js';
import { saveNext } from '../next.js';
import { el, icon } from '../dom.js';

const HEART = '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"></path>';
const CHAT = '<path d="M4 5h16v11H9l-5 4z"></path>';
const SHARE = '<circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="6" r="2.5"></circle><circle cx="18" cy="18" r="2.5"></circle><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"></path>';
const DOWN = '<path d="M6 9l6 6 6-6"></path>';
const UP = '<path d="M6 15l6-6 6 6"></path>';

export async function renderTours({ session, navigate }) {
  const filters = loadFilters();
  const first = await searchListings(filters, 0);
  let places = first.items;
  const total = first.total ?? 0;
  let page = 0;
  let loadingMore = false;
  let saved = new Set();
  if (session) saved = await savedIds(session.user.id).catch(() => new Set());

  let placeIndex = 0;
  let clips = [];
  let roomIndex = 0;
  let showing = 0;
  const clipCache = new Map();

  // The parts of the screen
  const video = el('video', { class: 'feed__video', playsinline: '', muted: '', autoplay: '', preload: 'auto' });
  video.muted = true;
  const bars = el('div', { class: 'tour-full__bars' });
  const room = el('p', { class: 'tour-full__room', 'aria-live': 'polite' });
  const close = el('button', { type: 'button', class: 'tour-full__close', 'aria-label': 'Close the tour feed', text: '✕' });
  const label = el('p', { class: 'feed__label', text: feedLabel(filters) });
  const back = el('button', { type: 'button', class: 'tour-full__zone tour-full__zone--back', 'aria-label': 'Room before' });
  const forward = el('button', { type: 'button', class: 'tour-full__zone tour-full__zone--next', 'aria-label': 'Next room' });

  const heart = el('button', { type: 'button', class: 'feed__action' });
  const ask = el('button', { type: 'button', class: 'feed__action' }, [icon(CHAT, 26), el('span', { text: 'Ask' })]);
  const share = el('button', { type: 'button', class: 'feed__action' }, [icon(SHARE, 26), el('span', { text: 'Share' })]);
  const prev = el('button', { type: 'button', class: 'feed__step', 'aria-label': 'Place before' }, [icon(UP, 22)]);
  const next = el('button', { type: 'button', class: 'feed__step', 'aria-label': 'Next place' }, [icon(DOWN, 22)]);
  const toast = el('p', { class: 'feed__toast', role: 'status' });
  toast.hidden = true;

  const info = el('div', { class: 'feed__info' });
  const book = el('button', { type: 'button', class: 'button button--primary feed__book', text: 'Book a viewing' });
  const empty = el('div', { class: 'tour-full__end' });
  empty.hidden = true;

  const overlay = el('div', { class: 'tour-full feed', role: 'region', 'aria-label': 'Tour feed', tabindex: '-1' }, [
    video,
    back,
    forward,
    el('div', { class: 'tour-full__top' }, [
      bars,
      el('div', { class: 'tour-full__heading' }, [el('div', {}, [label, room]), close]),
    ]),
    el('div', { class: 'feed__side' }, [heart, ask, share, prev, next]),
    el('div', { class: 'feed__bottom' }, [info, book]),
    toast,
    empty,
  ]);

  function say(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(say.timer);
    say.timer = setTimeout(() => { toast.hidden = true; }, 2500);
  }

  function drawHeart() {
    const place = places[placeIndex];
    const on = place && saved.has(place.id);
    heart.replaceChildren(icon(HEART, 26), el('span', { text: on ? 'Saved' : 'Save' }));
    heart.classList.toggle('feed__action--on', Boolean(on));
    heart.setAttribute('aria-pressed', String(Boolean(on)));
  }

  function drawInfo(place) {
    const price = place.mode === 'rent'
      ? [el('span', { class: 'feed__price', text: formatRands(place.price_rands) }), el('span', { class: 'feed__per', text: ' / month' })]
      : [el('span', { class: 'feed__price', text: priceLine(place) })];
    info.replaceChildren(
      el('span', { class: 'chip chip--good', text: 'Filmed on site' }),
      el('p', {}, price),
      el('p', { class: 'feed__title', text: listingTitle(place) }),
      el('p', { class: 'feed__where', text: publicPlace(place) }),
    );
  }

  function drawBars() {
    [...bars.children].forEach((bar, n) => {
      const fill = bar.firstElementChild;
      if (n < roomIndex) fill.style.width = '100%';
      else if (n > roomIndex) fill.style.width = '0%';
      else fill.style.width = video.duration ? `${Math.min(100, (video.currentTime / video.duration) * 100)}%` : '0%';
    });
  }

  function playRoom(n) {
    roomIndex = n;
    const clip = clips[roomIndex];
    if (!clip) return;
    room.textContent = `${roomLabel(places[placeIndex], clip.room)} · ${roomIndex + 1} of ${clips.length}`;
    video.src = clip.url;
    video.play().catch(() => {});
    drawBars();
  }

  async function clipsFor(place) {
    if (!clipCache.has(place.id)) clipCache.set(place.id, listClips(place.id).then((found) => orderClips(found, place)));
    return clipCache.get(place.id);
  }

  async function showPlace(n) {
    if (n < 0 || n >= places.length) return;
    placeIndex = n;
    const thisShow = ++showing;
    const place = places[n];
    empty.hidden = true;
    drawInfo(place);
    drawHeart();
    video.removeAttribute('src');
    video.poster = place.coverUrl ?? '';
    room.textContent = 'Loading the tour…';
    bars.replaceChildren();
    prev.disabled = n === 0;
    next.disabled = n === places.length - 1 && places.length >= total;
    let found;
    try {
      found = await clipsFor(place);
    } catch (error) {
      if (thisShow === showing) room.textContent = friendlyListingError(error);
      return;
    }
    if (thisShow !== showing) return;
    clips = found;
    bars.replaceChildren(...clips.map(() => el('span', { class: 'tour-full__bar' }, [el('span', { class: 'tour-full__fill' })])));
    if (clips.length === 0) {
      room.textContent = 'No tour clips for this place';
    } else {
      playRoom(0);
    }
    // Get the next place's tour ready, and the next page of places.
    if (places[n + 1]) clipsFor(places[n + 1]).catch(() => {});
    if (shouldLoadMore(n, places.length, total) && !loadingMore) {
      loadingMore = true;
      page += 1;
      searchListings(filters, page).then((more) => { places = places.concat(more.items); next.disabled = false; })
        .catch(() => {}).finally(() => { loadingMore = false; });
    }
  }

  function showEnd() {
    video.pause();
    empty.replaceChildren(
      el('p', { class: 'tour-full__end-title', text: `That's all ${total} place${total === 1 ? '' : 's'}` }),
      el('p', { class: 'lead', text: 'Change the area or filters to see more tours.' }),
      el('a', { href: '#/filters', class: 'button button--primary', text: 'Change filters' }),
      el('button', { type: 'button', class: 'button button--quiet', text: 'Watch from the start', 'data-restart': '' }),
    );
    empty.querySelector('[data-restart]').addEventListener('click', () => showPlace(0));
    empty.hidden = false;
  }

  function nextPlace() {
    if (placeIndex + 1 < places.length) showPlace(placeIndex + 1);
    else if (places.length >= total) showEnd();
  }
  function previousPlace() {
    if (placeIndex > 0) showPlace(placeIndex - 1);
  }
  function nextRoom() {
    if (roomIndex + 1 < clips.length) playRoom(roomIndex + 1);
    else nextPlace();
  }
  function previousRoom() {
    if (video.currentTime > 2 || roomIndex === 0) {
      video.currentTime = 0;
      video.play().catch(() => {});
    } else playRoom(roomIndex - 1);
  }

  video.addEventListener('timeupdate', drawBars);
  video.addEventListener('ended', nextRoom);
  forward.addEventListener('click', nextRoom);
  back.addEventListener('click', previousRoom);
  next.addEventListener('click', nextPlace);
  prev.addEventListener('click', previousPlace);

  // Swipes and keys
  let touchStart = null;
  overlay.addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  overlay.addEventListener('touchend', (event) => {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const way = swipeDirection(touch.clientX - touchStart.x, touch.clientY - touchStart.y);
    touchStart = null;
    if (way === 'next') { event.preventDefault(); nextPlace(); }
    if (way === 'previous') { event.preventDefault(); previousPlace(); }
  });
  let wheelReady = true;
  overlay.addEventListener('wheel', (event) => {
    if (!wheelReady || Math.abs(event.deltaY) < 30) return;
    wheelReady = false;
    setTimeout(() => { wheelReady = true; }, 600);
    if (event.deltaY > 0) nextPlace(); else previousPlace();
  }, { passive: true });
  function onKey(event) {
    if (event.key === 'ArrowDown') nextPlace();
    else if (event.key === 'ArrowUp') previousPlace();
    else if (event.key === 'ArrowRight') nextRoom();
    else if (event.key === 'ArrowLeft') previousRoom();
    else if (event.key === 'Escape') leave();
  }
  document.addEventListener('keydown', onKey);

  // Actions
  heart.addEventListener('click', async () => {
    const place = places[placeIndex];
    if (!place) return;
    if (!session) {
      saveNext('#/tours');
      navigate('#/signin');
      return;
    }
    const was = saved.has(place.id);
    if (was) saved.delete(place.id); else saved.add(place.id);
    drawHeart();
    try {
      if (was) await unsaveListing(place.id, session.user.id);
      else await saveListing(place.id);
      say(was ? 'Removed from Saved' : 'Saved. Find it in the Saved tab.');
    } catch (error) {
      if (was) saved.add(place.id); else saved.delete(place.id);
      drawHeart();
      say(friendlyListingError(error));
    }
  });
  const openPlace = () => {
    const place = places[placeIndex];
    if (place) navigate(`#/place/${place.id}`);
  };
  ask.addEventListener('click', openPlace);
  book.addEventListener('click', openPlace);
  share.addEventListener('click', async () => {
    const place = places[placeIndex];
    if (!place) return;
    const url = shareUrl(place.id, window.location);
    const text = `${listingTitle(place)}, ${priceLine(place)}. Watch the video tour on Street Property.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: listingTitle(place), text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      say('Link copied');
    } catch (error) {
      if (error?.name !== 'AbortError') say(`Copy this link: ${url}`);
    }
  });

  function cleanUp() {
    video.pause();
    video.removeAttribute('src');
    video.load();
    document.body.classList.remove('tour-open');
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onHash);
  }
  function leave() {
    navigate('#/');
  }
  function onHash() {
    if (!window.location.hash.startsWith('#/tours')) cleanUp();
  }
  close.addEventListener('click', leave);
  window.addEventListener('hashchange', onHash);

  if (places.length === 0) {
    const filtered = activeCount(filters) > 0 || filters.text.trim() !== '';
    empty.replaceChildren(
      el('p', { class: 'tour-full__end-title', text: filtered ? 'No tours match yet' : 'No tours yet' }),
      el('p', { class: 'lead', text: filtered
        ? `Nothing ${filters.mode === 'rent' ? 'to rent' : 'for sale'} matches your search and filters. Try another area or fewer filters.`
        : 'Tours show here as soon as owners list their places and they are checked.' }),
      el('a', { href: '#/filters', class: 'button button--primary', text: 'Change filters' }),
      el('a', { href: '#/', class: 'button button--quiet', text: 'Back to Explore' }),
    );
    empty.hidden = false;
    info.replaceChildren();
    book.hidden = true;
  } else {
    setTimeout(() => showPlace(0), 0);
  }
  document.body.classList.add('tour-open');
  setTimeout(() => overlay.focus({ preventScroll: true }), 0);
  return [overlay];
}
