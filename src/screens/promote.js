// Promote (Sprint 11):
//   #/list/<id>/promote  the owner's page: paid boosts and the free tools
//   #/ad/<id>            a clean page about the place to share or print, with
//                        a QR code and a ready-made social post
//   #/board/<id>         a printable "To Let" board for the gate or window

import { loadViewer } from '../viewer.js';
import { getListing, listPhotos } from '../listings/api.js';
import { listingTitle, priceLine, formatRands } from '../listings/rules.js';
import { publicPlace } from '../explore/filters.js';
import { promote, myBoosts, qrSvg, drawQr } from '../promote/api.js';
import { BOOSTS, boostLine, isFeatured, listingLink, socialCaption } from '../promote/rules.js';
import { friendlyListingError } from '../listings/errors.js';
import { topBar, tabBar } from '../shell.js';
import { el, messageBox, whileBusy } from '../dom.js';

const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

function when(iso) {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Johannesburg' });
}

function missing(profile, session, text) {
  return [topBar({ profile, session }), el('h1', { class: 'title', text: 'Not available' }), el('p', { class: 'lead', text }),
    el('a', { href: '#/', class: 'button button--quiet', text: 'Explore places' }), tabBar('explore')];
}

// The owner's Promote page -------------------------------------------------------------

const checkedOnce = new Set();

export async function renderPromote({ session, route }) {
  const { profile } = await loadViewer(session);
  const listing = await getListing(route.id).catch(() => null);
  if (!listing || listing.owner_id !== session.user.id) return missing(profile, session, 'Only the owner of a listing can promote it.');
  const message = messageBox();
  const back = el('a', { href: `#/list/${listing.id}/send`, class: 'text-link', text: '← The listing' });
  const head = [topBar({ profile, session }), back, el('p', { class: 'eyebrow', text: 'Promote' }), el('h1', { class: 'title title--medium', text: listingTitle(listing) })];
  if (listing.status !== 'live') {
    return [...head, el('p', { class: 'lead', text: 'You can promote a place once it is live.' }), tabBar('profile')];
  }

  const [status, boosts] = await Promise.all([promote('status').catch(() => null), myBoosts(listing.id).catch(() => [])]);
  // Coming back from Paystack: ask about unpaid orders once.
  if (status?.ready && boosts.some((b) => b.state === 'pending') && !checkedOnce.has(listing.id)) {
    checkedOnce.add(listing.id);
    promote('verify', { listing: listing.id })
      .then((answer) => { if (Object.values(answer?.results ?? {}).some((s) => s === 'paid')) reload(); })
      .catch(() => {});
  }

  const current = boostLine(listing);
  const cards = BOOSTS.map((boost) => {
    const buy = el('button', { type: 'button', class: `button ${boost.tier === 'month' ? 'button--primary' : 'button--quiet'}`, text: `Pay ${formatRands(boost.rands)}` });
    buy.addEventListener('click', () => whileBusy(buy, 'Opening Paystack…', async () => {
      message.clear();
      try {
        const answer = await promote('boost', { listing: listing.id, tier: boost.tier });
        if (answer?.waiting) {
          message.show('Paid boosts are not switched on yet. The free tools below work now.');
          return;
        }
        window.location.assign(answer.url);
      } catch (problem) {
        message.show(friendlyListingError(problem));
      }
    }));
    return el('li', { class: `boost-card${boost.tier === 'month' ? ' boost-card--top' : ''}` }, [
      el('div', { class: 'boost-card__top' }, [
        el('p', { class: 'boost-card__name', text: boost.name }),
        el('p', { class: 'boost-card__price', text: `${formatRands(boost.rands)} · ${boost.days} days` }),
      ]),
      el('p', { class: 'check-card__text', text: boost.what }),
      buy,
    ]);
  });

  const history = boosts.filter((b) => b.state === 'paid').slice(0, 5).map((b) => el('li', {
    text: `${BOOSTS.find((x) => x.tier === b.tier)?.name ?? b.tier} · ${formatRands(b.amount_rands)} · ${when(b.starts_at)} to ${when(b.ends_at)}`,
  }));

  return [
    ...head,
    ...(current ? [el('p', { class: 'message message--success', text: `${current}. A new boost starts when this one ends.` })] : []),
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: 'Paid boosts' }),
      el('p', { class: 'field__hint', text: 'Pay once by card or EFT on Paystack’s secure page. No subscription; nothing renews by itself.' }),
      ...(status && !status.ready ? [el('p', { class: 'note note--warning', text: 'Paid boosts are not switched on yet.' })] : []),
      ...(status?.ready && status.test ? [el('p', { class: 'note note--warning', text: 'Test mode: no real money moves.' })] : []),
      el('ul', { class: 'boost-list' }, cards),
      message.node,
      ...(history.length ? [el('h3', { class: 'field__label', text: 'Your boosts' }), el('ul', { class: 'plain-list' }, history)] : []),
    ]),
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: 'Free ways to promote' }),
      el('a', { href: `#/ad/${listing.id}`, class: 'promo-link' }, [
        el('span', { class: 'promo-link__title', text: 'Ad page and social post →' }),
        el('span', { class: 'promo-link__line', text: 'A clean page to share on WhatsApp or Facebook, and a picture ready to post.' }),
      ]),
      el('a', { href: `#/board/${listing.id}`, class: 'promo-link' }, [
        el('span', { class: 'promo-link__title', text: 'To Let board →' }),
        el('span', { class: 'promo-link__line', text: 'Print it for the gate or window. People scan the code to watch the video tour.' }),
      ]),
    ]),
    tabBar('profile'),
  ];
}

