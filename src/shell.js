// The frame around every screen: the bar at the top (logo, and Log in or the
// person's name) and the tab bar at the bottom on signed-in screens.

import { signOut } from './auth/api.js';
import { friendlyAuthError } from './auth/errors.js';
import { findRole } from './roles.js';
import { el, icon, brand, whileBusy } from './dom.js';

const ICONS = {
  explore: '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"></path>',
  saved: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"></path>',
  enquiries: '<path d="M4 5h16v11H9l-5 4z"></path>',
  profile: '<circle cx="12" cy="8" r="4"></circle><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"></path>',
};

/**
 * The tabs at the bottom. Tabs for features still to come are shown greyed
 * out, so the layout people learn now stays the same as features arrive.
 * @returns {{ id: string, text: string, href: string | null }[]}
 */
export function tabs() {
  return [
    { id: 'explore', text: 'Explore', href: '#/' },
    { id: 'map', text: 'Map', href: '#/map' },
    { id: 'saved', text: 'Saved', href: null },
    { id: 'enquiries', text: 'Enquiries', href: null },
    { id: 'profile', text: 'Profile', href: '#/profile' },
  ];
}

/** The name on the top bar: first name, else the email name, else "Account". */
export function displayName(profile, session) {
  const first = String(profile?.full_name ?? '').trim().split(/\s+/)[0];
  if (first) return first;
  const emailName = String(session?.user?.email ?? '').split('@')[0];
  return emailName || 'Account';
}

/** The top bar. Signed out: Sign up and Log in. Signed in: name, role and Log out. */
export function topBar({ profile, session }) {
  if (!session) {
    return el('header', { class: 'topbar' }, [
      brand(),
      el('div', { class: 'topbar__actions' }, [
        el('a', { href: '#/signup', class: 'topbar__link', text: 'Sign up' }),
        el('a', { href: '#/signin', class: 'button button--primary button--small', text: 'Log in' }),
      ]),
    ]);
  }
  const role = findRole(profile?.role);
  const logOut = el('button', { type: 'button', class: 'topbar__link', text: 'Log out' });
  const error = el('p', { class: 'field__error', role: 'alert' });
  error.hidden = true;
  logOut.addEventListener('click', () => whileBusy(logOut, 'Logging out…', async () => {
    error.hidden = true;
    try {
      await signOut();
    } catch (problem) {
      error.textContent = friendlyAuthError(problem);
      error.hidden = false;
    }
  }));
  return el('header', { class: 'topbar' }, [
    brand(),
    el('div', { class: 'topbar__actions' }, [
      el('a', { href: '#/profile', class: 'topbar__who' }, [
        el('span', { class: 'topbar__name', text: displayName(profile, session) }),
        ...(role ? [el('span', { class: 'chip chip--good', text: role.short })] : []),
      ]),
      logOut,
    ]),
    error,
  ]);
}

/** The tab bar at the bottom, with the current tab marked. */
export function tabBar(current) {
  return el('nav', { class: 'tabbar', 'aria-label': 'Main' }, tabs().map((tab) => {
    const content = [icon(ICONS[tab.id], 24), el('span', { text: tab.text })];
    if (!tab.href) {
      return el('span', { class: 'tabbar__tab tabbar__tab--soon', title: 'Coming soon', 'aria-disabled': 'true' }, content);
    }
    const link = el('a', { href: tab.href, class: 'tabbar__tab' }, content);
    if (tab.id === current) link.setAttribute('aria-current', 'page');
    return link;
  }));
}
