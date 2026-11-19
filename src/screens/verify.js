// "Prove your place is real": the three Street Verified checks for one
// listing, as in the design. The owner (or agent) sends photos and documents
// here; admins check them by hand and the badge appears when all three pass.

import { loadViewer } from '../viewer.js';
import { getListing } from '../listings/api.js';
import { listingTitle, isEditable } from '../listings/rules.js';
import { myVerification, uploadDoc, removeDocs, submitIdentity, submitOwnership } from '../verify/api.js';
import { checkStates, ownershipNeeds, checkDocFile, badgeLine } from '../verify/rules.js';
import { friendlyListingError } from '../listings/errors.js';
import { topBar, tabBar } from '../shell.js';
import { el, icon, messageBox, whileBusy } from '../dom.js';
import { notFound } from './listing-parts.js';

const BADGE = '<path d="M12 3l8 3v6c0 5-3.5 8.5-8 9.5C7.5 20.5 4 17 4 12V6z"></path><path d="M8.5 12l2.5 2.5 4.5-5"></path>';

/** A labelled file picker that remembers the chosen file. */
export function picker({ id, label, capture }) {
  // The ID and selfie are photos taken now; documents can also be PDFs.
  const input = el('input', { type: 'file', id, class: 'file__input', accept: capture ? 'image/*' : 'image/*,application/pdf' });
  if (capture) input.setAttribute('capture', capture);
  const chosen = el('span', { class: 'file__chosen', text: 'No file chosen' });
  input.addEventListener('change', () => {
    chosen.textContent = input.files[0] ? input.files[0].name : 'No file chosen';
  });
  const node = el('div', { class: 'file' }, [
    el('label', { for: id, class: 'field__label', text: label }),
    el('label', { for: id, class: 'button button--quiet file__button', text: capture ? 'Take a photo' : 'Choose photo or file' }),
    input,
    chosen,
  ]);
  return { node, file: () => input.files[0] ?? null };
}

export async function renderVerify({ session, route }) {
  const { profile } = await loadViewer(session);
  const bar = topBar({ profile, session });
  const listing = await getListing(route.id, { private: true });
  if (!listing || listing.owner_id !== session.user.id) return notFound(bar, tabBar('profile'));
  const v = await myVerification(listing.id);
  const states = checkStates(v);
  const state = (id) => states.find((check) => check.id === id);
  const message = messageBox();
  const me = session.user.id;
  // Show the screen again with the new state (the address stays the same).
  const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

  async function send(button, uploads, submit) {
    message.clear();
    for (const { file } of uploads) {
      const problem = checkDocFile(file());
      if (problem) {
        message.show(problem);
        return;
      }
    }
    await whileBusy(button, 'Sending…', async () => {
      const paths = [];
      try {
        for (const { file, folder } of uploads) paths.push(await uploadDoc(me, folder, file()));
        await submit(paths);
        reload();
      } catch (error) {
        await removeDocs(paths).catch(() => {});
        message.show(friendlyListingError(error));
      }
    });
  }

  function card(n, title, body, check, action) {
    return el('li', { class: `check-card check-card--${check.state}` }, [
      el('span', { class: 'check-card__n', 'aria-hidden': 'true', text: check.state === 'done' ? '✓' : String(n) }),
      el('div', { class: 'stack stack--tight check-card__body' }, [
        el('div', { class: 'check-card__top' }, [
          el('p', { class: 'check-card__title', text: title }),
          el('span', { class: `chip ${check.chip}`, text: check.label }),
        ]),
        el('p', { class: 'check-card__text', text: body }),
        ...(check.note ? [el('p', { class: 'message message--error', text: `Why: ${check.note}` })] : []),
        ...(action ? [action] : []),
      ]),
    ]);
  }

  // 1. ID and selfie
  let idAction = null;
  if (['needed', 'rejected'].includes(state('identity').state)) {
    const idFile = picker({ id: 'id-photo', label: 'Your South African ID or passport (the photo page)', capture: 'environment' });
    const selfie = picker({ id: 'selfie', label: 'A selfie, face clearly visible', capture: 'user' });
    const go = el('button', { type: 'button', class: 'button button--primary', text: 'Send my ID for checking' });
    go.addEventListener('click', () => send(go, [
      { file: idFile.file, folder: 'identity' },
      { file: selfie.file, folder: 'identity' },
    ], ([idPath, selfiePath]) => submitIdentity(idPath, selfiePath)));
    idAction = el('div', { class: 'stack' }, [idFile.node, selfie.node, go]);
  } else if (state('identity').state === 'done') {
    idAction = el('p', { class: 'field__hint', text: 'Checked once for all your listings.' });
  }

  // 2. Proof of ownership (or, for agents, FFC and mandate)
  const needs = ownershipNeeds(listing.lister);
  let ownAction = null;
  if (['needed', 'rejected'].includes(state('ownership').state)) {
    const slots = needs.slots.map((slot) => ({ slot, pick: picker({ id: `own-${slot.id}`, label: slot.label, capture: null }) }));
    const go = el('button', { type: 'button', class: 'button button--primary', text: 'Send proof for checking' });
    go.addEventListener('click', () => send(go, slots.map(({ pick }) => ({ file: pick.file, folder: `${listing.id}/ownership` })),
      (paths) => submitOwnership(listing.id, paths)));
    ownAction = el('div', { class: 'stack' }, [...slots.map(({ pick }) => pick.node), go]);
  }

  // 3. On site: the video tour already proves it.
  let siteAction = null;
  if (state('on_site').state !== 'done') {
    siteAction = isEditable(listing.status)
      ? el('a', { href: `#/list/${listing.id}/tour`, class: 'button button--quiet', text: 'Film the outside at the address' })
      : el('p', { class: 'field__hint', text: 'Stop the review or take the listing down to film the tour again.' });
  }

  const earned = Boolean(v?.verified_at);
  return [
    bar,
    el('a', { href: `#/list/${listing.id}/send`, class: 'text-link', text: `← ${listingTitle(listing)}` }),
    el('p', { class: 'eyebrow', text: 'Street Safe' }),
    el('h1', { class: 'title', text: 'Prove your place is real' }),
    el('p', { class: 'lead', text: 'Three checks earn your listing the Street Verified badge. Renters trust it, so verified places get more serious enquiries.' }),
    el('ol', { class: 'check-list' }, [
      card(1, 'Your ID', 'A photo of your South African ID or passport, and a selfie so we know it is you.', state('identity'), idAction),
      card(2, 'Proof you own it', listing.lister === 'agent'
        ? 'Agents send their Fidelity Fund Certificate and the owner’s signed mandate for this place.'
        : 'Your title deed or the municipal rates account for this address, in your name.', state('ownership'), ownAction),
      card(3, 'Check in at the property', 'Your video tour, filmed in the app at the address with the day’s code, proves the place exists and you have access.', state('on_site'), siteAction),
    ]),
    message.node,
    el('div', { class: `badge-preview${earned ? ' badge-preview--earned' : ''}` }, [
      el('span', { class: 'badge-preview__icon' }, [icon(BADGE, 28)]),
      el('div', {}, [
        el('p', { class: 'badge-preview__title', text: 'Street Verified' }),
        el('p', { class: 'badge-preview__line', text: badgeLine(v) }),
      ]),
    ]),
    el('p', { class: 'note', text: 'Your documents are only used for these checks and are deleted as soon as each check is done. Renters see the badge, never your ID or title deed.' }),
    tabBar('profile'),
  ];
}
