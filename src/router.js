// Turns the part of the address after "#" into a screen to show, and decides
// which screens need a signed-in person.
//
// Anyone can look around Explore ("#/"). The profile, listing a place and the
// review queue need an account: a signed-out person is sent to log in and
// brought back afterwards.
//
// Addresses:
//   #/my-listings            the owner's listings
//   #/list/new               start a listing (step 1)
//   #/list/<id>              a listing's details and photos (step 1)
//   #/list/<id>/tour         film the video tour (step 2)
//   #/list/<id>/send         check and send for review (step 3)
//   #/review                 the admins' review queue
//   #/review/<id>            check one listing
//   #/list/<id>/verify       Street Verified checks for a listing
//   #/review/check/<kind>/<id>  an admin's ID or ownership check
//   #/filters                Explore's filters (anyone)
//   #/map                    live listings on a map (anyone)
//   #/tours                  the tour feed (anyone)
//   #/saved                  saved places
//   #/enquiries              viewings and conversations
//   #/enquiries/<id>         one conversation
//   #/enquiries/<id>/check   the owner's view of a shared renter check
//   #/renter-check           your own renter check
//   #/review/reports         an admin's open reports
//   #/place/<id>             a live listing (anyone)

import { isUuid } from './listings/rules.js';

const EXPLORE = { screen: 'explore' };

/** Screens whose address is just their name, like "#/signin". */
const NAMED_SCREENS = ['signup', 'signin', 'forgot', 'new-password', 'profile', 'terms', 'privacy', 'my-listings', 'review', 'filters', 'map', 'enquiries', 'saved', 'tours', 'renter-check'];

/** Screens that only a signed-in person may open. */
export const PROTECTED_SCREENS = ['profile', 'new-password', 'my-listings', 'list-new', 'list-details', 'list-tour', 'list-send', 'review', 'review-listing', 'enquiries', 'enquiry', 'saved', 'list-verify', 'review-check', 'renter-check', 'enquiry-check', 'review-reports'];

/** Screens that make no sense once signed in. */
export const GUEST_SCREENS = ['signup', 'signin', 'forgot'];

/**
 * @param {string} hash the address hash, for example "#/signin"
 * @returns {{ screen: string, id?: string }}
 */
export function parseRoute(hash) {
  const parts = String(hash ?? '').replace(/^#/, '').split('/').filter(Boolean);
  if (parts.length === 1 && NAMED_SCREENS.includes(parts[0])) return { screen: parts[0] };
  if (parts[0] === 'list') {
    if (parts.length === 2 && parts[1] === 'new') return { screen: 'list-new' };
    if (parts.length === 2 && isUuid(parts[1])) return { screen: 'list-details', id: parts[1].toLowerCase() };
    if (parts.length === 3 && isUuid(parts[1]) && parts[2] === 'tour') return { screen: 'list-tour', id: parts[1].toLowerCase() };
    if (parts.length === 3 && isUuid(parts[1]) && parts[2] === 'send') return { screen: 'list-send', id: parts[1].toLowerCase() };
    if (parts.length === 3 && isUuid(parts[1]) && parts[2] === 'verify') return { screen: 'list-verify', id: parts[1].toLowerCase() };
  }
  if (parts[0] === 'review' && parts.length === 2 && parts[1] === 'reports') return { screen: 'review-reports' };
  if (parts[0] === 'review' && parts.length === 4 && parts[1] === 'check' && ['identity', 'ownership', 'income'].includes(parts[2]) && isUuid(parts[3])) {
    return { screen: 'review-check', kind: parts[2], id: parts[3].toLowerCase() };
  }
  if (parts[0] === 'review' && parts.length === 2 && isUuid(parts[1])) return { screen: 'review-listing', id: parts[1].toLowerCase() };
  if (parts[0] === 'enquiries' && parts.length === 2 && isUuid(parts[1])) return { screen: 'enquiry', id: parts[1].toLowerCase() };
  if (parts[0] === 'enquiries' && parts.length === 3 && isUuid(parts[1]) && parts[2] === 'check') return { screen: 'enquiry-check', id: parts[1].toLowerCase() };
  if (parts[0] === 'place' && parts.length === 2 && isUuid(parts[1])) return { screen: 'place', id: parts[1].toLowerCase() };
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
  switch (route.screen) {
    case 'explore': return '#/';
    case 'list-new': return '#/list/new';
    case 'list-details': return `#/list/${route.id}`;
    case 'list-tour': return `#/list/${route.id}/tour`;
    case 'list-send': return `#/list/${route.id}/send`;
    case 'list-verify': return `#/list/${route.id}/verify`;
    case 'review-check': return `#/review/check/${route.kind}/${route.id}`;
    case 'review-reports': return '#/review/reports';
    case 'review-listing': return `#/review/${route.id}`;
    case 'place': return `#/place/${route.id}`;
    case 'enquiry': return `#/enquiries/${route.id}`;
    case 'enquiry-check': return `#/enquiries/${route.id}/check`;
    default: return `#/${route.screen}`;
  }
}

/**
 * Check an address remembered as "where to go after logging in". Only a
 * well-formed address of a protected screen is accepted.
 * @returns {string | null}
 */
export function safeNext(hash) {
  if (typeof hash !== 'string') return null;
  const route = parseRoute(hash);
  const allowed = PROTECTED_SCREENS.includes(route.screen) || route.screen === 'place' || route.screen === 'tours';
  if (!allowed || route.screen === 'new-password') return null;
  return hashFor(route) === hash ? hash : null;
}

/** Which bottom-bar tab a screen belongs to, so it can be highlighted. */
export function tabFor(screen) {
  if (screen === 'map') return 'map';
  if (screen === 'saved') return 'saved';
  if (screen === 'enquiries' || screen === 'enquiry' || screen === 'enquiry-check') return 'enquiries';
  if (['profile', 'my-listings', 'list-new', 'list-details', 'list-tour', 'list-send', 'list-verify', 'review', 'review-listing', 'review-check', 'review-reports', 'renter-check'].includes(screen)) return 'profile';
  return 'explore';
}
