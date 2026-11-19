// The Street Safe deal (#/deals/<id>): the steps from "yes" to the keys,
// the lease (#/deals/<id>/lease) and the move-in check (#/deals/<id>/check),
// as in the SafeDeal and Inspection designs.

import { loadViewer } from '../viewer.js';
import {
  getDeal, sendLease, signLease, cancelDeal, inspection, addRoomPhoto, setRoomNote, signInspection, confirmKeys, streetSafe,
} from '../deals/api.js';
import {
  dealSteps, nextAction, checkLeaseTerms, checkSignatureName, roomName, roomProgress, photoStamp, safeTotal,
  leaseFingerprint, shortFingerprint, LEASE_MONTHS, SPECIAL_TERMS_MAX, ROOM_NOTE_MAX, ROOM_PHOTOS_MAX,
} from '../deals/rules.js';
import { formatRands, listingTitle } from '../listings/rules.js';
import { todayInSouthAfrica } from '../enquiries/rules.js';
import { friendlyListingError } from '../listings/errors.js';
import { topBar, tabBar } from '../shell.js';
import { el, messageBox, whileBusy } from '../dom.js';

const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

function when(iso) {
  return new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function longDate(day) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function placeTitle(deal) {
  return listingTitle({ kind: deal.listing_kind, bedrooms: deal.listing_bedrooms, area: deal.area, mode: 'rent' });
}

async function load(session, route) {
  const { profile } = await loadViewer(session);
  const deal = await getDeal(route.id);
  return { profile, deal };
}

function notFound(profile, session) {
  return [
    topBar({ profile, session }),
    el('h1', { class: 'title', text: 'Deal not found' }),
    el('a', { href: '#/enquiries', class: 'button button--quiet', text: 'Back to enquiries' }),
    tabBar('enquiries'),
  ];
}

const STEP_LINES = {
  verified: (d) => (d.listing_verified ? 'Owner, address and filming checked by Street Property.' : 'This listing is not Street Verified. Take extra care that the owner is real.'),
  met: (d) => (d.met_both ? 'You both tapped "We met" at the address.' : 'Not confirmed in the app. Never sign for a place you have not seen in person.'),
  renter: () => 'ID and income checked, and the owner said yes.',
  deposit: (d) => {
    const total = formatRands(safeTotal(d));
    if (d.safe_state === 'paid') return `${total} held by TradeSafe since ${when(d.safe_paid_at)}. Paid to the owner when the renter confirms the keys.`;
    if (d.safe_state === 'released') return `${total} paid to the owner on ${when(d.safe_released_at)}.`;
    if (d.safe_state === 'refunded') return `${total} refunded to the renter.`;
    if (d.safe_state === 'waiting') return 'Payment started. It shows here once TradeSafe has received it (card and Ozow at once, EFT up to 36 hours).';
    if (['moved_in', 'cancelled'].includes(d.status)) return 'Not paid through Street Safe.';
    return `After signing, the renter pays ${total} (first month’s rent and deposit) into TradeSafe, a registered escrow service. The owner is paid when the renter has the keys; if the deal is called off, the renter gets it back.`;
  },
  lease: (d) => (d.status === 'signed' || d.status === 'moved_in' ? `Signed by both on ${when(d.renter_signed_at > d.owner_signed_at ? d.renter_signed_at : d.owner_signed_at)}.` : 'A standard lease, filled in by the owner and signed by both in the app.'),
  check: (d) => (d.owner_checked_at && d.renter_checked_at ? 'Every room photographed and signed by both.' : 'Walk through together and photograph every room. It protects the deposit for both of you.'),
  keys: (d) => (d.keys_at ? `Confirmed by the renter on ${when(d.keys_at)}.` : 'The renter confirms in the app once the keys are in hand.'),
};

const STATE_CHIPS = {
  done: ['chip--good', 'Done'],
  now: ['chip--waiting', 'Now'],
  next: ['', 'Next'],
  skipped: ['chip--bad', 'Not done'],
};

// Money waiting to move (paid but keys confirmed or deal called off, or a
// payment not yet seen): ask TradeSafe once when the deal is opened.
const synced = new Set();
function needsSync(deal) {
  if (deal.safe_state === 'waiting') return true;
  return deal.safe_state === 'paid' && ['moved_in', 'cancelled'].includes(deal.status);
}

export async function renderDeal({ session, route }) {
  const { profile, deal } = await load(session, route);
  if (!deal) return notFound(profile, session);
  if (needsSync(deal) && !synced.has(deal.id)) {
    synced.add(deal.id);
    streetSafe('sync', { deal: deal.id })
      .then((answer) => { if (answer?.state && answer.state !== deal.safe_state) reload(); })
      .catch(() => {});
  }
  const owner = deal.my_side === 'owner';
  const message = messageBox();
  const steps = dealSteps(deal);

  const list = el('ol', { class: 'check-list deal-steps' }, steps.map((step, n) => {
    const [chip, label] = STATE_CHIPS[step.state];
    return el('li', { class: `check-card check-card--${step.state === 'done' ? 'done' : step.state === 'skipped' ? 'rejected' : step.state}` }, [
      el('span', { class: 'check-card__n', 'aria-hidden': 'true', text: step.state === 'done' ? '✓' : String(n + 1) }),
      el('div', { class: 'stack stack--tight check-card__body' }, [
        el('div', { class: 'check-card__top' }, [
          el('p', { class: 'check-card__title', text: step.title }),
          el('span', { class: `chip ${chip}`, text: label }),
        ]),
        el('p', { class: 'check-card__text', text: STEP_LINES[step.id](deal) }),
      ]),
    ]);
  }));

  const actions = [];
  if (deal.status === 'signed' && ['none', 'waiting'].includes(deal.safe_state)) {
    if (!owner && deal.owner_can_receive) {
      const payButton = el('button', { type: 'button', class: 'button button--primary', text: deal.safe_state === 'waiting' ? 'Finish paying into Street Safe' : `Pay ${formatRands(safeTotal(deal))} into Street Safe` });
      payButton.addEventListener('click', () => whileBusy(payButton, 'Opening TradeSafe…', async () => {
        message.clear();
        try {
          const answer = await streetSafe('pay', { deal: deal.id });
          if (answer?.waiting) {
            message.show('Street Safe payments are not switched on yet. Do not pay the owner directly until they are.');
            return;
          }
          window.location.assign(answer.url);
        } catch (problem) {
          message.show(friendlyListingError(problem));
        }
      }));
      actions.push(payButton, el('p', { class: 'field__hint', text: 'You pay on TradeSafe’s secure page by card, Ozow or EFT. Street Property never sees your card or bank details.' }));
    } else if (owner && !deal.owner_can_receive) {
      actions.push(el('a', { href: '#/payouts', class: 'button button--primary', text: 'Set up Street Safe payouts' }));
    }
  }
  if (deal.status === 'agreeing' || deal.status === 'signing') {
    actions.push(el('a', { href: `#/deals/${deal.id}/lease`, class: 'button button--primary', text: owner && deal.status === 'agreeing' ? 'Fill in the lease' : 'Open the lease' }));
  } else if (deal.status === 'signed') {
    actions.push(el('a', { href: `#/deals/${deal.id}/check`, class: 'button button--primary', text: 'Open the move-in check' }));
    actions.push(el('a', { href: `#/deals/${deal.id}/lease`, class: 'button button--quiet', text: 'Read the signed lease' }));
  } else if (deal.status === 'moved_in') {
    actions.push(el('a', { href: `#/deals/${deal.id}/check`, class: 'button button--quiet', text: 'See the move-in check' }));
    actions.push(el('a', { href: `#/deals/${deal.id}/lease`, class: 'button button--quiet', text: 'Read the signed lease' }));
  }

  let cancel = null;
  if (!['moved_in', 'cancelled'].includes(deal.status)) {
    const sure = el('button', { type: 'button', class: 'button button--danger', text: 'Yes, call the deal off' });
    sure.addEventListener('click', () => whileBusy(sure, 'Calling off…', async () => {
      message.clear();
      try {
        await cancelDeal(deal.id);
        if (deal.safe_state === 'paid' || deal.safe_state === 'waiting') await streetSafe('sync', { deal: deal.id }).catch(() => {});
        reload();
      } catch (problem) {
        message.show(friendlyListingError(problem));
      }
    }));
    cancel = el('details', { class: 'suggest-other' }, [
      el('summary', { text: 'Call the deal off' }),
      el('div', { class: 'stack' }, [
        el('p', { class: 'field__hint', text: `${deal.other_name} is told in your conversation. Anything already signed stays on record.` }),
        sure,
      ]),
    ]);
  }

  return [
    topBar({ profile, session }),
    el('a', { href: `#/enquiries/${deal.enquiry_id}`, class: 'text-link', text: '← Conversation' }),
    el('p', { class: 'eyebrow', text: 'Street Safe deal' }),
    el('h1', { class: 'title title--medium', text: placeTitle(deal) }),
    el('p', { class: 'lead', text: `${owner ? 'Renting to' : 'Renting from'} ${deal.other_name} · ${formatRands(deal.rent_rands)} a month` }),
    el('p', { class: `message ${deal.status === 'cancelled' ? 'message--error' : 'message--success'}`, text: nextAction(deal) }),
    ...actions,
    list,
    el('p', { class: 'note', text: owner
      ? 'Never hand over keys before the lease and the move-in check are signed in the app.'
      : 'Pay only through Street Safe, after the lease is signed. Street Property will never ask you to pay into a personal account.' }),
    message.node,
    ...(cancel ? [cancel] : []),
    tabBar('enquiries'),
  ];
}

// The lease ------------------------------------------------------------------

function leaseForm(deal, message) {
  const rent = el('input', { id: 'lease-rent', class: 'input', inputmode: 'numeric', value: deal.rent_rands ?? '' });
  const deposit = el('input', { id: 'lease-deposit', class: 'input', inputmode: 'numeric', value: deal.deposit_rands ?? '' });
  const today = todayInSouthAfrica();
  const startValue = deal.start_date && deal.start_date >= today ? deal.start_date : '';
  const start = el('input', { id: 'lease-start', type: 'date', class: 'input', min: today, value: startValue });
  const months = el('select', { id: 'lease-months', class: 'input' }, LEASE_MONTHS.map((m) => {
    const option = el('option', { value: String(m), text: `${m} months` });
    if (m === Number(deal.lease_months ?? 12)) option.selected = true;
    return option;
  }));
  const special = el('textarea', { id: 'lease-special', class: 'input input--area', rows: '3', maxlength: String(SPECIAL_TERMS_MAX), placeholder: 'For example: no smoking inside; the garden service is included.' });
  special.value = deal.special_terms ?? '';
  const send = el('button', { type: 'submit', class: 'button button--primary', text: 'Send the lease to sign' });
  const fieldOf = (id, label, input, hint) => el('div', { class: 'field' }, [
    el('label', { for: id, class: 'field__label', text: label }),
    input,
    ...(hint ? [el('p', { class: 'field__hint', text: hint })] : []),
  ]);
  const form = el('form', { class: 'stack', novalidate: '' }, [
    el('div', { class: 'two-up' }, [fieldOf('lease-rent', 'Rent a month (R)', rent), fieldOf('lease-deposit', 'Deposit (R)', deposit)]),
    el('div', { class: 'two-up' }, [fieldOf('lease-start', 'Start date', start), fieldOf('lease-months', 'Length', months)]),
    fieldOf('lease-special', 'Special terms (optional)', special, 'The standard clauses cannot be changed. Anything extra you agreed goes here, in plain words.'),
    send,
    el('p', { class: 'field__hint', text: 'Once sent, the lease cannot be changed. If something is wrong, call the deal off and start again.' }),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    message.clear();
    const values = { rent: rent.value.replace(/\s/g, ''), deposit: deposit.value.replace(/\s/g, ''), start: start.value, months: months.value, special: special.value.trim() };
    const errors = checkLeaseTerms(values, today);
    const first = Object.values(errors)[0];
    if (first) {
      message.show(first);
      return;
    }
    whileBusy(send, 'Sending…', async () => {
      try {
        await sendLease(deal.id, values);
        reload();
      } catch (problem) {
        message.show(friendlyListingError(problem));
      }
    });
  });
  return form;
}

function signatureLine(label, name, at) {
  return el('div', { class: 'signature' }, [
    el('span', { class: 'signature__label', text: label }),
    el('span', { class: 'signature__name', text: name ?? 'Not signed yet' }),
    ...(at ? [el('span', { class: 'signature__when', text: when(at) })] : []),
  ]);
}

export async function renderDealLease({ session, route }) {
  const { profile, deal } = await load(session, route);
  if (!deal) return notFound(profile, session);
  const owner = deal.my_side === 'owner';
  const message = messageBox();
  const back = el('a', { href: `#/deals/${deal.id}`, class: 'text-link', text: '← The deal' });
  const head = [
    topBar({ profile, session }),
    back,
    el('p', { class: 'eyebrow', text: 'Lease' }),
    el('h1', { class: 'title title--medium', text: placeTitle(deal) }),
    el('p', { class: 'note note--warning', text: 'Draft lease template: Street Property is having it reviewed by a lawyer. Read it carefully, and get advice if anything is unclear.' }),
  ];

  if (deal.status === 'agreeing' || !deal.lease_text) {
    if (!owner) {
      return [...head, el('p', { class: 'lead', text: `${deal.other_name} is filling in the lease. You will get a note in your conversation when it is ready to sign.` }), tabBar('enquiries')];
    }
    return [...head,
      el('p', { class: 'lead', text: `Fill in what you agreed with ${deal.other_name}. The app writes the lease from a standard template that follows the Rental Housing Act.` }),
      leaseForm(deal, message), message.node, tabBar('enquiries')];
  }

  // Check that the text shown is the text the database fingerprinted.
  let shownHash = null;
  try {
    shownHash = await leaseFingerprint(deal.lease_text);
  } catch {
    shownHash = null;
  }
  const intact = shownHash === deal.lease_hash;
  const mineSigned = owner ? deal.owner_signed_at : deal.renter_signed_at;
  const parts = [
    ...head,
    el('div', { class: 'lease-terms' }, [
      el('p', {}, [el('strong', { text: formatRands(deal.rent_rands) }), el('span', { text: ' a month' })]),
      el('p', { text: `Deposit ${deal.deposit_rands ? formatRands(deal.deposit_rands) : 'none'}` }),
      el('p', { text: `From ${longDate(deal.start_date)}, ${deal.lease_months} months` }),
    ]),
    el('pre', { class: 'lease-text', tabindex: '0', 'aria-label': 'The lease', text: deal.lease_text }),
    el('p', { class: 'field__hint', text: `Fingerprint ${shortFingerprint(deal.lease_hash)}. Both signatures are tied to this exact text.` }),
    signatureLine('Landlord', deal.owner_signed_name, deal.owner_signed_at),
    signatureLine('Tenant', deal.renter_signed_name, deal.renter_signed_at),
  ];
  if (!intact) {
    parts.push(el('p', { class: 'message message--error', text: 'This copy of the lease could not be checked on this phone. Reload the page before signing.' }));
  } else if (deal.status === 'signing' && !mineSigned) {
    const name = el('input', { id: 'sign-name', class: 'input', autocomplete: 'name', value: profile?.full_name ?? '' });
    const agree = el('input', { id: 'sign-agree', type: 'checkbox' });
    const sign = el('button', { type: 'submit', class: 'button button--primary', text: 'Sign the lease' });
    const form = el('form', { class: 'stack sign-form', novalidate: '' }, [
      el('div', { class: 'field' }, [el('label', { for: 'sign-name', class: 'field__label', text: 'Type your full name to sign' }), name]),
      el('label', { class: 'checkbox' }, [agree, el('span', { text: 'I have read the whole lease and agree to it.' })]),
      sign,
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      message.clear();
      const problem = checkSignatureName(name.value);
      if (problem) {
        message.show(problem);
        return;
      }
      if (!agree.checked) {
        message.show('Tick the box to say you have read the lease.');
        return;
      }
      whileBusy(sign, 'Signing…', async () => {
        try {
          await signLease(deal.id, name.value.trim(), shownHash);
          reload();
        } catch (error) {
          message.show(friendlyListingError(error));
        }
      });
    });
    parts.push(form);
  } else if (deal.status === 'signing') {
    parts.push(el('p', { class: 'message message--success', text: `You signed. Waiting for ${deal.other_name}.` }));
  }
  const print = el('button', { type: 'button', class: 'button button--quiet', text: 'Print or save as PDF' });
  print.addEventListener('click', () => window.print());
  parts.push(message.node, print, tabBar('enquiries'));
  return parts;
}

// The move-in check -------------------------------------------------------------

export async function renderDealCheck({ session, route }) {
  const { profile, deal } = await load(session, route);
  if (!deal) return notFound(profile, session);
  const owner = deal.my_side === 'owner';
  const back = el('a', { href: `#/deals/${deal.id}`, class: 'text-link', text: '← The deal' });
  if (!['signed', 'moved_in'].includes(deal.status)) {
    return [topBar({ profile, session }), back,
      el('h1', { class: 'title title--medium', text: 'Move-in check' }),
      el('p', { class: 'lead', text: 'The move-in check opens once you have both signed the lease.' }), tabBar('enquiries')];
  }
  const { photos, notes } = await inspection(deal.id);
  const bothSigned = Boolean(deal.owner_checked_at && deal.renter_checked_at);
  const open = deal.status === 'signed' && !bothSigned;
  const progress = roomProgress(deal.rooms, photos);
  const message = messageBox();

  const rooms = el('ol', { class: 'room-list' }, deal.rooms.map((room) => {
    const name = roomName(room, deal.rooms);
    const mine = photos.filter((p) => p.room === room);
    const done = mine.length > 0;
    const strip = el('div', { class: 'photo-strip' }, mine.map((p) => el('a', { href: p.url ?? '#', target: '_blank', rel: 'noopener' }, [
      el('img', { class: 'photo-strip__image', src: p.url ?? '', alt: `${name}, ${when(p.created_at)}`, loading: 'lazy' }),
    ])));
    const body = [
      el('div', { class: 'check-card__top' }, [
        el('p', { class: 'check-card__title', text: name }),
        el('span', { class: `chip ${done ? 'chip--good' : 'chip--waiting'}`, text: done ? `${mine.length} photo${mine.length > 1 ? 's' : ''}` : 'To do' }),
      ]),
      ...(mine.length ? [strip] : []),
    ];
    if (open) {
      const input = el('input', { type: 'file', id: `photo-${room}`, class: 'file__input', accept: 'image/*', capture: 'environment' });
      const take = el('label', { for: `photo-${room}`, class: 'button button--quiet file__button', text: done ? 'Add another photo' : 'Take a photo' });
      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        message.clear();
        if (mine.length >= ROOM_PHOTOS_MAX) {
          message.show(`Up to ${ROOM_PHOTOS_MAX} photos a room.`);
          return;
        }
        take.textContent = 'Uploading…';
        addRoomPhoto(deal.id, room, file, photoStamp({ area: deal.area, room: name }))
          .then(reload)
          .catch((problem) => {
            take.textContent = 'Try again';
            message.show(friendlyListingError(problem));
          });
      });
      const note = el('textarea', { id: `note-${room}`, class: 'input input--area', rows: '2', maxlength: String(ROOM_NOTE_MAX), placeholder: 'Anything to note: marks, damage, what works and what does not' });
      note.value = notes[room] ?? '';
      const save = el('button', { type: 'button', class: 'text-button', text: 'Save note' });
      save.addEventListener('click', () => whileBusy(save, 'Saving…', async () => {
        message.clear();
        try {
          await setRoomNote(deal.id, room, note.value);
          reload();
        } catch (problem) {
          message.show(friendlyListingError(problem));
        }
      }));
      body.push(take, input, el('label', { for: `note-${room}`, class: 'visually-hidden', text: `Note for ${name}` }), note, save);
    } else if (notes[room]) {
      body.push(el('p', { class: 'check-card__text', text: notes[room] }));
    }
    return el('li', { class: `check-card check-card--${done ? 'done' : 'needed'}` }, [el('div', { class: 'stack stack--tight check-card__body' }, body)]);
  }));

  const mineChecked = owner ? deal.owner_checked_at : deal.renter_checked_at;
  const theirsChecked = owner ? deal.renter_checked_at : deal.owner_checked_at;
  const footer = [];
  if (open && !mineChecked) {
    const sign = el('button', { type: 'button', class: 'button button--primary', text: 'Sign the move-in check' });
    if (!progress.complete) sign.disabled = true;
    sign.addEventListener('click', () => whileBusy(sign, 'Signing…', async () => {
      message.clear();
      try {
        await signInspection(deal.id);
        reload();
      } catch (problem) {
        message.show(friendlyListingError(problem));
      }
    }));
    footer.push(sign, el('p', { class: 'field__hint', text: progress.complete
      ? `Signing says the photos and notes show the place as it is today.${theirsChecked ? ` ${deal.other_name} has signed.` : ''}`
      : 'Add at least one photo of every room to sign.' }));
  } else if (open) {
    footer.push(el('p', { class: 'message message--success', text: `You signed. Waiting for ${deal.other_name}. If anyone changes a photo or note, you both sign again.` }));
  } else if (deal.status === 'signed' && !owner) {
    const keys = el('button', { type: 'button', class: 'button button--primary', text: 'I have the keys' });
    keys.addEventListener('click', () => whileBusy(keys, 'Confirming…', async () => {
      message.clear();
      try {
        await confirmKeys(deal.id);
        if (deal.safe_state === 'paid') await streetSafe('sync', { deal: deal.id }).catch(() => {});
        window.location.hash = `#/deals/${deal.id}`;
      } catch (problem) {
        message.show(friendlyListingError(problem));
      }
    }));
    footer.push(el('p', { class: 'message message--success', text: 'Signed by both.' }), keys);
  } else {
    footer.push(el('p', { class: 'message message--success', text: `Signed by both: ${when(deal.owner_checked_at > deal.renter_checked_at ? deal.owner_checked_at : deal.renter_checked_at)}. The move-out check will use the same rooms.` }));
  }

  return [
    topBar({ profile, session }),
    back,
    el('p', { class: 'eyebrow', text: 'Move-in check · together' }),
    el('h1', { class: 'title title--medium', text: placeTitle(deal) }),
    el('p', { class: 'lead', text: `${progress.done} of ${progress.total} rooms done` }),
    el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(progress.total), 'aria-valuenow': String(progress.done) }, [
      el('span', { class: 'progress__bar', style: `width:${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }),
    ]),
    el('p', { class: 'note', text: 'Do this together at the place. Every photo is stamped with the place, room and time, and only the two of you can see them. At move-out you check the same rooms, so the deposit is fair to both.' }),
    rooms,
    message.node,
    ...footer,
    tabBar('enquiries'),
  ];
}
