// Starts the app: finds out whether someone is signed in, shows the right
// screen for the address, and keeps both in step.

import { parseRoute, resolveRoute, hashFor, PROTECTED_SCREENS, GUEST_SCREENS } from './router.js';
import { currentSession, onAuthChange } from './auth/api.js';
import { saveNext, takeNext } from './next.js';
import { el, brand } from './dom.js';
import { renderExplore } from './screens/explore.js';
import { renderSignUp } from './screens/signup.js';
import { renderSignIn } from './screens/signin.js';
import { renderForgot } from './screens/forgot.js';
import { renderNewPassword } from './screens/newpassword.js';
import { renderProfile } from './screens/profile.js';
import { renderTerms, renderPrivacy } from './screens/legal.js';
import { renderMyListings } from './screens/mylistings.js';
import { renderListDetails } from './screens/listdetails.js';
import { renderListTour } from './screens/listtour.js';
import { renderListSend } from './screens/listsend.js';
import { renderReviewQueue, renderReviewListing } from './screens/review.js';
import { renderFilters } from './screens/filters.js';
import { renderPlace } from './screens/place.js';
import { renderMap } from './screens/map.js';
import { renderEnquiries } from './screens/enquiries.js';
import { renderConversation } from './screens/conversation.js';
import { renderTours } from './screens/tours.js';
import { renderSaved } from './screens/saved.js';
import { forgetViewer } from './viewer.js';

const SCREENS = {
  explore: renderExplore,
  signup: renderSignUp,
  signin: renderSignIn,
  forgot: renderForgot,
  'new-password': renderNewPassword,
  profile: renderProfile,
  terms: renderTerms,
  privacy: renderPrivacy,
  'my-listings': renderMyListings,
  'list-new': renderListDetails,
  'list-details': renderListDetails,
  'list-tour': renderListTour,
  'list-send': renderListSend,
  review: renderReviewQueue,
  'review-listing': renderReviewListing,
  filters: renderFilters,
  place: renderPlace,
  map: renderMap,
  enquiries: renderEnquiries,
  enquiry: renderConversation,
  tours: renderTours,
  saved: renderSaved,
};

const root = document.getElementById('app');
let session = null;
let latestRender = 0;

function navigate(hash) {
  window.location.hash = hash;
}

function loadingScreen() {
  return [brand(), el('p', { class: 'lead', role: 'status', text: 'Loading…' })];
}

async function show() {
  const asked = parseRoute(window.location.hash);
  const signedIn = session !== null;
  const route = resolveRoute(asked, signedIn);
  if (route.screen !== asked.screen) {
    if (!signedIn && PROTECTED_SCREENS.includes(asked.screen)) {
      saveNext(hashFor(asked));
      navigate(hashFor(route));
    } else {
      navigate(takeNext() ?? hashFor(route));
    }
    return;
  }
  document.body.classList.toggle('guest-screen', GUEST_SCREENS.includes(route.screen));

  // A slow screen may finish after the person has moved on: only draw the newest.
  const thisRender = ++latestRender;
  const pending = SCREENS[route.screen]({ session, navigate, route });
  if (pending instanceof Promise && root.childElementCount === 0) root.replaceChildren(...loadingScreen());
  let content;
  try {
    content = await pending;
  } catch {
    const retry = el('button', { type: 'button', class: 'button button--primary', text: 'Try again' });
    retry.addEventListener('click', show);
    content = [
      brand(),
      el('h1', { class: 'title', text: 'This screen could not be shown' }),
      el('p', { class: 'message message--error', role: 'alert', text: navigator.onLine === false ? 'You are offline. Connect to the internet and try again.' : 'Something went wrong while loading it. Check your connection and try again.' }),
      el('div', { class: 'link-row' }, [retry, el('a', { href: '#/', class: 'button button--quiet', text: 'Back to Explore' })]),
    ];
  }
  if (thisRender !== latestRender) return;
  root.replaceChildren(...content);
  root.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

async function start() {
  root.replaceChildren(...loadingScreen());
  try {
    session = await currentSession();
    if (session !== null) {
      const next = takeNext();
      if (next) navigate(next);
    }
    await onAuthChange((event, newSession) => {
      const before = session?.user?.id ?? null;
      const after = newSession?.user?.id ?? null;
      session = newSession;
      // Routine events (such as refreshing the session) must not wipe a half-filled form.
      if (event !== 'PASSWORD_RECOVERY' && before === after) return;
      forgetViewer();
      setTimeout(() => {
        if (event === 'PASSWORD_RECOVERY') navigate('#/new-password');
        else if (before === null && after !== null) {
          const next = takeNext();
          if (next) navigate(next);
        } else if (after === null) navigate('#/');
        show();
      }, 0);
    });
  } catch {
    // Accounts not reachable (or not set up yet): browsing still works.
    session = null;
  }
  window.addEventListener('hashchange', show);
  watchConnection();
  show();
}

/** A bar across the top while offline, so a screen that will not load is not a mystery. */
function watchConnection() {
  const bar = el('p', { class: 'offline-bar', role: 'status', text: 'You are offline. Some things will not load until you are back online.' });
  bar.hidden = navigator.onLine !== false;
  document.body.prepend(bar);
  window.addEventListener('offline', () => { bar.hidden = false; });
  window.addEventListener('online', () => { bar.hidden = true; });
}

start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
