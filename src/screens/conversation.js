// One conversation: the place it is about, the viewing (suggest a time,
// confirm or decline, cancel), the messages, and a box to write.
// Once a viewing is confirmed the renter sees the full address, and each side
// sees the other's WhatsApp number if they chose to share it.
// New messages are checked every few seconds while the screen is open.

import { loadViewer } from '../viewer.js';
import { getEnquiry, listMessages, sendMessage, markRead, proposeViewing, respondViewing, cancelViewing, reportEnquiry } from '../enquiries/api.js';
import {
  MESSAGE_MAX, VIEWING_HOURS, checkViewingTime, todayInSouthAfrica, viewingParts, viewingStatus,
  shortTime, enquiryTitle, enquiryPrice, looksRisky, whatsappLink, showPhone,
} from '../enquiries/rules.js';
import { friendlyListingError } from '../listings/errors.js';
import { topBar, tabBar, refreshUnread } from '../shell.js';
import { el, messageBox, whileBusy } from '../dom.js';

const CHECK_EVERY_MS = 8000;

export async function renderConversation({ session, route }) {
  const { profile } = await loadViewer(session);
  const me = session.user.id;
  let item = await getEnquiry(route.id);
  if (!item) {
    return [
      topBar({ profile, session }),
      el('h1', { class: 'title', text: 'Conversation not found' }),
      el('a', { href: '#/enquiries', class: 'button button--quiet', text: 'Back to enquiries' }),
      tabBar('enquiries'),
    ];
  }
  let messages = await listMessages(item.id);
  markRead(item.id).then(refreshUnread).catch(() => {});

  const message = messageBox();
  const head = el('a', { class: 'convo-place', href: `#/place/${item.listing_id}` });
  const viewing = el('section', { class: 'viewing-panel', 'aria-label': 'Viewing' });
  const list = el('ol', { class: 'bubbles', 'aria-live': 'polite' });

  function drawHead() {
    head.replaceChildren(
      el('span', { class: 'convo-place__title', text: enquiryTitle(item) }),
      el('span', { class: 'convo-place__price', text: enquiryPrice(item) }),
      el('span', { class: 'convo-place__where', text: [item.street, item.listing_area, item.listing_city].filter(Boolean).join(', ') }),
      ...(item.listing_status !== 'live' ? [el('span', { class: 'chip chip--bad', text: 'No longer listed' })] : []),
    );
  }

  function suggestForm(label) {
    const date = el('input', { type: 'date', id: 'viewing-date', class: 'input', min: todayInSouthAfrica() });
    const time = el('input', { type: 'time', id: 'viewing-time', class: 'input', min: VIEWING_HOURS.from, max: VIEWING_HOURS.to, step: '900', value: '10:00' });
    const send = el('button', { type: 'submit', class: 'button button--primary', text: label });
    const form = el('form', { class: 'stack', novalidate: '' }, [
      el('div', { class: 'two-up' }, [
        el('div', { class: 'field' }, [el('label', { for: 'viewing-date', class: 'field__label', text: 'Day' }), date]),
        el('div', { class: 'field' }, [el('label', { for: 'viewing-time', class: 'field__label', text: 'Time' }), time]),
      ]),
      el('p', { class: 'field__hint', text: `Between ${VIEWING_HOURS.from} and ${VIEWING_HOURS.to}. The other person confirms or suggests another time.` }),
      send,
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      message.clear();
      const { startsAt, error } = checkViewingTime(date.value, time.value);
      if (error) {
        message.show(error);
        return;
      }
      whileBusy(send, 'Sending…', async () => {
        try {
          await proposeViewing(item.id, startsAt);
          await reload();
        } catch (problem) {
          message.show(friendlyListingError(problem));
        }
      });
    });
    return form;
  }

  function drawViewing() {
    const live = item.listing_status === 'live';
    const status = viewingStatus(item);
    const active = ['proposed', 'confirmed'].includes(item.viewing_status);
    const parts = [el('h2', { class: 'section__title', text: 'Viewing' })];
    if (active) {
      const when = viewingParts(item.viewing_at);
      parts.push(el('div', { class: 'viewing-when' }, [
        el('span', { class: 'date-tile' }, [el('span', { class: 'date-tile__month', text: when.month }), el('span', { class: 'date-tile__day', text: when.day })]),
        el('span', { class: 'stack stack--tight' }, [
          el('span', { class: 'viewing-row__when', text: when.when }),
          el('span', { class: `chip ${status.chip}`, text: status.text }),
        ]),
      ]));
      if (item.viewing_status === 'proposed' && !item.viewing_mine) {
        const yes = el('button', { type: 'button', class: 'button button--primary', text: 'Confirm this time' });
        const no = el('button', { type: 'button', class: 'button button--quiet', text: 'This time does not work' });
        yes.addEventListener('click', () => answer(yes, true));
        no.addEventListener('click', () => answer(no, false));
        parts.push(el('div', { class: 'button-row' }, [yes, no]));
      }
      if (item.viewing_status === 'confirmed') {
        parts.push(el('p', { class: 'field__hint', text: item.my_side === 'renter'
          ? `Address: ${item.street}, ${item.listing_area}, ${item.listing_city}`
          : 'The renter can now see the full address.' }));
        if (item.other_whatsapp) {
          const text = `Hi ${item.other_name}, it's about the viewing of the ${enquiryTitle(item).toLowerCase()} on Street Property.`;
          parts.push(el('a', { class: 'button button--whatsapp', href: whatsappLink(item.other_whatsapp, text), target: '_blank', rel: 'noopener noreferrer', text: `WhatsApp ${item.other_name} (${showPhone(item.other_whatsapp)})` }));
        }
      }
      const cancel = el('button', { type: 'button', class: 'text-button', text: item.viewing_status === 'confirmed' ? 'Cancel the viewing' : 'Withdraw this time' });
      cancel.addEventListener('click', () => whileBusy(cancel, 'Cancelling…', async () => {
        message.clear();
        try {
          await cancelViewing(item.viewing_id);
          await reload();
        } catch (problem) {
          message.show(friendlyListingError(problem));
        }
      }));
      const other = el('details', { class: 'suggest-other' }, [el('summary', { text: 'Suggest a different time' }), suggestForm('Suggest this time instead')]);
      parts.push(...(live ? [other] : []), cancel);
    } else if (live) {
      if (status) parts.push(el('p', { class: 'field__hint', text: item.viewing_status === 'declined' ? 'The last suggested time did not work.' : 'The last viewing was cancelled.' }));
      parts.push(suggestForm('Suggest this time'));
    } else {
      parts.push(el('p', { class: 'field__hint', text: 'This place is no longer listed, so no new viewings can be booked.' }));
    }
    viewing.replaceChildren(...parts);
  }

  async function answer(button, accept) {
    await whileBusy(button, accept ? 'Confirming…' : 'Sending…', async () => {
      message.clear();
      try {
        await respondViewing(item.viewing_id, accept);
        await reload();
      } catch (problem) {
        message.show(friendlyListingError(problem));
      }
    });
  }

  function drawMessages() {
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
    list.replaceChildren(...messages.map((m) => {
      if (m.kind === 'system') return el('li', { class: 'bubble bubble--note', text: m.body });
      const mine = m.sender_id === me;
      const parts = [el('p', { class: 'bubble__text', text: m.body }), el('span', { class: 'bubble__time', text: shortTime(m.created_at) })];
      if (!mine && looksRisky(m.body)) {
        parts.push(el('p', { class: 'bubble__warning', text: 'Careful: never pay a deposit or rent, or share bank details, before you have viewed the place and signed a lease.' }));
      }
      return el('li', { class: `bubble ${mine ? 'bubble--mine' : 'bubble--theirs'}` }, parts);
    }));
    if (nearBottom) list.lastElementChild?.scrollIntoView({ block: 'end' });
  }

  async function reload() {
    const [fresh, freshMessages] = await Promise.all([getEnquiry(item.id), listMessages(item.id)]);
    if (fresh) item = fresh;
    const changed = freshMessages.length !== messages.length;
    messages = freshMessages;
    drawHead();
    drawViewing();
    if (changed) {
      drawMessages();
      markRead(item.id).then(refreshUnread).catch(() => {});
    }
  }

  // Writing
  const box = el('textarea', { id: 'message', class: 'input input--area composer__input', rows: '2', maxlength: String(MESSAGE_MAX), placeholder: 'Write a message' });
  const send = el('button', { type: 'submit', class: 'button button--primary composer__send', text: 'Send' });
  const composer = el('form', { class: 'composer', novalidate: '' }, [el('label', { for: 'message', class: 'visually-hidden', text: 'Message' }), box, send]);
  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = box.value.trim();
    if (!text) return;
    message.clear();
    whileBusy(send, 'Sending…', async () => {
      try {
        await sendMessage(item.id, text);
        box.value = '';
        messages = await listMessages(item.id);
        drawMessages();
        list.lastElementChild?.scrollIntoView({ block: 'end' });
      } catch (problem) {
        message.show(friendlyListingError(problem));
      }
    });
  });

  // Report
  const reason = el('textarea', { id: 'report-reason', class: 'input input--area', rows: '3', maxlength: '500' });
  const reportSend = el('button', { type: 'button', class: 'button button--danger', text: 'Send report' });
  const reportMessage = messageBox();
  reportSend.addEventListener('click', () => whileBusy(reportSend, 'Sending…', async () => {
    reportMessage.clear();
    try {
      await reportEnquiry(item.id, reason.value);
      reason.value = '';
      reportMessage.show('Thank you. We will look at this conversation.', 'success');
    } catch (problem) {
      reportMessage.show(friendlyListingError(problem));
    }
  }));
  const report = el('details', { class: 'suggest-other' }, [
    el('summary', { text: 'Report this conversation' }),
    el('div', { class: 'stack' }, [
      el('label', { for: 'report-reason', class: 'field__label', text: 'What went wrong? (for example, asked for money before a viewing)' }),
      reason,
      reportMessage.node,
      reportSend,
    ]),
  ]);

  // Keep up to date while the screen is open and the phone is awake.
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible' && list.isConnected) reload().catch(() => {});
  }, CHECK_EVERY_MS);
  const onHash = () => setTimeout(() => {
    if (list.isConnected) return;
    clearInterval(timer);
    window.removeEventListener('hashchange', onHash);
  }, 0);
  window.addEventListener('hashchange', onHash);

  drawHead();
  drawViewing();
  drawMessages();
  setTimeout(() => list.lastElementChild?.scrollIntoView({ block: 'end' }), 50);

  return [
    topBar({ profile, session }),
    el('a', { href: '#/enquiries', class: 'text-link', text: '← Enquiries' }),
    el('div', { class: 'stack stack--tight' }, [
      el('h1', { class: 'title title--medium', text: item.other_name }),
      el('p', { class: 'lead', text: item.my_side === 'renter' ? (item.listing_status === 'live' ? 'You asked about this place' : 'You asked about this place, which is no longer listed') : 'Asking about your place' }),
    ]),
    head,
    viewing,
    message.node,
    el('h2', { class: 'section__title', text: 'Messages' }),
    list,
    composer,
    report,
    tabBar('enquiries'),
  ];
}
