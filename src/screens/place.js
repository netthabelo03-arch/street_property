// A live listing as renters and buyers see it: photos, price, the facts,
// and the video tour room by room. (Sprint 3 adds the map and a full-screen
// tour; Sprint 4 adds Ask the owner and booking a viewing.)

import { loadViewer } from '../viewer.js';
import { getListing, listPhotos, listClips } from '../listings/api.js';
import { FEATURES, listingTitle, priceLine, formatRands, formatSeconds, tourRooms, findKind } from '../listings/rules.js';
import { publicPlace, cardFacts } from '../explore/filters.js';
import { topBar, tabBar } from '../shell.js';
import { el } from '../dom.js';

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
      el('span', { class: 'chip chip--good', text: 'Filmed on site' }),
      el('span', { class: 'chip chip--good', text: 'Checked by Street Property' }),
    ]),
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: 'The place' }),
      el('ul', { class: 'plain-list' }, facts.map((line) => el('li', { text: line }))),
      ...(features.length ? [el('ul', { class: 'feature-list' }, features.map((line) => el('li', { text: line })))] : []),
      ...(listing.description ? [el('p', { class: 'prose', text: listing.description })] : []),
    ]),
    ...(tour.length ? [el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: `Video tour · ${formatSeconds(seconds)}` }),
      el('p', { class: 'lead', text: 'Filmed at the address in the app, room by room. Each clip shows the day\'s code in its corner.' }),
      player,
      el('div', { class: 'choices', role: 'group', 'aria-label': 'Rooms' }, roomButtons),
    ])] : []),
    el('div', { class: 'note' }, [
      el('p', { class: 'checklist__title', text: 'Interested?' }),
      el('p', { text: 'Asking the owner and booking a viewing open soon. Never pay a deposit before you have seen the place and signed a lease.' }),
    ]),
    ...tabs,
  ];
}
