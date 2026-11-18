// My listings: every place the owner or agent has started, with its state.

import { loadViewer } from '../viewer.js';
import { canList } from '../roles.js';
import { myListings } from '../listings/api.js';
import { STATUSES } from '../listings/rules.js';
import { topBar, tabBar } from '../shell.js';
import { el } from '../dom.js';
import { listingSummary, notALister } from './listing-parts.js';

export async function renderMyListings({ session }) {
  const { profile } = await loadViewer(session);
  const bar = topBar({ profile, session });
  if (!canList(profile?.role)) return notALister(bar, tabBar('profile'));

  const listings = await myListings(session.user.id);
  const add = el('a', { href: '#/list/new', class: 'button button--primary', text: 'List a property' });

  const content = listings.length === 0
    ? [el('div', { class: 'empty' }, [
      el('p', { class: 'empty__title', text: 'No listings yet' }),
      el('p', { class: 'lead', text: 'Add the details and photos, film a short video tour at the place, and send it to us. We check every listing before it goes live.' }),
      add,
    ])]
    : [
      add,
      el('ul', { class: 'listing-list' }, listings.map((listing) => el('li', {}, [
        listingSummary(listing, {
          href: `#/list/${listing.id}/send`,
          extra: [el('p', { class: 'listing-row__about', text: listing.status === 'changes_needed' && listing.review_note
            ? `We asked: ${listing.review_note}`
            : STATUSES[listing.status]?.about ?? '' })],
        }),
      ]))),
    ];

  return [bar, el('h1', { class: 'title', text: 'My listings' }), ...content, tabBar('profile')];
}
