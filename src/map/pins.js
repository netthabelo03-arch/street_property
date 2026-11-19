// Small pure helpers for the map: price labels on pins and the map area.

/** Short price for a pin: R4 500 (rent), R895k or R1.45m (sale). */
export function pinPrice(listing) {
  const value = Math.round(Number(listing.price_rands) || 0);
  if (listing.mode === 'rent' || value < 10000) return `R${value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
  if (value < 1000000) return `R${Math.round(value / 1000)}k`;
  return `R${(value / 1000000).toFixed(2).replace(/\.?0+$/, '')}m`;
}

/** The map's visible area as search arguments, a little wider so pins at the edge stay. */
export function areaArgs(bounds, pad = 0.05) {
  const latPad = (bounds.north - bounds.south) * pad;
  const lngPad = (bounds.east - bounds.west) * pad;
  return {
    p_south: bounds.south - latPad,
    p_north: bounds.north + latPad,
    p_west: bounds.west - lngPad,
    p_east: bounds.east + lngPad,
  };
}

/** The line under the map. */
export function mapCountLine(shown, total, mode) {
  const what = mode === 'rent' ? 'to rent' : 'for sale';
  if (total === 0) return `No places ${what} in this area. Move the map or zoom out.`;
  if (shown < total) return `Showing the ${shown} newest of ${total} places ${what} here. Zoom in to see more.`;
  return `${total} place${total === 1 ? '' : 's'} ${what} here`;
}

/** Listings rounded to the same spot get a small nudge, so their pins do not hide each other. */
export function spreadPins(listings) {
  const seen = new Map();
  return listings.map((listing) => {
    const key = `${listing.approx_lat},${listing.approx_lng}`;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (count === 0) return { listing, lat: listing.approx_lat, lng: listing.approx_lng };
    const angle = count * 2.4;
    const step = 0.0004 * Math.ceil(count / 6);
    return { listing, lat: listing.approx_lat + Math.sin(angle) * step, lng: listing.approx_lng + Math.cos(angle) * step };
  });
}

// The map's last view, for coming back to the same place this visit.
const KEY = 'street-property-map-view';
export function loadView() {
  try {
    const view = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    if (view && Number.isFinite(view.lat) && Number.isFinite(view.lng) && Number.isInteger(view.zoom)) return view;
  } catch {
    // no saved view
  }
  return null;
}
export function saveView(view) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    // private browsing
  }
}