// The ad page ------------------------------------------------------------------------------

async function loadPublic(route) {
  const listing = await getListing(route.id).catch(() => null);
  if (!listing || listing.status !== 'live') return { listing: null, photos: [] };
  const photos = await listPhotos(listing.id).catch(() => []);
  return { listing, photos };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

/** Wrap text into lines that fit `width` on the canvas. */
function wrap(pen, text, width) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (pen.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A 1080 × 1350 picture for Instagram, Facebook and WhatsApp status. */
export async function socialPicture(listing, photoUrl, link) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const pen = canvas.getContext('2d');
  pen.fillStyle = '#0F2E28';
  pen.fillRect(0, 0, 1080, 1350);
  if (photoUrl) {
    try {
      const image = await loadImage(photoUrl);
      const scale = Math.max(1080 / image.width, 810 / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      pen.drawImage(image, (1080 - w) / 2, (810 - h) / 2, w, h);
    } catch {
      // no photo: the green background stays
    }
  }
  pen.fillStyle = '#157F6A';
  pen.fillRect(60, 740, 300, 70);
  pen.fillStyle = '#fff';
  pen.font = '800 40px system-ui, sans-serif';
  pen.textBaseline = 'middle';
  pen.fillText(listing.mode === 'sell' ? 'FOR SALE' : 'TO LET', 84, 776);
  pen.textBaseline = 'alphabetic';
  pen.font = '800 84px system-ui, sans-serif';
  pen.fillText(priceLine(listing), 60, 920);
  pen.font = '600 50px system-ui, sans-serif';
  let y = 995;
  for (const line of wrap(pen, listingTitle(listing), 660).slice(0, 2)) {
    pen.fillText(line, 60, y);
    y += 62;
  }
  pen.fillStyle = '#CFE3DD';
  pen.font = '400 40px system-ui, sans-serif';
  pen.fillText(`${listing.area}, ${listing.city}`, 60, y + 10);
  pen.font = '600 36px system-ui, sans-serif';
  pen.fillText(listing.verified_at ? '✓ Street Verified · Video tour' : 'Video tour filmed at the place', 60, 1250);
  pen.fillStyle = '#fff';
  pen.font = '800 34px system-ui, sans-serif';
  pen.fillText('Street Property', 60, 1300);
  await drawQr(pen, link, 780, 960, 240);
  pen.fillStyle = '#CFE3DD';
  pen.font = '600 28px system-ui, sans-serif';
  pen.fillText('Scan to watch', 812, 1240);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
}

export async function renderAd({ session, route }) {
  const { profile } = await loadViewer(session);
  const { listing, photos } = await loadPublic(route);
  if (!listing) return missing(profile, session, 'This place is not listed right now.');
  const link = listingLink(listing.id);
  const caption = socialCaption(listing, link);
  const mine = session && listing.owner_id === session.user?.id;
  const message = messageBox();
  const qrBox = el('div', { class: 'ad-qr' });
  qrSvg(link, 'Scan to open this place on Street Property').then((svg) => qrBox.replaceChildren(svg)).catch(() => qrBox.replaceChildren(el('p', { class: 'field__hint', text: link })));

  const make = el('button', { type: 'button', class: 'button button--primary', text: 'Make a social post' });
  const result = el('div', { class: 'stack' });
  make.addEventListener('click', () => whileBusy(make, 'Making the picture…', async () => {
    message.clear();
    try {
      const blob = await socialPicture(listing, photos[0]?.url, link);
      const file = new File([blob], `street-property-${listing.area.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`, { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      const share = el('button', { type: 'button', class: 'button button--primary', text: 'Share' });
      share.addEventListener('click', async () => {
        try {
          if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: caption });
          else await navigator.share({ text: caption, url: link });
        } catch {
          // the person closed the share sheet
        }
      });
      const save = el('a', { href: url, download: file.name, class: 'button button--quiet', text: 'Save the picture' });
      result.replaceChildren(
        el('img', { class: 'ad-post', src: url, alt: `Social post: ${listingTitle(listing)}, ${priceLine(listing)}` }),
        ...(navigator.share ? [share] : []),
        save,
      );
    } catch {
      message.show('The picture could not be made on this phone. Copy the words and share a photo instead.');
    }
  }));
  const copy = el('button', { type: 'button', class: 'button button--quiet', text: 'Copy the words' });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(caption);
      copy.textContent = 'Copied';
    } catch {
      message.show('Copying is blocked here. Select the words above and copy them.');
    }
  });
  const print = el('button', { type: 'button', class: 'button button--quiet', text: 'Print' });
  print.addEventListener('click', () => window.print());

  return [
    topBar({ profile, session }),
    el('a', { href: `#/place/${listing.id}`, class: 'text-link no-print', text: '← The place' }),
    el('article', { class: 'ad' }, [
      ...(photos[0]?.url ? [el('img', { class: 'ad__photo', src: photos[0].url, alt: listingTitle(listing) })] : []),
      el('p', { class: 'ad__tag', text: listing.mode === 'sell' ? 'For sale' : 'To let' }),
      el('p', { class: 'place-price', text: priceLine(listing) }),
      el('h1', { class: 'title title--medium', text: listingTitle(listing) }),
      el('p', { class: 'lead', text: publicPlace(listing) }),
      ...(listing.verified_at || isFeatured(listing) ? [el('div', { class: 'badge-row' }, [
        ...(listing.verified_at ? [el('span', { class: 'chip chip--verified', text: 'Street Verified' })] : []),
        ...(isFeatured(listing) ? [el('span', { class: 'chip chip--featured', text: 'Featured' })] : []),
      ])] : []),
      ...(listing.description ? [el('p', { class: 'prose', text: listing.description })] : []),
      el('div', { class: 'ad__scan' }, [qrBox, el('div', { class: 'stack stack--tight' }, [
        el('p', { class: 'ad__scan-title', text: 'Watch the video tour' }),
        el('p', { class: 'field__hint', text: 'Scan the code, or open:' }),
        el('p', { class: 'ad__link', text: link }),
      ])]),
    ]),
    el('section', { class: 'section no-print' }, [
      el('h2', { class: 'section__title', text: mine ? 'Share your place' : 'Share this place' }),
      el('pre', { class: 'ad-caption', text: caption }),
      make, result, copy, print,
      ...(mine ? [el('a', { href: `#/board/${listing.id}`, class: 'button button--quiet', text: 'To Let board' })] : []),
      message.node,
    ]),
    tabBar('explore'),
  ];
}

