// Turns the part of the address after "#" into a screen to show, and decides
// which screens need a signed-in person.
//
// Anyone can look around Explore ("#/"). The profile needs an account: a
// signed-out person is sent to log in and brought back afterwards.

const EXPLORE = { screen: 'explore' };

/** Screens whose address is just their name, like "#/signin". */
const NAMED_SCREENS = ['signup', 'signin', 'forgot', 'new-password', 'profile', 'terms', 'privacy'];

/** Screens that only a signed-in person may open. */
export const PROTECTED_SCREENS = ['profile', 'new-password'];

/** Screens that make no sense once signed in. */
export const GUEST_SCREENS = ['signup', 'signin', 'forgot'];

/**
 * @param {string} hash the address hash, for example "#/signin"
 * @returns {{ screen: string }}
 */
export function parseRoute(hash) {
  const parts = String(hash ?? '').replace(/^#/, '').split('/').filter(Boolean);
  if (parts.length === 1 && NAMED_SCREENS.includes(parts[0])) return { screen: parts[0] };
  // Anything unknown falls back to Explore instead of a blank page.
  return EXPLORE;
}

/**
 * Apply the sign-in rules: a signed-out person asking for a protected screen
 * is sent to log in; a signed-in person asking for a log-in screen goes to Explore.
 */
export function resolveRoute(route, signedIn) {
  if (!signedIn && PROTECTED_SCREENS.includes(route.screen)) return { screen: 'signin' };
  if (signedIn && GUEST_SCREENS.includes(route.screen)) return EXPLORE;
  return route;
}

/** @returns {string} the address hash for a route */
export function hashFor(route) {
  return route.screen === 'explore' ? '#/' : `#/${route.screen}`;
}

/**
 * Check an address remembered as "where to go after logging in". Only a
 * well-formed address of a protected screen is accepted.
 * @returns {string | null}
 */
export function safeNext(hash) {
  if (typeof hash !== 'string') return null;
  const route = parseRoute(hash);
  if (!PROTECTED_SCREENS.includes(route.screen) || route.screen === 'new-password') return null;
  return hashFor(route) === hash ? hash : null;
}

/** Which bottom-bar tab a screen belongs to, so it can be highlighted. */
export function tabFor(screen) {
  if (screen === 'profile') return 'profile';
  return 'explore';
}
