// Pieces shared by the listing screens: the step header, + / − counters, the
// status chip, and the frame for a listing that cannot be shown.

import { STATUSES, listingTitle, priceLine } from '../listings/rules.js';
import { el } from '../dom.js';

const STEPS = [
  { id: 'details', label: 'Details and photos', hash: (id) => `#/list/${id}` },
  { id: 'tour', label: 'Video tour', hash: (id) => `#/list/${id}/tour` },
  { id: 'send', label: 'Send', hash: (id) => `#/list/${id}/send` },
];

/** "Step 1 of 3" and links to the other steps (once the listing exists). */
export function stepHeader(listingId, current) {
  const index = STEPS.findIndex((step) => step.id === current);
  const nav = el('ol', { class: 'steps', 'aria-label': 'Steps' }, STEPS.map((step, position) => {
    const label = `${position + 1}. ${step.label}`;
    if (step.id === current) return el('li', { class: 'steps__step steps__step--now', 'aria-current': 'step', text: label });
    if (!listingId) return el('li', { class: 'steps__step', text: label });
    return el('li', { class: 'steps__step' }, [el('a', { href: step.hash(listingId), text: label })]);
  }));
  return el('div', { class: 'stack stack--tight' }, [
    el('p', { class: 'eyebrow', text: `Step ${index + 1} of ${STEPS.length}` }),
    nav,
  ]);
}

export function statusChip(status) {
  const info = STATUSES[status] ?? STATUSES.draft;
  return el('span', { class: `chip ${info.chip}`, text: info.label });
}

/**
 * A number with − and + buttons, for bedrooms, bathrooms and parking.
 * @returns {{ node: HTMLElement, value: () => number }}
 */
export function counter({ id, label, value, min = 0, max = 20 }) {
  let current = value;
  const shown = el('output', { class: 'counter__value', id: `${id}-value`, 'aria-live': 'polite' });
  const down = el('button', { type: 'button', class: 'counter__button', 'aria-label': `One fewer: ${label}`, text: '−' });
  const up = el('button', { type: 'button', class: 'counter__button', 'aria-label': `One more: ${label}`, text: '+' });
  function update() {
    shown.textContent = String(current);
    down.disabled = current <= min;
    up.disabled = current >= max;
  }
  down.addEventListener('click', () => { current = Math.max(min, current - 1); update(); });
  up.addEventListener('click', () => { current = Math.min(max, current + 1); update(); });
  update();
  const node = el('div', { class: 'counter' }, [
    el('span', { class: 'counter__label', id: `${id}-label`, text: label }),
    el('div', { class: 'counter__controls', role: 'group', 'aria-labelledby': `${id}-label` }, [down, shown, up]),
  ]);
  return { node, value: () => current };
}

/** A small summary card for a listing: title, price, place and status. */
export function listingSummary(listing, { href, extra = [] } = {}) {
  const body = [
    el('div', { class: 'listing-row__top' }, [
      el('p', { class: 'listing-row__title', text: listingTitle(listing) }),
      statusChip(listing.status),
    ]),
    el('p', { class: 'listing-row__price', text: priceLine(listing) }),
    el('p', { class: 'listing-row__place', text: `${listing.street}, ${listing.area}, ${listing.city}` }),
    ...extra,
  ];
  return href ? el('a', { class: 'listing-row', href }, body) : el('div', { class: 'listing-row' }, body);
}

/** Shown when a listing does not exist or belongs to someone else. */
export function notFound(bar, tabs) {
  return [
    bar,
    el('h1', { class: 'title', text: 'Listing not found' }),
    el('p', { class: 'lead', text: 'It may have been deleted, or it belongs to another account.' }),
    el('a', { href: '#/my-listings', class: 'button button--quiet', text: 'Back to my listings' }),
    tabs,
  ];
}

/** Shown when someone who is not an owner or agent tries to list a place. */
export function notALister(bar, tabs) {
  return [
    bar,
    el('h1', { class: 'title', text: 'List a property' }),
    el('p', { class: 'lead', text: 'Only owners and agents can list a place. If you own a place or list for owners, change "I use Street Property as" on your profile.' }),
    el('a', { href: '#/profile', class: 'button button--primary', text: 'Go to my profile' }),
    tabs,
  ];
}
