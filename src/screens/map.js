// Map: live listings as price pins. Moving the map searches that area, with
// the same Rent / Buy and filters as Explore. Pins sit at a spot rounded to
// about 100 m, never on the house itself.

import { loadViewer } from '../viewer.js';
import { searchArea } from '../explore/api.js';
import { loadFilters, saveFilters, withMode, activeCount } from '../explore/filters.js';
import { loadLeaflet, makeMap, START_VIEW } from '../map/leaflet.js';
import { pinPrice, mapCountLine, spreadPins, loadView, saveView } from '../map/pins.js';
import { friendlyListingError } from '../listings/errors.js';
import { topBar, tabBar } from '../shell.js';
import { el, icon } from '../dom.js';
import { MODES, placeCard } from './explore.js';

const SLIDERS = '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"></path><circle cx="16" cy="6" r="2"></circle><circle cx="10" cy="12" r="2"></circle><circle cx="18" cy="18" r="2"></circle>';
const LIST = '<path d="M8 6h12M8 12h12M8 18h12"></path><circle cx="4" cy="6" r="1"></circle><circle cx="4" cy="12" r="1"></circle><circle cx="4" cy="18" r="1"></circle>';

export async function renderMap({ session }) {
  const { profile } = await loadViewer(session);
  let filters = loadFilters();
  const holder = el('div', { class: 'map', role: 'region', 'aria-label': 'Map of places' });
  const status = el('p', { class: 'map-status', role: 'status', text: 'Loading the map…' });
  const picked = el('div', { class: 'map-picked' });

  const switches = Object.entries(MODES).map(([id, words]) => {
    const button = el('button', { type: 'button', class: 'segmented__option', text: words.label });
    button.addEventListener('click', () => {
      filters = saveFilters(withMode(filters, id));
      drawSwitches();
      refresh();
    });
    return { id, button };
  });
  function drawSwitches() {
    for (const { id, button } of switches) button.setAttribute('aria-pressed', String(id === filters.mode));
  }
  drawSwitches();
  const n = activeCount(filters);
  const controls = el('div', { class: 'chip-row' }, [
    el('a', { href: '#/filters', class: `chip-button${n ? ' chip-button--on' : ''}` }, [icon(SLIDERS, 16), el('span', { text: n ? `Filters · ${n}` : 'Filters' })]),
    el('a', { href: '#/', class: 'chip-button chip-button--quiet' }, [icon(LIST, 16), el('span', { text: 'List' })]),
  ]);

  let map = null;
  let L = null;
  let layer = null;
  let run = 0;
  let timer = null;
  let selected = null;

  function select(listing, marker) {
    selected?.getElement()?.classList.remove('pin--on');
    selected = marker;
    marker.getElement()?.classList.add('pin--on');
    picked.replaceChildren(placeCard(listing, false));
  }

  async function refresh() {
    if (!map) return;
    const thisRun = ++run;
    const box = map.getBounds();
    status.textContent = 'Looking…';
    try {
      const found = await searchArea(filters, { south: box.getSouth(), west: box.getWest(), north: box.getNorth(), east: box.getEast() });
      if (thisRun !== run) return;
      layer.clearLayers();
      selected = null;
      picked.replaceChildren();
      for (const { listing, lat, lng } of spreadPins(found.items.filter((item) => item.approx_lat != null))) {
        const pin = L.divIcon({ className: 'pin', html: `<span class="pin__label">${pinPrice(listing)}</span>`, iconSize: null });
        const marker = L.marker([lat, lng], { icon: pin, keyboard: true, title: `${pinPrice(listing)}, ${listing.area}` });
        marker.on('click', () => select(listing, marker));
        marker.on('keypress', (event) => { if (event.originalEvent.key === 'Enter') select(listing, marker); });
        layer.addLayer(marker);
      }
      status.textContent = mapCountLine(found.items.length, found.total, filters.mode);
    } catch (error) {
      if (thisRun === run) status.textContent = friendlyListingError(error);
    }
  }

  // The map needs its box on the page before it can draw, so start it just after.
  setTimeout(async () => {
    try {
      L = await loadLeaflet();
    } catch (error) {
      status.textContent = `The map could not load. ${friendlyListingError(error)}`;
      return;
    }
    if (!holder.isConnected) return;
    const view = loadView();
    map = makeMap(L, holder).setView(view ? [view.lat, view.lng] : START_VIEW.center, view?.zoom ?? START_VIEW.zoom);
    layer = L.layerGroup().addTo(map);
    map.on('moveend', () => {
      const centre = map.getCenter();
      saveView({ lat: centre.lat, lng: centre.lng, zoom: map.getZoom() });
      clearTimeout(timer);
      timer = setTimeout(refresh, 300);
    });
    map.on('click', () => {
      selected?.getElement()?.classList.remove('pin--on');
      selected = null;
      picked.replaceChildren();
    });
    refresh();
  }, 0);

  return [
    topBar({ profile, session }),
    el('div', { class: 'segmented', role: 'group', 'aria-label': 'Rent or buy' }, switches.map(({ button }) => button)),
    controls,
    holder,
    status,
    picked,
    el('p', { class: 'field__hint', text: 'Pins show the area, within about 100 metres, never the house itself.' }),
    ...(session ? [tabBar('map')] : []),
  ];
}
