// Enquiries: viewings coming up, and every conversation (as a renter or buyer
// asking about a place, or as an owner or agent being asked).

import { loadViewer } from '../viewer.js';
import { listEnquiries } from '../enquiries/api.js';
import { upcomingViewings, viewingParts, viewingStatus, shortTime, initials, enquiryTitle } from '../enquiries/rules.js';
import { topBar, tabBar } from '../shell.js';
import { el } from '../dom.js';

let lastTab = null;

function viewingRow(item) {
  const parts = viewingParts(item.viewing_at);
  const status = viewingStatus(item);
  return el('a', { class: 'viewing-row', href: `#/enquiries/${item.id}` }, [
    el('span', { class: 'date-tile' }, [
      el('span', { class: 'date-tile__month', text: parts.month }),
      el('span', { class: 'date-tile__day', text: parts.day }),
    ]),
    el('span', { class: 'viewing-row__text' }, [
      el('span', { class: 'viewing-row__title', text: enquiryTitle(item) }),
      el('span', { class: 'viewing-row__where', text: [item.street, item.listing_area].filter(Boolean).join(', ') }),
      el('span', { class: 'viewing-row__when', text: parts.when }),
      ...(status ? [el('span', { class: `chip ${status.chip}`, text: status.text })] : []),
    ]),
  ]);
}

function messageRow(item) {
  const side = item.my_side === 'renter' ? (item.listing_status === 'live' ? 'You asked' : 'No longer listed') : 'Asking you';
  const preview = item.last_body ? `${item.last_from_me ? 'You: ' : ''}${item.last_body}` : '';
  return el('a', { class: `message-row${item.unread ? ' message-row--unread' : ''}`, href: `#/enquiries/${item.id}` }, [
    el('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(item.other_name) }),
    el('span', { class: 'message-row__text' }, [
      el('span', { class: 'message-row__top' }, [
        el('span', { class: 'message-row__name', text: `${item.other_name} · ${side}` }),
        el('span', { class: 'message-row__time', text: shortTime(item.last_message_at) }),
      ]),
      el('span', { class: 'message-row__listing', text: enquiryTitle(item) }),
      el('span', { class: `message-row__preview${item.last_kind === 'system' ? ' message-row__preview--note' : ''}`, text: preview }),
    ]),
    ...(item.unread ? [el('span', { class: 'unread-count', 'aria-label': `${item.unread} unread`, text: String(item.unread) })] : []),
  ]);
}

export async function renderEnquiries({ session }) {
  const { profile } = await loadViewer(session);
  const items = await listEnquiries();
  const viewings = upcomingViewings(items);
  let tab = lastTab ?? (viewings.length ? 'viewings' : 'messages');

  const body = el('div', { class: 'stack' });
  const switches = [['viewings', `Viewings${viewings.length ? ` · ${viewings.length}` : ''}`], ['messages', 'Messages']].map(([id, label]) => {
    const button = el('button', { type: 'button', class: 'segmented__option', text: label });
    button.addEventListener('click', () => { tab = id; lastTab = id; draw(); });
    return { id, button };
  });

  function draw() {
    for (const { id, button } of switches) button.setAttribute('aria-pressed', String(id === tab));
    if (tab === 'viewings') {
      body.replaceChildren(...(viewings.length
        ? [el('ul', { class: 'row-list' }, viewings.map((item) => el('li', {}, [viewingRow(item)])))]
        : [el('div', { class: 'empty' }, [
          el('p', { class: 'empty__title', text: 'No viewings yet' }),
          el('p', { class: 'lead', text: 'Ask about a place, then suggest a time in the conversation. Viewings show here once suggested.' }),
          el('a', { href: '#/', class: 'button button--quiet', text: 'Find a place' }),
        ])]));
    } else {
      body.replaceChildren(...(items.length
        ? [el('ul', { class: 'row-list' }, items.map((item) => el('li', {}, [messageRow(item)])))]
        : [el('div', { class: 'empty' }, [
          el('p', { class: 'empty__title', text: 'No messages yet' }),
          el('p', { class: 'lead', text: 'Open a place and tap Ask the owner. Owners and agents see the questions about their places here.' }),
          el('a', { href: '#/', class: 'button button--quiet', text: 'Find a place' }),
        ])]));
    }
  }
  draw();

  return [
    topBar({ profile, session }),
    el('h1', { class: 'title', text: 'Enquiries' }),
    el('div', { class: 'segmented', role: 'group', 'aria-label': 'Viewings or messages' }, switches.map(({ button }) => button)),
    body,
    el('p', { class: 'note', text: 'Never pay a deposit or rent before you have viewed the place and signed a lease. Street Property will never ask you to pay into a personal account.' }),
    tabBar('enquiries'),
  ];
}