// The To Let board --------------------------------------------------------------------------

export async function renderBoard({ session, route }) {
  const { profile } = await loadViewer(session);
  const { listing } = await loadPublic(route);
  if (!listing) return missing(profile, session, 'This place is not listed right now.');
  const link = listingLink(listing.id);
  const qrBox = el('div', { class: 'board__qr' });
  qrSvg(link, 'Scan for the video tour').then((svg) => qrBox.replaceChildren(svg)).catch(() => qrBox.replaceChildren(el('p', { text: link })));
  const print = el('button', { type: 'button', class: 'button button--primary', text: 'Print the board (A4)' });
  print.addEventListener('click', () => window.print());
  return [
    topBar({ profile, session }),
    el('a', { href: `#/ad/${listing.id}`, class: 'text-link no-print', text: '← Ad page' }),
    el('p', { class: 'field__hint no-print', text: 'Print on A4, portrait. It reads best on white paper, in a plastic sleeve against rain.' }),
    print,
    el('article', { class: 'board' }, [
      el('p', { class: 'board__big', text: listing.mode === 'sell' ? 'FOR SALE' : 'TO LET' }),
      el('p', { class: 'board__what', text: listingTitle(listing) }),
      el('p', { class: 'board__price', text: priceLine(listing) }),
      qrBox,
      el('p', { class: 'board__scan', text: 'Scan for the video tour and to ask the owner' }),
      el('p', { class: 'board__brand', text: listing.verified_at ? 'Street Property · Street Verified' : 'Street Property' }),
    ]),
    tabBar('explore'),
  ];
}
