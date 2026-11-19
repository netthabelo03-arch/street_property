// Demo only: the bar above the app. Choose who you are (owner, admin or
// renter), follow the guide, and fill forms with sample details and photos.

import { becomePerson, isSignedOut } from './auth-api.js';
import { db, PEOPLE } from './state.js';
import { samplePhoto } from './media.js';

const PERSONAS = [
  { id: 'owner', label: 'Owner', who: PEOPLE.owner.full_name },
  { id: 'admin', label: 'Admin', who: 'Street Property checker' },
  { id: 'renter', label: 'Renter', who: PEOPLE.renter.full_name },
];

const GUIDE = [
  { persona: 'owner', hash: '#/my-listings', title: 'See your listings', text: 'Lerato has one listing live and one that the checker sent back for changes.' },
  { persona: 'owner', hash: '#/list/new', title: 'List a new place', text: 'Tap "Fill sample details", then "Add 5 sample photos", then Next.' },
  { persona: 'owner', hash: null, title: 'Film the video tour', text: 'Start camera (simulated here), pick a room, Record, then Stop after a few seconds. Film the outside and at least 3 rooms. Tap a filmed room to play it: the code is in the corner.' },
  { persona: 'owner', hash: null, title: 'Send it for checking', text: 'Next: check and send, then Send for checking.' },
  { persona: 'admin', hash: '#/review', title: 'Check it as the admin', text: 'Open a listing, watch the clips (one in the Mamelodi house was filmed 17 km away), then Approve or Ask for changes.' },
  { persona: 'owner', hash: '#/my-listings', title: 'Back to the owner', text: 'Approved listings show Live; sent-back ones show the checker\'s note.' },
  { persona: 'renter', hash: '#/list/new', title: 'Try it as a renter', text: 'Renters cannot list a place; they are sent to their profile.' },
];

