// For admins: the queue of listings waiting to be checked, and the check of
// one listing (photos, every clip with its code, time and place), ending in
// Approve or Ask for changes.

import { loadViewer } from '../viewer.js';
import { reviewQueue, getListing, listPhotos, listClips, reviewListing } from '../listings/api.js';
import { verificationQueue, docLinks, decideCheck } from '../verify/api.js';
import { decideIncome } from '../renter/api.js';
import { openReports, reportMessages, resolveReport } from '../reports/api.js';
import { parseRands } from '../listings/rules.js';
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
  const [waiting, checks, reports] = await Promise.all([reviewQueue(), verificationQueue(), openReports()]);
  const checkRows = checks.map((item) => el('li', {}, [
    el('a', { class: 'listing-row', href: `#/review/check/${item.kind}/${item.subject_id}` }, [
      el('div', { class: 'listing-row__top' }, [
        el('p', { class: 'listing-row__title', text: item.kind === 'identity' ? `ID: ${item.person_name}` : item.kind === 'income' ? `Income: ${item.person_name}` : `Ownership: ${item.street}, ${item.area}` }),
        el('span', { class: 'chip chip--waiting', text: 'Waiting' }),
      ]),
      el('p', { class: 'listing-row__about', text: `${item.kind === 'identity' ? 'ID photo and selfie' : item.kind === 'income' ? 'Payslips or bank statements (renter check)' : item.lister === 'agent' ? `Agent ${item.person_name}: FFC and mandate` : `Owner ${item.person_name}: deed or rates account`} · sent ${when(item.submitted_at)}` }),
    ]),
  ]));
  return [
    bar,
    el('h1', { class: 'title', text: 'Review queue' }),
    el('a', { href: '#/review/reports', class: `verify-link${reports.length ? '' : ' verify-link--quiet'}` }, [
      el('span', { class: 'verify-link__title', text: `Reported conversations (${reports.length})` }),
      el('span', { class: 'verify-link__line', text: reports.length ? 'Read what was said, then close each report with what you did.' : 'No open reports.' }),
    ]),
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: `ID, ownership and income checks (${checks.length})` }),
      ...(checks.length ? [el('ul', { class: 'listing-list' }, checkRows)] : [el('p', { class: 'lead', text: 'No ID or ownership checks waiting.' })]),
    ]),
    el('h2', { class: 'section__title', text: `Listings (${waiting.length})` }),
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

/** One ID or ownership check: look at the documents, then decide. The documents are deleted after deciding. */
export async function renderReviewCheck({ session, navigate, route }) {
  const { profile, admin } = await loadViewer(session);
  const bar = topBar({ profile, session });
  if (!admin) return adminsOnly(bar);
  const item = (await verificationQueue()).find((row) => row.kind === route.kind && row.subject_id === route.id);
  if (!item) {
    return [bar, el('h1', { class: 'title', text: 'This check is no longer waiting' }), el('a', { href: '#/review', class: 'button button--quiet', text: 'Back to the queue' }), tabBar('profile')];
  }
  const docs = await docLinks(item.paths);
  const identity = item.kind === 'identity';
  const income = item.kind === 'income';
  const labels = identity ? ['ID or passport', 'Selfie'] : income ? ['Payslip or statement'] : item.lister === 'agent' ? ['Fidelity Fund Certificate', 'Owner\u2019s mandate', 'More'] : ['Deed or rates account', 'More'];
  const message = messageBox();

  const shown = el('ul', { class: 'doc-list' }, docs.map((doc, n) => el('li', { class: 'stack stack--tight' }, [
    el('p', { class: 'section__title', text: labels[Math.min(n, labels.length - 1)] }),
    doc.pdf
      ? el('a', { href: doc.url ?? '#', target: '_blank', rel: 'noopener noreferrer', class: 'button button--quiet', text: 'Open the PDF (link works for 15 minutes)' })
      : el('img', { class: 'doc-list__image', src: doc.url ?? '', alt: labels[Math.min(n, labels.length - 1)] }),
  ])));

  const checklist = identity
    ? ['The ID or passport is real and readable.', 'The face in the selfie matches the ID photo.', 'The name matches the name on the account.']
    : income
      ? ['The documents are in this person\u2019s name and from the last 3 months.', 'They look untouched (fonts, totals and dates match).', 'Write down the monthly take-home pay (after tax and deductions, or the average salary paid in).']
      : item.lister === 'agent'
      ? ['The Fidelity Fund Certificate is current (check it on the PPRA website).', 'The mandate names this address and is signed by the owner.', 'The agent\u2019s name matches their ID.']
      : ['The deed or rates account shows this address.', 'It is in the name of the person on the ID.', 'The rates account is recent (last 3 months).'];

  const note = el('textarea', { id: 'check-note', class: 'input input--area', rows: '3', maxlength: '500' });
  const pay = el('input', { id: 'take-home', class: 'input', inputmode: 'numeric', placeholder: 'For example 14 000' });
  const approve = el('button', { type: 'button', class: 'button button--primary', text: 'Approve' });
  const reject = el('button', { type: 'button', class: 'button button--danger', text: 'Not accepted' });
  async function decide(button, ok) {
    message.clear();
    if (!ok && note.value.trim().length < 5) {
      message.show('Say what the person needs to send instead.');
      note.focus();
      return;
    }
    const monthly = parseRands(pay.value);
    if (income && ok && (!monthly || monthly < 1)) {
      message.show('Enter the monthly take-home pay in rands.');
      pay.focus();
      return;
    }
    await whileBusy(button, ok ? 'Approving…' : 'Sending…', async () => {
      try {
        if (income) await decideIncome(item.subject_id, ok, monthly, note.value.trim());
        else await decideCheck(item.kind, item.subject_id, ok, note.value.trim());
        navigate('#/review');
      } catch (error) {
        message.show(error?.code === 'docs_not_deleted' ? error.message : friendlyListingError(error));
      }
    });
  }
  approve.addEventListener('click', () => decide(approve, true));
  reject.addEventListener('click', () => decide(reject, false));

  return [
    bar,
    el('a', { href: '#/review', class: 'text-link', text: '\u2190 Review queue' }),
    el('h1', { class: 'title title--medium', text: identity ? `ID check: ${item.person_name}` : income ? `Income check: ${item.person_name}` : 'Ownership check' }),
    ...(identity || income ? [] : [el('ul', { class: 'plain-list' }, [
      `${item.street}, ${item.area}, ${item.city}`,
      `${item.lister === 'agent' ? 'Agent' : 'Owner'}: ${item.person_name}`,
    ].map((line) => el('li', { text: line })))]),
    el('p', { class: 'lead', text: `Sent ${when(item.submitted_at)}` }),
    shown,
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: 'Check' }),
      el('ul', { class: 'plain-list' }, checklist.map((line) => el('li', { text: line }))),
      ...(income ? [el('div', { class: 'field' }, [el('label', { for: 'take-home', class: 'field__label', text: 'Monthly take-home pay (R), needed to approve' }), pay, el('p', { class: 'field__hint', text: 'Owners never see this amount, only how many times it covers their rent.' })])] : []),
      el('div', { class: 'field' }, [el('label', { for: 'check-note', class: 'field__label', text: 'Note to the person (needed when not accepted)' }), note]),
      message.node,
      approve,
      reject,
      el('p', { class: 'field__hint', text: 'The photos and documents are deleted as soon as you decide.' }),
    ]),
    tabBar('profile'),
  ];
}

