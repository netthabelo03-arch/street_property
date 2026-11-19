// Step 3, and the listing's own page for its owner: everything in one view,
// what is still missing, and the button to send it for checking. Once sent,
// the same page shows its state and lets the owner stop the review or take
// the listing down.

import { loadViewer } from '../viewer.js';
import { canList } from '../roles.js';
import { getListing, listPhotos, listClips, submitListing, withdrawListing, deleteDraft } from '../listings/api.js';
import { FEATURES, STATUSES, isEditable, listingTitle, priceLine, missingForReview, tourRooms, formatSeconds, formatRands, findKind } from '../listings/rules.js';
import { friendlyListingError } from '../listings/errors.js';
import { topBar, tabBar } from '../shell.js';
import { el, messageBox, whileBusy } from '../dom.js';
import { stepHeader, statusChip, notFound, notALister } from './listing-parts.js';
import { myVerification } from '../verify/api.js';
import { badgeLine } from '../verify/rules.js';

/** A button that asks "Tap again to …" before it acts. */
function confirmButton(text, confirmText, busyText, action, className = 'button button--danger') {
  const button = el('button', { type: 'button', class: className, text });
  let armed = false;
  let timer = null;
  button.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      button.textContent = confirmText;
      timer = setTimeout(() => { armed = false; button.textContent = text; }, 5000);
      return;
    }
    clearTimeout(timer);
    armed = false;
    button.textContent = text;
    whileBusy(button, busyText, action);
  });
  return button;
}

export async function renderListSend({ session, navigate, route }) {
  const { profile } = await loadViewer(session);
  const bar = topBar({ profile, session });
  if (!canList(profile?.role)) return notALister(bar, tabBar('profile'));

  const listing = await getListing(route.id, { private: true });
  if (!listing || listing.owner_id !== session.user.id) return notFound(bar, tabBar('profile'));
  const [photos, clips, verification] = await Promise.all([listPhotos(listing.id), listClips(listing.id), myVerification(listing.id).catch(() => null)]);
  const message = messageBox();
  const editable = isEditable(listing.status);
  const missing = missingForReview({ photos, clips });

  const facts = [
    priceLine(listing),
    ...(listing.mode === 'rent' && listing.deposit_rands != null ? [`Deposit ${formatRands(listing.deposit_rands)}`] : []),
    `${findKind(listing.kind)?.label ?? ''} · ${listing.bedrooms} bed · ${listing.bathrooms} bath · ${listing.parking} parking`,
    `${listing.street}, ${listing.area}, ${listing.city}`,
  ];
  const features = FEATURES.filter((item) => listing.features.includes(item.id)).map((item) => item.label);
  const rooms = tourRooms(listing);
  const roomName = (id) => rooms.find((room) => room.id === id)?.name ?? id.replace('_', ' ');

  const photoStrip = photos.length
    ? el('ul', { class: 'photo-strip', 'aria-label': 'Photos' }, photos.map((photo, index) => {
      const image = el('img', { class: 'photo-strip__image', alt: index === 0 ? 'Cover photo' : `Photo ${index + 1}`, loading: 'lazy' });
      if (photo.url) image.src = photo.url;
      return el('li', {}, [image]);
    }))
    : el('p', { class: 'lead', text: 'No photos yet.' });

  const clipList = clips.length
    ? el('ul', { class: 'plain-list' }, clips.map((clip) => el('li', { text: `${roomName(clip.room)} · ${formatSeconds(clip.seconds)}` })))
    : el('p', { class: 'lead', text: 'No clips filmed yet.' });

  const actions = [];
  if (editable) {
    if (missing.length) {
      actions.push(el('div', { class: 'checklist' }, [
        el('p', { class: 'checklist__title', text: 'Before you can send it' }),
        el('ul', { class: 'plain-list' }, missing.map((line) => el('li', { text: line }))),
      ]));
    }
    const send = el('button', { type: 'button', class: 'button button--primary', text: listing.status === 'draft' ? 'Send for checking' : 'Send again for checking' });
    send.disabled = missing.length > 0;
    send.addEventListener('click', () => whileBusy(send, 'Sending…', async () => {
      message.clear();
      try {
        await submitListing(listing.id);
        navigate('#/my-listings');
      } catch (error) {
        message.show(friendlyListingError(error));
      }
    }));
    actions.push(message.node, send,
      el('div', { class: 'button-row' }, [
        el('a', { href: `#/list/${listing.id}`, class: 'button button--quiet', text: 'Edit details and photos' }),
        el('a', { href: `#/list/${listing.id}/tour`, class: 'button button--quiet', text: 'Film the tour' }),
      ]));
    if (listing.status === 'draft') {
      actions.push(confirmButton('Delete this draft', 'Tap again to delete it for good', 'Deleting…', async () => {
        message.clear();
        try {
          await deleteDraft(listing, photos, clips);
          navigate('#/my-listings');
        } catch (error) {
          message.show(friendlyListingError(error));
        }
      }));
    }
  } else if (listing.status === 'in_review' || listing.status === 'live') {
    const live = listing.status === 'live';
    actions.push(message.node, confirmButton(
      live ? 'Take it down' : 'Stop the review to make changes',
      live ? 'Tap again to hide it from everyone' : 'Tap again to stop the review',
      live ? 'Taking down…' : 'Stopping…',
      async () => {
        message.clear();
        try {
          await withdrawListing(listing.id);
          navigate(live ? '#/my-listings' : `#/list/${listing.id}`);
        } catch (error) {
          message.show(friendlyListingError(error));
        }
      },
      live ? 'button button--danger' : 'button button--quiet',
    ));
  }

  return [
    bar,
    ...(editable ? [stepHeader(listing.id, 'send')] : []),
    el('div', { class: 'stack stack--tight' }, [
      el('h1', { class: 'title title--medium', text: listingTitle(listing) }),
      el('div', {}, [statusChip(listing.status)]),
      el('p', { class: 'lead', text: STATUSES[listing.status].about }),
    ]),
    ...(listing.status === 'changes_needed' && listing.review_note
      ? [el('p', { class: 'message message--error', text: `We asked for changes: ${listing.review_note}` })]
      : []),
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: 'Details' }),
      el('ul', { class: 'plain-list' }, facts.map((line) => el('li', { text: line }))),
      ...(features.length ? [el('p', { class: 'lead', text: features.join(' · ') })] : []),
      ...(listing.description ? [el('p', { class: 'prose', text: listing.description })] : []),
    ]),
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: `Photos (${photos.length})` }),
      photoStrip,
    ]),
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: `Video tour (${clips.length})` }),
      clipList,
    ]),
    ...actions,
    el('a', { href: `#/list/${listing.id}/verify`, class: 'verify-link' }, [
      el('span', { class: 'verify-link__title', text: listing.verified_at ? 'Street Verified \u2713' : 'Get the Street Verified badge' }),
      el('span', { class: 'verify-link__line', text: listing.verified_at ? 'Your ID and ownership are checked.' : `${badgeLine(verification)}. Verified places get more serious enquiries.` }),
    ]),
    el('a', { href: '#/my-listings', class: 'button button--quiet', text: 'Back to my listings' }),
    tabBar('profile'),
  ];
}