function make(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

function go(persona, hash) {
  if (hash) window.location.hash = hash;
  becomePerson(persona);
  drawPersonas();
}

// Personas
const personaButtons = PERSONAS.map((item) => {
  const button = make('button', { type: 'button', class: 'demo-bar__persona' }, [
    make('span', { class: 'demo-bar__persona-role', text: item.label }),
    make('span', { class: 'demo-bar__persona-who', text: item.who }),
  ]);
  button.addEventListener('click', () => go(item.id, null));
  return { item, button };
});
function drawPersonas() {
  for (const { item, button } of personaButtons) button.setAttribute('aria-pressed', String(!isSignedOut() && db.persona === item.id));
}

// Guide
const guide = make('ol', { class: 'demo-guide' }, GUIDE.map((step) => {
  const parts = [make('p', { class: 'demo-guide__title', text: step.title }), make('p', { class: 'demo-guide__text', text: step.text })];
  if (step.hash) {
    const button = make('button', { type: 'button', class: 'demo-bar__small', text: `Go as ${PERSONAS.find((p) => p.id === step.persona).label.toLowerCase()}` });
    button.addEventListener('click', () => { guide.hidden = true; guideToggle.setAttribute('aria-expanded', 'false'); go(step.persona, step.hash); });
    parts.push(button);
  }
  return make('li', {}, parts);
}));
guide.hidden = true;
const guideToggle = make('button', { type: 'button', class: 'demo-bar__small', 'aria-expanded': 'false', text: 'Guide' });
guideToggle.addEventListener('click', () => {
  guide.hidden = !guide.hidden;
  guideToggle.setAttribute('aria-expanded', String(!guide.hidden));
});
const restart = make('button', { type: 'button', class: 'demo-bar__small', text: 'Start again' });
restart.addEventListener('click', () => {
  window.location.hash = '#/my-listings';
  window.location.reload();
});

// Helpers for the listing form
const helpers = make('div', { class: 'demo-bar__helpers' });

function fillDetails() {
  const set = (id, value) => {
    const input = document.getElementById(id);
    if (input) input.value = value;
  };
  [...document.querySelectorAll('.segmented__option')].find((b) => b.textContent === 'Rent it out')?.click();
  [...document.querySelectorAll('.choice')].find((b) => b.textContent === 'Flat')?.click();
  set('street', '9 Mahalefele Road');
  set('area', 'Dube');
  set('city', 'Soweto');
  set('price', '3 900');
  set('deposit', '3900');
  set('description', 'Sunny 2-bed flat, walking distance to Dube station and the clinic. Prepaid electricity, secure parking for one car.');
  const plus = document.querySelector('[aria-label="One more: Bedrooms"]');
  const value = () => Number(document.getElementById('bedrooms-value')?.textContent);
  for (let i = 0; i < 5 && value() < 2; i += 1) plus?.click();
  const parkingPlus = document.querySelector('[aria-label="One more: Parking bays"]');
  if (Number(document.getElementById('parking-value')?.textContent) < 1) parkingPlus?.click();
  for (const id of ['prepaid', 'power_backup', 'security']) {
    const box = document.getElementById(`feature-${id}`);
    if (box) box.checked = true;
  }
}

async function addPhotos(button) {
  const picker = document.getElementById('photo-picker');
  if (!picker) return;
  button.disabled = true;
  button.textContent = 'Making photos…';
  const set = [['outside', 'Outside'], ['lounge', 'Lounge'], ['kitchen', 'Kitchen'], ['bedroom', 'Bedroom 1'], ['bathroom', 'Bathroom']];
  const files = [];
  for (const [index, [scene, label]] of set.entries()) {
    const blob = await samplePhoto(scene, label, 0.25 + index * 0.12);
    files.push(new File([blob], `${label.toLowerCase().replace(/\s+/g, '-')}.jpg`, { type: 'image/jpeg' }));
  }
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  picker.files = transfer.files;
  picker.dispatchEvent(new Event('change'));
  button.disabled = false;
  button.textContent = 'Add 5 sample photos';
}

function drawHelpers() {
  const hash = window.location.hash;
  const onForm = /^#\/list\/(new|[0-9a-f-]{36})$/i.test(hash) && document.getElementById('street');
  const onTour = /^#\/list\/[0-9a-f-]{36}\/tour$/i.test(hash);
  const items = [];
  if (onForm) {
    const fill = make('button', { type: 'button', class: 'demo-bar__small demo-bar__small--accent', text: 'Fill sample details' });
    fill.addEventListener('click', fillDetails);
    const photos = make('button', { type: 'button', class: 'demo-bar__small demo-bar__small--accent', text: 'Add 5 sample photos' });
    photos.addEventListener('click', () => addPhotos(photos));
    items.push(fill, photos);
  } else if (onTour) {
    items.push(make('p', { class: 'demo-bar__tip', text: 'The camera and your location are simulated in the demo: you are "standing" outside the place. Recording, the code in the corner and the 30-second and 2-minute limits are real.' }));
  }
  helpers.replaceChildren(...items);
  helpers.hidden = items.length === 0;
}

const bar = make('section', { class: 'demo-bar', 'aria-label': 'Demo controls' }, [
  make('div', { class: 'demo-bar__top' }, [
    make('span', { class: 'demo-bar__badge', text: 'Demo' }),
    make('span', { class: 'demo-bar__note', text: 'Sample data, nothing saved' }),
    guideToggle,
    restart,
  ]),
  make('div', { class: 'demo-bar__personas', role: 'group', 'aria-label': 'Who you are in the demo' }, personaButtons.map(({ button }) => button)),
  guide,
  helpers,
]);

document.body.prepend(bar);
drawPersonas();
drawHelpers();
window.addEventListener('hashchange', () => setTimeout(() => { drawPersonas(); drawHelpers(); }, 0));
new MutationObserver(() => { drawPersonas(); drawHelpers(); }).observe(document.getElementById('app'), { childList: true });
if (!window.location.hash || window.location.hash === '#/' || window.location.hash === '#') window.location.hash = '#/my-listings';