/** Reported conversations: read them and close each with what was done. */
export async function renderReports({ session }) {
  const { profile, admin } = await loadViewer(session);
  const bar = topBar({ profile, session });
  if (!admin) return adminsOnly(bar);
  const reports = await openReports();
  const list = el('ul', { class: 'listing-list' });

  function reportCard(report) {
    const li = el('li', { class: 'report-card' });
    const thread = el('ol', { class: 'bubbles' });
    const show = el('button', { type: 'button', class: 'button button--quiet button--small', text: 'Read the conversation' });
    show.addEventListener('click', () => whileBusy(show, 'Loading…', async () => {
      const messages = await reportMessages(report.id);
      thread.replaceChildren(...messages.map((m) => m.kind === 'system'
        ? el('li', { class: 'bubble bubble--note', text: m.body })
        : el('li', { class: `bubble ${m.sender === 'renter' ? 'bubble--theirs' : 'bubble--mine'}` }, [
          el('p', { class: 'bubble__time', text: `${m.sender === 'renter' ? report.renter_name : report.owner_name} (${m.sender}) · ${when(m.created_at)}` }),
          el('p', { class: 'bubble__text', text: m.body }),
        ])));
      show.remove();
    }));
    const outcome = el('textarea', { id: `outcome-${report.id}`, class: 'input input--area', rows: '2', maxlength: '500' });
    const takeDown = el('input', { type: 'checkbox', id: `down-${report.id}`, class: 'check__box' });
    const close = el('button', { type: 'button', class: 'button button--primary', text: 'Close the report' });
    const message = messageBox();
    close.addEventListener('click', () => whileBusy(close, 'Closing…', async () => {
      message.clear();
      try {
        await resolveReport(report.id, outcome.value, takeDown.checked);
        li.remove();
        if (!list.children.length) list.replaceWith(el('p', { class: 'lead', text: 'No open reports.' }));
      } catch (error) {
        message.show(friendlyListingError(error));
      }
    }));
    li.append(
      el('p', { class: 'listing-row__title', text: `${report.reporter_name} (${report.reporter_side}) reported a conversation` }),
      el('p', { class: 'lead', text: `\u201c${report.reason}\u201d` }),
      el('p', { class: 'listing-row__about', text: `About ${report.street}, ${report.area} (${report.listing_status}) · renter ${report.renter_name}, owner ${report.owner_name} · ${when(report.created_at)}` }),
      show,
      thread,
      el('label', { for: `outcome-${report.id}`, class: 'field__label', text: 'What you did (kept with the report)' }),
      outcome,
      el('label', { class: 'check', for: `down-${report.id}` }, [takeDown, el('span', { text: 'Take the listing down (the owner is told why)' })]),
      message.node,
      close,
    );
    return li;
  }

  list.append(...reports.map(reportCard));
  return [
    bar,
    el('a', { href: '#/review', class: 'text-link', text: '\u2190 Review queue' }),
    el('h1', { class: 'title', text: 'Reported conversations' }),
    el('p', { class: 'lead', text: 'Only open reports are shown. Read the conversation only to deal with the report.' }),
    reports.length ? list : el('p', { class: 'lead', text: 'No open reports.' }),
    tabBar('profile'),
  ];
}
