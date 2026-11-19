// Saved: places the person hearted, newest first. Places that are no longer
// listed stay in the list, marked, until removed.

import { loadViewer } from '../viewer.js';
import { mySaved, unsaveListing } from '../saved/api.js';
import { friendlyListingError } from '../listings/errors.js';
import { topBar, tabBar } from '../shell.js';
import { el, whileBusy } from '../dom.js';
import { placeCard } from './explore.js';

export async function renderSaved({ session }) {
  const { profile } = await loadViewer(session);
  const items = await mySaved();
  const list = el('ul', { class: 'place-list' });
  const count = el('p', { class: 'lead', role: 'status' });

  function drawCount() {
    const live = items.filter((item) => item.live).length;
    count.textContent = items.length === 0 ? '' : `${live} place${live === 1 ? '' : 's'} saved${items.length > live ? `, ${items.length - live} no longer listed` : ''}`;
  }

  function row(item) {
    const remove = el('button', { type: 'button', class: 'text-button', text: 'Remove from saved' });
    const li = el('li', { class: 'stack stack--tight' });
    remove.addEventListener('click', () => whileBusy(remove, 'Removing…', async () => {
      try {
        await unsaveListing(item.id, session.user.id);
        items.splice(items.indexOf(item), 1);
        li.remove();
        drawCount();
        if (items.length === 0) list.replaceWith(emptyState());
      } catch (error) {
        remove.textContent = friendlyListingError(error);
      }
    }));
    if (item.live) {
      li.append(placeCard(item, false), remove);
    } else {
      li.append(el('div', { class: 'listing-row' }, [
        el('p', { class: 'listing-row__title', text: 'No longer listed' }),
        el('p', { class: 'listing-row__about', text: 'The owner let it, sold it or took it down.' }),
      ]), remove);
    }
    return li;
  }

  function emptyState() {
    return el('div', { class: 'empty' }, [
      el('p', { class: 'empty__title', text: 'Nothing saved yet' }),
      el('p', { class: 'lead', text: 'Tap the heart in the tour feed or on a place to keep it here.' }),
      el('a', { href: '#/tours', class: 'button button--primary', text: 'Watch tours' }),
    ]);
  }

  drawCount();
  list.append(...items.map(row));
  return [
    topBar({ profile, session }),
    el('h1', { class: 'title', text: 'Saved' }),
    count,
    items.length ? list : emptyState(),
    tabBar('saved'),
  ];
}
