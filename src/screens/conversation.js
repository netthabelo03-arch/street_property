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
import { renterCheckFor, myRenterCheck, shareRenterCheck, stopSharing } from '../renter/api.js';
import { coverLine, checkShare, LEASE_CHOICES, HOUSEHOLD_MAX } from '../renter/rules.js';
import { dealFor, metState, markMet } from '../deals/api.js';
import { currentPosition } from '../media/recorder.js';
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
  const renter = el('section', { class: 'renter-panel', 'aria-label': 'Renter check' });

  // The Street Safe deal that starts when the owner says yes.
  async function dealLink() {
    let deal = null;
    try {
      deal = await dealFor(item.id);
    } catch {
      deal = null;
    }
    if (!deal) return [];
    const lines = {
      agreeing: item.my_side === 'owner' ? 'Next: fill in the lease.' : 'Next: the owner fills in the lease.',
      signing: 'The lease is ready to sign.',
      signed: 'Next: the move-in check together.',
      moved_in: 'Keys handed over.',
      cancelled: 'This deal was called off.',
    };
    return [el('a', { class: 'deal-link', href: `#/deals/${deal.id}` }, [
      el('span', { class: 'deal-link__title', text: 'Street Safe deal →' }),
      el('span', { class: 'deal-link__line', text: lines[deal.status] ?? '' }),
    ])];
  }

  // "We met": both tap it at the address during a confirmed viewing.
  async function metPanel() {
    if (item.viewing_status !== 'confirmed' || !item.viewing_id) return [];
    const startsAt = new Date(item.viewing_at).getTime();
    const now = Date.now();
    if (now < startsAt - 30 * 60000 || now > startsAt + 7 * 86400000) return [];
    let met = null;
    try {
      met = await metState(item.viewing_id);
    } catch {
      met = null;
    }
    const mine = item.my_side === 'renter' ? met?.met_renter_at : met?.met_owner_at;
    const theirs = item.my_side === 'renter' ? met?.met_owner_at : met?.met_renter_at;
    if (mine && theirs) return [el('p', { class: 'message message--success', text: 'You both confirmed you met at the place.' })];
    if (mine) return [el('p', { class: 'field__hint', text: `You tapped "We met". Waiting for ${item.other_name}.` })];
    const tap = el('button', { type: 'button', class: 'button button--primary', text: 'We met' });
    tap.addEventListener('click', () => whileBusy(tap, 'Checking where you are…', async () => {
      message.clear();
      try {
        const spot = await currentPosition();
        await markMet(item.viewing_id, spot);
        await reload();
      } catch (problem) {
        message.show(friendlyListingError(problem));
      }
    }));
    return [tap, el('p', { class: 'field__hint', text: 'At the viewing, both of you tap this. It uses your location once to show you met at the place.' })];
  }

  // The renter check: the renter shares it here; the owner opens it from here.
  async function drawRenter() {
    let check = null;
    try {
      check = await renterCheckFor(item.id);
    } catch {
      check = null;
    }
    const title = el('h2', { class: 'section__title', text: 'Renter check' });
    if (item.my_side === 'owner') {
      if (!check) {
        renter.replaceChildren(title, el('p', { class: 'field__hint', text: `${item.other_name} has not shared a renter check. You can ask them to: it shows their ID is checked and how many times their pay covers your rent.` }));
        return;
      }
      if (check.owner_decision === 'accepted') {
        renter.replaceChildren(title, el('p', { class: 'message message--success', text: `You said yes to ${item.other_name}.` }), ...(await dealLink()), el('a', { href: `#/enquiries/${item.id}/check`, class: 'button button--quiet', text: 'Open renter check' }));
        return;
      }
      if (check.owner_decision === 'declined' || !check.shared_at) {
        renter.replaceChildren(title, el('p', { class: 'field__hint', text: 'You chose someone else this time.' }));
        return;
      }
      const cover = coverLine(check.cover_ratio);
      renter.replaceChildren(title,
        el('p', { class: 'lead', text: [check.id_checked ? 'ID checked' : 'ID not checked yet', cover ? `pay covers the rent ${cover.text}` : 'income not checked yet'].join(' · ') }),
        el('a', { href: `#/enquiries/${item.id}/check`, class: 'button button--primary', text: 'Open renter check' }));
      return;
    }
    // The renter's side
    if (check?.owner_decision === 'accepted') {
      renter.replaceChildren(title, el('p', { class: 'message message--success', text: `${item.other_name} said yes.` }), ...(await dealLink()));
      return;
    }
    if (check?.owner_decision === 'declined') {
      renter.replaceChildren(title, el('p', { class: 'field__hint', text: 'The owner chose someone else this time. Your check is no longer shared with them.' }));
      return;
    }
    if (check?.shared_at) {
      const cover = coverLine(check.cover_ratio);
      const stop = el('button', { type: 'button', class: 'text-button', text: 'Stop sharing' });
      stop.addEventListener('click', () => whileBusy(stop, 'Stopping…', async () => {
        try {
          await stopSharing(item.id);
          await reload();
        } catch (problem) {
          message.show(friendlyListingError(problem));
        }
      }));
      renter.replaceChildren(title,
        el('p', { class: 'lead', text: `Shared with ${item.other_name}: ${[check.id_checked ? 'ID checked' : 'ID not checked yet', cover ? `pay covers the rent ${cover.text}` : 'income not checked yet'].join(' · ')}.` }),
        stop);
      return;
    }
    let mine = null;
    try {
      mine = await myRenterCheck();
    } catch {
      mine = null;
    }
    const anyDone = mine && (mine.identity_status === 'approved' || mine.income_status === 'approved');
    if (!anyDone) {
      renter.replaceChildren(title,
        el('p', { class: 'field__hint', text: `Owners choose renters they can trust. Check your ID and income once, then share the result with ${item.other_name} here. Your documents are never shared.` }),
        el('a', { href: '#/renter-check', class: 'button button--quiet', text: 'Do my renter check' }));
      return;
    }
    if (item.listing_status !== 'live') {
      renter.replaceChildren(title, el('p', { class: 'field__hint', text: 'This place is no longer listed.' }));
      return;
    }
    renter.replaceChildren(title, shareForm(mine));
  }

  function shareForm(mine) {
    const moveIn = el('input', { type: 'date', id: 'move-in', class: 'input', min: todayInSouthAfrica() });
    const lease = el('select', { id: 'lease', class: 'input' }, [
      el('option', { value: '', text: 'Not sure yet' }),
      ...LEASE_CHOICES.map((months) => el('option', { value: String(months), text: `${months} months` })),
    ]);
    lease.value = '12';
    const household = el('input', { type: 'text', id: 'household', class: 'input', maxlength: String(HOUSEHOLD_MAX), placeholder: 'For example: me and 1 child' });
    const pets = el('select', { id: 'pets', class: 'input' }, [
      el('option', { value: '', text: 'Prefer not to say' }),
      el('option', { value: 'no', text: 'No pets' }),
      el('option', { value: 'yes', text: 'I have pets' }),
    ]);
    const agree = el('input', { type: 'checkbox', id: 'share-agree', class: 'check__box' });
    const go = el('button', { type: 'submit', class: 'button button--primary', text: `Share with ${item.other_name}` });
    const done = [mine.identity_status === 'approved' ? 'ID checked' : 'ID not checked yet', mine.income_status === 'approved' ? 'income checked' : 'income not checked yet'].join(', ');
    const form = el('form', { class: 'stack', novalidate: '' }, [
      el('p', { class: 'field__hint', text: `Your check: ${done}. ${item.other_name} sees your first name and surname initial, whether your ID is checked, how many times your pay covers this rent, and what you write below. Never your documents or your income.` }),
      el('div', { class: 'two-up' }, [
        el('div', { class: 'field' }, [el('label', { for: 'move-in', class: 'field__label', text: 'Move in from' }), moveIn]),
        el('div', { class: 'field' }, [el('label', { for: 'lease', class: 'field__label', text: 'For how long' }), lease]),
      ]),
      el('div', { class: 'field' }, [el('label', { for: 'household', class: 'field__label', text: 'Who is moving in (optional)' }), household]),
      el('div', { class: 'field' }, [el('label', { for: 'pets', class: 'field__label', text: 'Pets' }), pets]),
      el('label', { class: 'check check--tall', for: 'share-agree' }, [agree, el('span', { class: 'check__text' }, [
        el('span', { class: 'check__label', text: `I agree to share this with ${item.other_name}` }),
        el('span', { class: 'check__hint', text: 'You can stop sharing at any time.' }),
      ])]),
      go,
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      message.clear();
      if (!agree.checked) {
        message.show('Tick the box to agree to share.');
        return;
      }
      const values = { moveIn: moveIn.value || null, leaseMonths: lease.value ? Number(lease.value) : null, household: household.value, pets: pets.value === '' ? null : pets.value === 'yes' };
      const errors = checkShare(values, todayInSouthAfrica());
      const first = Object.values(errors)[0];
      if (first) {
        message.show(first);
        return;
      }
      whileBusy(go, 'Sharing…', async () => {
        try {
          await shareRenterCheck(item.id, values);
          await reload();
        } catch (problem) {
          message.show(friendlyListingError(problem));
        }
      });
    });
    return form;
  }

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
        const metSlot = el('div', { class: 'stack' });
        metPanel().then((nodes) => metSlot.replaceChildren(...nodes)).catch(() => {});
        parts.push(metSlot);
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
    if (changed) drawRenter();
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
  drawRenter();
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
    renter,
    message.node,
    el('h2', { class: 'section__title', text: 'Messages' }),
    list,
    composer,
    report,
    tabBar('enquiries'),
  ];
}
