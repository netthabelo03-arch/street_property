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
    'Every listing is checked before it goes live, including a video tour filmed at the address in the app.',
    'Never ask for, or pay, a deposit or rent before a viewing and a signed lease. Report anyone who does.',
    'Messages are for the place you asked about: no spam, no abuse, no selling other services.',
    'We may remove listings and close accounts that break these rules.',
    'Details: [to be written]',
  ]);
}

export function renderPrivacy() {
  return page('Privacy', [
    'We keep your email, name and the role you choose, and your cell number if you add it.',
    'Your cell number is shown to someone else only if you switch on WhatsApp sharing, and then only to a person whose viewing with you is confirmed, until two days after it.',
    'Listings show the street name and the area, never the house number or the exact spot. The full address is shown to a renter once a viewing is confirmed.',
    'Messages are seen only by the two people in the conversation. If one of you reports a conversation, our team may read it to deal with the report.',
    'Video tours save where each clip was filmed. Only the owner and our checkers can see that.',
    'Identity and income checks will keep only the result, never your documents.',
    'Responsible party and Information Officer: [to be named]',
    'Details: [to be written]',
  ]);
}
