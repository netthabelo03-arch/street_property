// Terms and Privacy: placeholders until a lawyer has written them. They say
// so plainly rather than pretend to be final.

import { el, brand, linkTo } from '../dom.js';

function page(title, points) {
  return [
    brand(),
    el('h1', { class: 'title', text: title }),
    el('p', { class: 'notice', text: 'Draft. This page will be replaced by the final version, reviewed by a lawyer, before Street Property opens to the public.' }),
    el('ul', { class: 'plain-list' }, points.map((text) => el('li', { text }))),
    linkTo('#/', 'Back to Explore'),
  ];
}

export function renderTerms() {
  return page('Terms', [
    'Street Property connects people who rent, buy, own and let homes in South Africa.',
    'Only list a place you own, or that you are mandated to let as a registered agent.',
    'Never ask for or pay money outside the app.',
    'Details: [to be written]',
  ]);
}

export function renderPrivacy() {
  return page('Privacy', [
    'We keep your email, name and the role you choose.',
    'Identity and income checks will keep only the result, never your documents.',
    'Responsible party and Information Officer: [to be named]',
    'Details: [to be written]',
  ]);
}
