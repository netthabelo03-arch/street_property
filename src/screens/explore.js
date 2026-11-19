// Explore: the home screen. Choose rent or buy, search by street, suburb or
// township, narrow down with filters, and scroll through live listings.
// "Tours" opens the tour feed: the same search, as full-screen video tours.

import { loadViewer } from '../viewer.js';
import { canList } from '../roles.js';
import { searchListings } from '../explore/api.js';
import { loadFilters, saveFilters, withMode, quickChips, activeCount, countLine, publicPlace, cardFacts, defaultFilters } from '../explore/filters.js';
import { listingTitle, priceLine, formatRands, formatSeconds } from '../listings/rules.js';
import { friendlyListingError } from '../listings/errors.js';
import { topBar, tabBar } from '../shell.js';
import { el, icon } from '../dom.js';

const SEARCH = '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path>';
const SHIELD = '<path d="M12 3l8 3v6c0 5-3.5 8.5-8 9.5C7.5 20.5 4 17 4 12V6z"></path><path d="M8.5 12l2.5 2.5 4.5-5"></path>';
const SLIDERS = '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"></path><circle cx="16" cy="6" r="2"></circle><circle cx="10" cy="12" r="2"></circle><circle cx="18" cy="18" r="2"></circle>';
const PIN = '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"></path><circle cx="12" cy="9" r="2.5"></circle>';
const PLAY = '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"></path>';

/** The words for each mode of the Rent / Buy switch. */
export const MODES = {
  rent: { label: 'Rent', placeholder: 'Street, suburb or township' },
  sell: { label: 'Buy', placeholder: 'Street, suburb or township' },
};

/** Plays a card's clip only while it is on screen, to save data and battery. */
const watcher = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target;
      if (entry.isIntersecting) video.play().catch(() => {});
      else video.pause();
    }
  }, { threshold: 0.6 })
  : null;

/** A listing card (also used under the map). */
export function placeCard(listing, tours) {
  const media = el('div', { class: 'place-card__media' });
  if (tours && listing.tourUrl) {
    const video = el('video', { class: 'place-card__image', muted: '', loop: '', playsinline: '', preload: 'metadata', 'aria-label': `Video tour of ${listingTitle(listing)}` });
    video.muted = true;
    video.src = listing.tourUrl;
    if (listing.coverUrl) video.poster = listing.coverUrl;
    watcher?.observe(video);
    media.append(video);
  } else if (listing.coverUrl) {
    media.append(el('img', { class: 'place-card__image', src: listing.coverUrl, alt: '', loading: 'lazy' }));
  }
  const badges = [el('span', { class: 'place-card__badge place-card__badge--good', text: 'Filmed on site' })];
  if (listing.verified_at) badges.unshift(el('span', { class: 'place-card__badge place-card__badge--verified', text: 'Street Verified' }));
  if (listing.featured) badges.unshift(el('span', { class: 'place-card__badge place-card__badge--featured', text: 'Featured' }));
  if (listing.clip_count > 0) {
    badges.push(el('span', { class: 'place-card__badge' }, [icon(PLAY, 12), el('span', { text: ` Video tour · ${formatSeconds(listing.tour_seconds)}` })]));
  }
  media.append(el('div', { class: 'place-card__badges' }, badges));

  const price = listing.mode === 'rent'
    ? [el('span', { class: 'place-card__price', text: formatRands(listing.price_rands) }), el('span', { class: 'place-card__per', text: ' / month' })]
    : [el('span', { class: 'place-card__price', text: priceLine(listing) })];
  return el('a', { class: 'place-card', href: `#/place/${listing.id}` }, [
    media,
    el('div', { class: 'place-card__body' }, [
      el('p', {}, price),
      el('p', { class: 'place-card__title', text: listingTitle(listing) }),
      el('p', { class: 'place-card__where', text: publicPlace(listing) }),
      el('p', { class: 'place-card__facts', text: cardFacts(listing) }),
    ]),
  ]);
}

