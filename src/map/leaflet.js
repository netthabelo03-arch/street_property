// Loads the map library (Leaflet) the first time a map is shown, and sets the
// map tiles in one place.
//
// Tiles: OpenStreetMap's own servers, which are fine while traffic is small.
// Before launch, switch TILES to a paid or free-tier provider with an API key
// (for example MapTiler or Stadia Maps); nothing else needs to change.

const LEAFLET_JS = {
  src: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  integrity: 'sha384-NElt3Op+9NBMCYaef5HxeJmU4Xeard/Lku8ek6hoPTvYkQPh3zLIrJP7KiRocsxO',
};
const LEAFLET_CSS = {
  href: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  integrity: 'sha384-c6Rcwz4e4CITMbu/NBmnNS8yN2sC3cUElMEMfP3vqqKFp7GOYaaBBCqmaWBjmkjb',
};

export const TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
};

/** Johannesburg and Soweto, for a first visit. */
export const START_VIEW = { center: [-26.15, 28.0], zoom: 10 };

let loading = null;

/** @returns {Promise<object>} the Leaflet library (window.L) */
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = LEAFLET_CSS.href;
    css.integrity = LEAFLET_CSS.integrity;
    css.crossOrigin = 'anonymous';
    document.head.append(css);
    const script = document.createElement('script');
    script.src = LEAFLET_JS.src;
    script.integrity = LEAFLET_JS.integrity;
    script.crossOrigin = 'anonymous';
    script.onload = () => (window.L ? resolve(window.L) : reject(new Error('Map did not load')));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new TypeError('Failed to fetch the map'));
    };
    document.head.append(script);
  });
  return loading;
}

/** A map in `node`, with the tiles and our attribution. */
export function makeMap(L, node, options = {}) {
  const map = L.map(node, { zoomControl: true, attributionControl: true, ...options });
  L.tileLayer(TILES.url, { attribution: TILES.attribution, maxZoom: TILES.maxZoom }).addTo(map);
  map.attributionControl.setPrefix(false);
  return map;
}
