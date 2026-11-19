// A live listing as renters and buyers see it: photos, price, the facts,
// the video tour (room by room, or full screen) and the area on a map.
// Signed-in visitors can ask the owner (or agent) and then book a viewing.

import { loadViewer } from '../viewer.js';
import { getListing, listPhotos, listClips } from '../listings/api.js';
import { FEATURES, listingTitle, priceLine, formatRands, formatSeconds, tourRooms, findKind } from '../listings/rules.js';
import { publicPlace, cardFacts } from '../explore/filters.js';
import { loadLeaflet, makeMap } from '../map/leaflet.js';
import { openTour } from './tourplayer.js';
import { startEnquiry, myEnquiryFor } from '../enquiries/api.js';
import { firstMessage, MESSAGE_MAX } from '../enquiries/rules.js';
import { friendlyListingError } from '../listings/errors.js';
import { saveNext } from '../next.js';
import { savedIds, saveListing, unsaveListing } from '../saved/api.js';
import { topBar, tabBar } from '../shell.js';
import { el, messageBox, whileBusy } from '../dom.js';

export async function renderPlace({ session, route }) {
  const { profile } = await loadViewer(session);
  const bar = topBar({ profile, session });
  const tabs = session ? [tabBar('explore')] : [];
  const listing = await getListing(route.id);
  const mine = listing && session && listing.owner_id === session.user.id;

  if (!listing || (listing.status !== 'live' && !mine)) {
    return [
      bar,
      el('h1', { class: 'title', text: 'This place is not listed' }),
      el('p', { class: 'lead', text: 'It may have been let or sold, or the owner took it down.' }),
      el('a', { href: '#/', class: 'button button--primary', text: 'Back to Explore' }),
      ...tabs,
    ];
  }

  const [photos, clips] = await Promise.all([listPhotos(listing.id), listClips(listing.id)]);
  const rooms = tourRooms(listing);
  const roomName = (id) => rooms.find((room) => room.id === id)?.name ?? id.replace('_', ' ');
  const order = (clip) => {
    const index = rooms.findIndex((room) => room.id === clip.room);
    return index === -1 ? 99 : index;
  };
  const tour = [...clips].sort((a, b) => order(a) - order(b));
  const seconds = tour.reduce((sum, clip) => sum + Number(clip.seconds), 0);

  const gallery = el('ul', { class: 'gallery', 'aria-label': `Photos, ${photos.length}` }, photos.map((photo, index) => {
    const image = el('img', { class: 'gallery__image', alt: `Photo ${index + 1} of ${photos.length}`, loading: index === 0 ? 'eager' : 'lazy' });
    if (photo.url) image.src = photo.url;
    return el('li', { class: 'gallery__item' }, [image, el('span', { class: 'gallery__count', text: `${index + 1} / ${photos.length}` })]);
  }));

  // The tour: one player, and a button per room to jump between clips.
  const player = el('video', { class: 'tour-player', controls: '', playsinline: '', preload: 'metadata' });
  const roomButtons = tour.map((clip, index) => {
    const button = el('button', { type: 'button', class: 'choice', text: `${roomName(clip.room)} · ${formatSeconds(clip.seconds)}` });
    button.addEventListener('click', () => play(index, true));
    return button;
  });
  let playing = 0;
  function play(index, start) {
    playing = index;
    const clip = tour[index];
    if (clip?.url) player.src = clip.url;
    roomButtons.forEach((button, n) => button.setAttribute('aria-pressed', String(n === index)));
    if (start) player.play().catch(() => {});
  }
  // When a room ends, the next one starts, so the tour plays as one walk-through.
  player.addEventListener('ended', () => {
    if (playing + 1 < tour.length) play(playing + 1, true);
  });
  if (tour.length) play(0, false);
  const fullScreen = el('button', { type: 'button', class: 'button button--primary', text: `Watch the tour full screen · ${formatSeconds(seconds)}` });
  fullScreen.addEventListener('click', () => {
    player.pause();
    openTour({ clips: tour, roomName, title: listingTitle(listing), start: playing });
  });

  // The area: a circle about 250 m across around the rounded spot, never a pin on the house.
  let area = [];
  if (listing.approx_lat != null && listing.approx_lng != null) {
    const holder = el('div', { class: 'map map--small', role: 'img', 'aria-label': `Map of the area around ${listing.area}` });
    const caption = el('p', { class: 'field__hint', text: `Somewhere in this circle in ${listing.area}. The exact address is not shown publicly.` });
    area = [el('section', { class: 'section' }, [el('h2', { class: 'section__title', text: 'The area' }), holder, caption])];
    setTimeout(async () => {
      try {
        const L = await loadLeaflet();
        if (!holder.isConnected) return;
        const centre = [listing.approx_lat, listing.approx_lng];
        const map = makeMap(L, holder, { scrollWheelZoom: false, dragging: !L.Browser.mobile, tap: false }).setView(centre, 15);
        L.circle(centre, { radius: 250, color: '#5CCFB7', weight: 2, fillColor: '#157F6A', fillOpacity: 0.25 }).addTo(map);
      } catch {
        caption.textContent = `In ${listing.area}, ${listing.city}. The map could not load.`;
      }
    }, 0);
  }

  const features = FEATURES.filter((item) => listing.features.includes(item.id)).map((item) => item.label);
  const facts = [
    `${findKind(listing.kind)?.label ?? ''} · ${cardFacts({ ...listing, features: [] })}`,
    ...(listing.mode === 'rent' && listing.deposit_rands != null ? [`Deposit ${formatRands(listing.deposit_rands)}`] : []),
    ...(listing.mode === 'rent' && listing.available_from ? [`Available from ${new Date(`${listing.available_from}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}`] : []),
    listing.lister === 'agent' ? 'Listed by an agent' : 'Listed by the owner',
  ];

  return [
    bar,
    el('a', { href: '#/', class: 'text-link', text: '← Explore' }),
    ...(mine ? [el('p', { class: 'note' }, [el('span', { text: 'This is your listing. ' }), el('a', { href: `#/list/${listing.id}/send`, text: 'Manage it' })])] : []),
    ...(photos.length ? [gallery] : []),
    el('div', { class: 'stack stack--tight' }, [
      el('p', { class: 'place-price', text: priceLine(listing) }),
      el('h1', { class: 'title title--medium', text: listingTitle(listing) }),
      el('p', { class: 'lead', text: publicPlace(listing) }),
    ]),
    el('div', { class: 'badge-row' }, [
      ...(listing.verified_at ? [el('span', { class: 'chip chip--verified', text: 'Street Verified' })] : []),
      el('span', { class: 'chip chip--good', text: 'Filmed on site' }),
      el('span', { class: 'chip chip--good', text: 'Checked by Street Property' }),
    ]),
    ...(listing.verified_at ? [el('p', { class: 'field__hint', text: `Street Verified: we checked the ${listing.lister === 'agent' ? 'agent\u2019s ID, Fidelity Fund Certificate and the owner\u2019s mandate' : 'owner\u2019s ID and that they own this place'}.` })] : []),
    ...(mine ? [] : [await heartButton({ session, listing })]),
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: 'The place' }),
      el('ul', { class: 'plain-list' }, facts.map((line) => el('li', { text: line }))),
      ...(features.length ? [el('ul', { class: 'feature-list' }, features.map((line) => el('li', { text: line })))] : []),
      ...(listing.description ? [el('p', { class: 'prose', text: listing.description })] : []),
    ]),
    ...(tour.length ? [el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: `Video tour · ${formatSeconds(seconds)}` }),
      el('p', { class: 'lead', text: 'Filmed at the address in the app, room by room. Each clip shows the day\'s code in its corner.' }),
      fullScreen,
      player,
      el('div', { class: 'choices', role: 'group', 'aria-label': 'Rooms' }, roomButtons),
    ])] : []),
    ...area,
    ...(await askSection({ session, listing, mine })),
    ...tabs,
  ];
}

