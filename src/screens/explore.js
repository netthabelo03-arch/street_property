// Explore: the home screen. Renters choose rent or buy and search by street,
// suburb or township. Listings arrive with the next sprints; until then the
// screen explains what is coming and invites owners to sign up.

import { loadViewer } from '../viewer.js';
import { canList } from '../roles.js';
import { topBar, tabBar } from '../shell.js';
import { el, icon } from '../dom.js';

const SEARCH = '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path>';
const SHIELD = '<path d="M12 3l8 3v6c0 5-3.5 8.5-8 9.5C7.5 20.5 4 17 4 12V6z"></path><path d="M8.5 12l2.5 2.5 4.5-5"></path>';

/** The words for each mode of the Rent / Buy switch. */
export const MODES = {
  rent: { label: 'Rent', heading: 'Places to rent near you', placeholder: 'Street, suburb or township' },
  buy: { label: 'Buy', heading: 'Homes for sale near you', placeholder: 'Street, suburb or township' },
};

export async function renderExplore({ session }) {
  const { profile } = await loadViewer(session);
  let mode = 'rent';

  const heading = el('h2', { class: 'section__title' });
  const input = el('input', { id: 'search', type: 'search', class: 'search__input', autocomplete: 'off' });
  const switches = Object.entries(MODES).map(([id, words]) => {
    const button = el('button', { type: 'button', class: 'segmented__option', text: words.label });
    button.addEventListener('click', () => {
      mode = id;
      update();
    });
    return { id, button };
  });
  function update() {
    for (const { id, button } of switches) button.setAttribute('aria-pressed', String(id === mode));
    heading.textContent = MODES[mode].heading;
    input.placeholder = MODES[mode].placeholder;
  }
  update();

  const search = el('label', { for: 'search', class: 'search' }, [icon(SEARCH, 20), el('span', { class: 'visually-hidden', text: 'Search' }), input]);

  const owner = canList(profile?.role);
  const empty = el('div', { class: 'empty' }, [
    el('p', { class: 'empty__title', text: 'No places listed yet' }),
    el('p', { class: 'lead', text: owner
      ? 'You will be able to list your place here soon. Every listing is checked before it goes live, so renters can trust it.'
      : 'Verified places will show here soon. Every listing is checked before it goes live, so you never pay a fake landlord.' }),
    ...(session ? [] : [el('a', { href: '#/signup', class: 'button button--primary', text: 'Create a free account' })]),
  ]);

  const safe = el('div', { class: 'promise' }, [
    icon(SHIELD, 28),
    el('div', { class: 'stack stack--tight' }, [
      el('p', { class: 'promise__title', text: 'Street Safe' }),
      el('p', { class: 'promise__text', text: 'Owners are checked, deposits are held until you have the keys, and both sides sign the move-in check.' }),
    ]),
  ]);

  return [
    topBar({ profile, session }),
    el('h1', { class: 'title', text: 'Find your place' }),
    el('div', { class: 'segmented', role: 'group', 'aria-label': 'Rent or buy' }, switches.map(({ button }) => button)),
    search,
    heading,
    empty,
    safe,
    ...(session ? [tabBar('explore')] : []),
  ];
}