export async function renderExplore({ session }) {
  const { profile } = await loadViewer(session);
  let filters = loadFilters();
  let page = 0;
  let shown = 0;
  let total = 0;
  let searchRun = 0;

  const input = el('input', { id: 'search', type: 'search', class: 'search__input', autocomplete: 'off', enterkeyhint: 'search' });
  input.value = filters.text;
  const switches = Object.entries(MODES).map(([id, words]) => {
    const button = el('button', { type: 'button', class: 'segmented__option', text: words.label });
    button.addEventListener('click', () => {
      filters = saveFilters(withMode(filters, id));
      drawControls();
      search();
    });
    return { id, button };
  });

  const chipRow = el('div', { class: 'chip-row' });
  const count = el('p', { class: 'section__title', role: 'status' });
  const results = el('ul', { class: 'place-list' });
  const more = el('button', { type: 'button', class: 'button button--quiet', text: 'Show more' });
  more.hidden = true;
  const status = el('div', { class: 'explore-status' });

  function drawControls() {
    for (const { id, button } of switches) button.setAttribute('aria-pressed', String(id === filters.mode));
    input.placeholder = MODES[filters.mode].placeholder;
    const n = activeCount(filters);
    const filterButton = el('a', { href: '#/filters', class: `chip-button${n ? ' chip-button--on' : ''}` }, [icon(SLIDERS, 16), el('span', { text: n ? `Filters · ${n}` : 'Filters' })]);
    const tours = el('a', { href: '#/tours', class: 'chip-button chip-button--on' }, [icon(PLAY, 14), el('span', { text: 'Tours' })]);
    const quick = quickChips(filters).map((chip) => el('a', { href: '#/filters', class: `chip-button chip-button--quiet${chip.on ? ' chip-button--on' : ''}`, text: chip.label }));
    const onMap = el('a', { href: '#/map', class: 'chip-button chip-button--quiet' }, [icon(PIN, 16), el('span', { text: 'Map' })]);
    chipRow.replaceChildren(filterButton, tours, onMap, ...quick);
  }

  function emptyState() {
    const filtered = activeCount(filters) > 0 || filters.text.trim() !== '';
    if (filtered) {
      const clear = el('button', { type: 'button', class: 'button button--quiet', text: 'Clear search and filters' });
      clear.addEventListener('click', () => {
        filters = saveFilters({ ...defaultFilters(), mode: filters.mode });
        input.value = '';
        drawControls();
        search();
      });
      return el('div', { class: 'empty' }, [
        el('p', { class: 'empty__title', text: 'Nothing matches yet' }),
        el('p', { class: 'lead', text: 'Try fewer filters or a nearby area. New places are checked and added every day.' }),
        clear,
      ]);
    }
    const owner = canList(profile?.role);
    return el('div', { class: 'empty' }, [
      el('p', { class: 'empty__title', text: 'No places listed yet' }),
      el('p', { class: 'lead', text: owner
        ? 'Be the first: list your place with photos and a short video tour filmed at the address.'
        : 'Verified places will show here soon. Every listing is checked before it goes live, so you never pay a fake landlord.' }),
      ...(owner ? [el('a', { href: '#/list/new', class: 'button button--primary', text: 'List your place' })] : []),
      ...(session ? [] : [el('a', { href: '#/signup', class: 'button button--primary', text: 'Create a free account' })]),
    ]);
  }

  async function search({ append = false } = {}) {
    const run = ++searchRun;
    if (!append) {
      page = 0;
      shown = 0;
      results.replaceChildren();
      status.replaceChildren(el('p', { class: 'lead', text: 'Looking…' }));
      more.hidden = true;
    }
    try {
      const found = await searchListings(filters, page);
      if (run !== searchRun) return;
      if (!append) total = found.total ?? 0;
      results.append(...found.items.map((listing) => el('li', {}, [placeCard(listing, false)])));
      shown += found.items.length;
      const filtered = activeCount(filters) > 0 || filters.text.trim() !== '';
      count.textContent = total === 0 && !filtered ? '' : countLine(total, filters.mode);
      status.replaceChildren(...(total === 0 ? [emptyState()] : []));
      more.hidden = shown >= total || found.items.length === 0;
    } catch (error) {
      if (run !== searchRun) return;
      count.textContent = '';
      const retry = el('button', { type: 'button', class: 'button button--quiet', text: 'Try again' });
      retry.addEventListener('click', () => search());
      status.replaceChildren(el('p', { class: 'message message--error', text: friendlyListingError(error) }), retry);
    }
  }

  more.addEventListener('click', async () => {
    more.disabled = true;
    more.textContent = 'Loading…';
    page += 1;
    await search({ append: true });
    more.disabled = false;
    more.textContent = 'Show more';
  });

  let typing = null;
  input.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      filters = saveFilters({ ...filters, text: input.value });
      search();
    }, 400);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    clearTimeout(typing);
    filters = saveFilters({ ...filters, text: input.value });
    input.blur();
    search();
  });

  drawControls();
  search();

  const searchBox = el('label', { for: 'search', class: 'search' }, [icon(SEARCH, 20), el('span', { class: 'visually-hidden', text: 'Search' }), input]);
  const safe = el('div', { class: 'promise' }, [
    icon(SHIELD, 28),
    el('div', { class: 'stack stack--tight' }, [
      el('p', { class: 'promise__title', text: 'Street Safe' }),
      el('p', { class: 'promise__text', text: 'Every listing is checked before it goes live, with a video tour filmed at the address. Coming next: checked owners, and deposits held until you have the keys.' }),
    ]),
  ]);

  return [
    topBar({ profile, session }),
    el('div', { class: 'explore-head' }, [
      el('h1', { class: 'title', text: 'Find your place' }),
      ...(canList(profile?.role) ? [el('a', { href: '#/list/new', class: 'button button--quiet button--small', text: 'List a property' })] : []),
    ]),
    el('div', { class: 'segmented', role: 'group', 'aria-label': 'Rent or buy' }, switches.map(({ button }) => button)),
    searchBox,
    chipRow,
    count,
    results,
    status,
    more,
    safe,
    ...(session ? [tabBar('explore')] : []),
  ];
}