/** "Ask the owner": a first message, or the way back to the conversation already started. */
async function askSection({ session, listing, mine }) {
  if (mine) return [];
  const who = listing.lister === 'agent' ? 'the agent' : 'the owner';
  const safety = el('p', { class: 'field__hint', text: 'Never pay a deposit or rent before you have viewed the place and signed a lease.' });
  const heading = el('h2', { class: 'section__title', text: `Interested? Ask ${who}` });
  if (!session) {
    const login = el('a', { href: '#/signin', class: 'button button--primary', text: `Log in to ask ${who}` });
    login.addEventListener('click', () => saveNext(`#/place/${listing.id}`));
    return [el('section', { class: 'section ask' }, [heading, el('p', { class: 'lead', text: 'Ask questions and book a viewing in the app. Your number stays private until you choose to share it.' }), login, safety])];
  }
  let existing = null;
  try {
    existing = await myEnquiryFor(listing.id, session.user.id);
  } catch {
    existing = null;
  }
  if (existing) {
    return [el('section', { class: 'section ask' }, [
      heading,
      el('a', { href: `#/enquiries/${existing}`, class: 'button button--primary', text: 'Open your conversation' }),
      safety,
    ])];
  }
  const box = el('textarea', { id: 'ask', class: 'input input--area', rows: '3', maxlength: String(MESSAGE_MAX) });
  box.value = firstMessage(listing.mode);
  const send = el('button', { type: 'submit', class: 'button button--primary', text: `Send to ${who}` });
  const problem = messageBox();
  const form = el('form', { class: 'stack', novalidate: '' }, [
    el('label', { for: 'ask', class: 'field__label', text: 'Your message' }),
    box,
    problem.node,
    send,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    problem.clear();
    whileBusy(send, 'Sending…', async () => {
      try {
        const id = await startEnquiry(listing.id, box.value);
        window.location.hash = `#/enquiries/${id}`;
      } catch (error) {
        problem.show(friendlyListingError(error));
      }
    });
  });
  return [el('section', { class: 'section ask' }, [heading, form, el('p', { class: 'field__hint', text: 'You can suggest a viewing time in the conversation. Your number stays private until you choose to share it.' }), safety])];
}

/** Save / Saved, the same heart as in the tour feed. */
async function heartButton({ session, listing }) {
  const button = el('button', { type: 'button', class: 'button button--quiet heart-button' });
  let on = false;
  if (session) {
    try {
      on = (await savedIds(session.user.id)).has(listing.id);
    } catch {
      on = false;
    }
  }
  const draw = () => {
    button.textContent = on ? '♥ Saved' : '♡ Save this place';
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('heart-button--on', on);
  };
  draw();
  button.addEventListener('click', async () => {
    if (!session) {
      saveNext(`#/place/${listing.id}`);
      window.location.hash = '#/signin';
      return;
    }
    const was = on;
    on = !on;
    draw();
    try {
      if (was) await unsaveListing(listing.id, session.user.id);
      else await saveListing(listing.id);
    } catch (error) {
      on = was;
      draw();
      button.textContent = friendlyListingError(error);
    }
  });
  return button;
}
