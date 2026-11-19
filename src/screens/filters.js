// Filters: price, bedrooms, type of place and must-haves. The button at the
// bottom shows how many places match before going back to Explore.

import { loadViewer } from '../viewer.js';
import { countListings } from '../explore/api.js';
import { loadFilters, saveFilters, MUST_HAVES, BED_CHOICES, checkPriceRange, defaultFilters } from '../explore/filters.js';
import { KINDS, parseRands } from '../listings/rules.js';
import { topBar, tabBar } from '../shell.js';
import { el, field } from '../dom.js';

export async function renderFilters({ session, navigate }) {
  const { profile } = await loadViewer(session);
  let filters = { ...loadFilters() };
  const rent = filters.mode === 'rent';

  const min = field({ id: 'min-price', label: 'Minimum (R)', value: filters.minPrice === null ? '' : String(filters.minPrice) });
  const max = field({ id: 'max-price', label: 'Maximum (R)', value: filters.maxPrice === null ? '' : String(filters.maxPrice) });
  min.input.inputMode = 'numeric';
  max.input.inputMode = 'numeric';
  const priceError = el('p', { class: 'field__error', role: 'alert' });
  priceError.hidden = true;

  const bedButtons = BED_CHOICES.map((choice) => {
    const button = el('button', { type: 'button', class: 'choice', text: choice.label });
    button.addEventListener('click', () => { filters.minBeds = choice.min; draw(); });
    return { choice, button };
  });
  const kindButtons = KINDS.map((kind) => {
    const button = el('button', { type: 'button', class: 'choice', text: kind.label });
    button.addEventListener('click', () => {
      filters.kinds = filters.kinds.includes(kind.id) ? filters.kinds.filter((id) => id !== kind.id) : [...filters.kinds, kind.id];
      draw();
    });
    return { kind, button };
  });
  const mustBoxes = MUST_HAVES.map((item) => {
    const box = el('input', { type: 'checkbox', id: `must-${item.id}`, class: 'check__box' });
    box.addEventListener('change', () => {
      filters.musts = box.checked ? [...filters.musts, item.id] : filters.musts.filter((id) => id !== item.id);
      draw();
    });
    const node = el('label', { class: 'check check--tall', for: `must-${item.id}` }, [
      box,
      el('span', { class: 'check__text' }, [el('span', { class: 'check__label', text: item.label }), el('span', { class: 'check__hint', text: item.hint })]),
    ]);
    return { item, box, node };
  });

  const show = el('button', { type: 'button', class: 'button button--primary', text: 'Show matching places' });
  const reset = el('button', { type: 'button', class: 'topbar__link', text: 'Reset' });
  let counting = null;
  let countRun = 0;

  function readPrices() {
    const range = checkPriceRange(min.input.value, max.input.value, parseRands);
    priceError.textContent = range.error ?? '';
    priceError.hidden = !range.error;
    return range;
  }

  function draw() {
    for (const { choice, button } of bedButtons) button.setAttribute('aria-pressed', String(choice.min === filters.minBeds));
    for (const { kind, button } of kindButtons) button.setAttribute('aria-pressed', String(filters.kinds.includes(kind.id)));
    for (const { item, box } of mustBoxes) box.checked = filters.musts.includes(item.id);
    clearTimeout(counting);
    counting = setTimeout(updateCount, 300);
  }

  async function updateCount() {
    const range = readPrices();
    if (range.error) {
      show.textContent = 'Fix the price first';
      show.disabled = true;
      return;
    }
    show.disabled = false;
    const run = ++countRun;
    try {
      const n = await countListings({ ...filters, minPrice: range.min, maxPrice: range.max });
      if (run !== countRun) return;
      show.textContent = n === 0 ? 'No places match yet' : `Show ${n} place${n === 1 ? '' : 's'}`;
    } catch {
      if (run === countRun) show.textContent = 'Show matching places';
    }
  }

  min.input.addEventListener('input', draw);
  max.input.addEventListener('input', draw);
  reset.addEventListener('click', () => {
    filters = { ...defaultFilters(), mode: filters.mode, text: filters.text, tours: filters.tours };
    min.input.value = '';
    max.input.value = '';
    draw();
  });
  show.addEventListener('click', () => {
    const range = readPrices();
    if (range.error) return;
    saveFilters({ ...filters, minPrice: range.min, maxPrice: range.max });
    navigate('#/');
  });
  draw();

  return [
    topBar({ profile, session }),
    el('div', { class: 'explore-head' }, [
      el('a', { href: '#/', class: 'text-link', text: '← Explore' }),
      reset,
    ]),
    el('h1', { class: 'title', text: 'Filters' }),
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: rent ? 'Monthly rent' : 'Price' }),
      el('div', { class: 'two-up' }, [min.node, max.node]),
      priceError,
    ]),
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', id: 'beds-label', text: 'Bedrooms' }),
      el('div', { class: 'choices', role: 'group', 'aria-labelledby': 'beds-label' }, bedButtons.map(({ button }) => button)),
    ]),
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', id: 'kinds-label', text: 'Type of place' }),
      el('div', { class: 'choices', role: 'group', 'aria-labelledby': 'kinds-label' }, kindButtons.map(({ button }) => button)),
    ]),
    el('section', { class: 'section' }, [
      el('h2', { class: 'section__title', text: 'Must have' }),
      el('div', { class: 'stack' }, mustBoxes.map(({ node }) => node)),
    ]),
    el('div', { class: 'sticky-action' }, [show]),
    ...(session ? [tabBar('explore')] : []),
  ];
}
