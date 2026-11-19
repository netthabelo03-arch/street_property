// For admins: the queue of listings waiting to be checked, and the check of
// one listing (photos, every clip with its code, time and place), ending in
// Approve or Ask for changes.

import { loadViewer } from '../viewer.js';
import { reviewQueue, getListing, listPhotos, listClips, reviewListing } from '../listings/api.js';
import { FEATURES, listingTitle, priceLine, tourRooms, formatSeconds, formatRands, findKind, clipDistances, missingForReview, formatDistance } from '../listings/rules.js';
import { friendlyListingError } from '../listings/errors.js';
import { topBar, tabBar } from '../shell.js';
import { el, messageBox, whileBusy } from '../dom.js';
import { listingSummary, statusChip } from './listing-parts.js';

function when(iso) {
  return new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

function adminsOnly(bar) {
  return [
    bar,
    el('h1', { class: 'title', text: 'Review queue' }),
    el('p', { class: 'lead', text: 'Only Street Property admins can check listings.' }),
    el('a', { href: '#/', class: 'button button--quiet', text: 'Back to Explore' }),
    tabBar('profile'),
  ];
}

export async function renderReviewQueue({ session }) {
  const { profile, admin } = await loadViewer(session);
  const bar = topBar({ profile, session });
  if (!admin) return adminsOnly(bar);
  const waiting = await reviewQueue();
  return [
    bar,
    el('h1', { class: 'title', text: 'Review queue' }),
    el('p', { class: 'lead', text: waiting.length === 0 ? 'Nothing waiting. New listings show here when owners send them.' : `${waiting.length} waiting, oldest first.` }),
    el('ul', { class: 'listing-list' }, waiting.map((listing) => el('li', {}, [
      listingSummary(listing, {
        href: `#/review/${listing.id}`,
        extra: [el('p', { class: 'listing-row__about', text: `Sent ${when(listing.submitted_at)} by ${listing.lister === 'agent' ? 'an agent' : 'the owner'}` })],
      }),
    ]))),
    tabBar('profile'),
  ];
}

export async function renderReviewListing({ session, navigate, route }) {
  const { profile, admin } = await loadViewer(session);
  const bar = topBar({ profile, session });
  if (!admin) return adminsOnly(bar);

  const listing = await getListing(route.id, { private: true });
  if (!listing) {
    return [bar, el('h1', { class: 'title', text: 'Listing not found' }), el('a', { href: '#/review', class: 'button button--quiet', text: 'Back to the queue' }), tabBar('profile')];
  }
  const [photos, clips] = await Promise.all([listPhotos(listing.id), listClips(listing.id, { places: true })]);
  const rooms = tourRooms(listing);
  const roomName = (id) => rooms.find((room) => room.id === id)?.name ?? id.replace('_', ' ');
  const distances = clipDistances(clips);
  const outside = clips.find((clip) => clip.room === 'outside');
  const message = messageBox();

  const details = el('ul', { class: 'plain-list' }, [
    priceLine(listing),
    ...(listing.mode === 'rent' && listing.deposit_rands != null ? [`Deposit ${formatRands(listing.deposit_rands)}`] : []),
    `${findKind(listing.kind)?.label ?? ''} · ${listing.bedrooms} bed · ${listing.bathrooms} bath · ${listing.parking} parking`,
    `${listing.street}, ${listing.area}, ${listing.city}`,
    `Listed by ${listing.lister === 'agent' ? 'an agent' : 'the owner'}`,
    ...(listing.available_from ? [`Available from ${listing.available_from}`] : []),
  ].map((line) => el('li', { text: line })));
  const features = FEATURES.filter((item) => listing.features.includes(item.id)).map((item) => item.label);

  const photoList = el('ul', { class: 'review-photos' }, photos.map((photo, index) => {
    const image = el('img', { class: 'review-photos__image', alt: `Photo ${index + 1}`, loading: 'lazy' });
    if (photo.url) image.src = photo.url;
    return el('li', {}, [image]);
  }));

  const clipCards = clips.map((clip) => {
    const distance = distances.find((item) => item.room === clip.room);
    const player = el('video', { class: 'review-clip__player', controls: '', playsinline: '', preload: 'metadata' });
    if (clip.url) player.src = clip.url;
    const place = clip.room === 'outside'
      ? 'Where the tour starts'
      : distance?.metres == null ? 'No outside clip to compare with' : `${formatDistance(distance.metres)} from the outside clip`;
    return el('li', { class: `review-clip${distance?.far ? ' review-clip--far' : ''}` }, [
      el('p', { class: 'review-clip__title', text: `${roomName(clip.room)} · ${formatSeconds(clip.seconds)}` }),
      player,
      el('p', { class: 'review-clip__facts', text: `Code ${clip.code} · filmed ${when(clip.recorded_at)} · location within ${Math.round(clip.accuracy_m ?? 0)} m` }),
      el('p', { class: distance?.far ? 'review-clip__warning' : 'review-clip__facts', text: distance?.far ? `Far away: ${place}. Check this clip.` : place }),
    ]);
  });

  const mapLink = outside
    ? el('a', { class: 'button button--quiet', href: `https://www.google.com/maps?q=${outside.lat},${outside.lng}`, target: '_blank', rel: 'noopener noreferrer', text: 'Open the filmed spot in Google Maps' })
    : null;

  const note = el('textarea', { id: 'review-note', class: 'input input--area', rows: '3', maxlength: '500' });
  const approve = el('button', { type: 'button', class: 'button button--primary', text: 'Approve: put it live' });
  const changes = el('button', { type: 'button', class: 'button button--danger', text: 'Ask for changes' });
  const missing = missingForReview({ photos, clips });

  async function decide(button, busyText, ok) {
    message.clear();
    if (!ok && note.value.trim().length < 5) {
      message.show('Say what the owner needs to change, so they can fix it.');
      note.focus();
      return;
    }
    await whileBusy(button, busyText, async () => {
      try {
        await reviewListing(listing.id, ok, note.value.trim());
        navigate('#/review');
      } catch (error) {
        message.show(friendlyListingError(error));
      }
    });
  }
  approve.addEventListener('click', () => decide(approve, 'Approving…', true));
  changes.addEventListener('click', () => decide(changes, 'Sending…', false));

  const waiting = listing.status === 'in_review';
  return [
    bar,
    el('a', { href: '#/review', class: 'text-link', text: '← Review queue' }),
    el('div', { class: 'stack stack--tight' }, [
      el('h1', { class: 'title title--medium', text: listingTitle(listing) }),
      el('div', {}, [statusChip(listing.status)]),
      ...(listing.submitted_at ? [el('p', { class: 'lead', text: `Sent ${when(listing.submitted_at)}` })] : []),
    ]),
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: 'Details' }),
      details,
      ...(features.length ? [el('p', { class: 'lead', text: features.join(' · ') })] : []),
      ...(listing.description ? [el('p', { class: 'prose', text: listing.description })] : []),
    ]),
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: `Photos (${photos.length})` }),
      photoList,
    ]),
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: `Video tour (${clips.length})` }),
      el('p', { class: 'lead', text: 'Check each clip shows its code in the corner, is the same place as the photos, and was filmed at the address.' }),
      ...(mapLink ? [mapLink] : []),
      el('ul', { class: 'review-clips' }, clipCards),
    ]),
    ...(waiting ? [
      el('section', { class: 'section' }, [
        el('h2', { class: 'section__title', text: 'Your decision' }),
        el('ul', { class: 'plain-list' }, [
          'The photos and the video show the same place.',
          'Every clip shows its code in the corner.',
          'The filmed spot matches the street address.',
          'No faces, ID documents or other private details are shown.',
          'The price and details look real for the area.',
        ].map((line) => el('li', { text: line }))),
        ...(missing.length ? [el('p', { class: 'message message--error', text: `Not complete: ${missing.join(' ')}` })] : []),
        el('div', { class: 'field' }, [
          el('label', { for: 'review-note', class: 'field__label', text: 'Note to the owner (needed when asking for changes)' }),
          note,
        ]),
        message.node,
        approve,
        changes,
      ]),
    ] : [el('p', { class: 'lead', text: 'This listing is not waiting for review.' })]),
    tabBar('profile'),
  ];
}
