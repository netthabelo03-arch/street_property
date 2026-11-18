// Step 1 of listing a place: the details and the photos. Used for a new
// listing ("#/list/new") and to edit one ("#/list/<id>").
//
// Photos picked before the listing is first saved are kept on the phone and
// uploaded right after the save.

import { loadViewer } from '../viewer.js';
import { canList, findRole } from '../roles.js';
import { getListing, createListing, updateListing, listPhotos, addPhoto, removePhoto, reorderPhotos } from '../listings/api.js';
import { MODES, KINDS, FEATURES, PHOTOS, DESCRIPTION_MAX, checkDetails, isEditable, STATUSES } from '../listings/rules.js';
import { friendlyListingError } from '../listings/errors.js';
import { shrinkPhoto } from '../media/photos.js';
import { topBar, tabBar } from '../shell.js';
import { el, field, messageBox, whileBusy } from '../dom.js';
import { stepHeader, counter, notFound, notALister } from './listing-parts.js';

export async function renderListDetails({ session, navigate, route }) {
  const { profile } = await loadViewer(session);
  const bar = topBar({ profile, session });
  if (!canList(profile?.role)) return notALister(bar, tabBar('profile'));

  let listing = null;
  let photos = [];
  if (route.id) {
    listing = await getListing(route.id);
    if (!listing || listing.owner_id !== session.user.id) return notFound(bar, tabBar('profile'));
    if (!isEditable(listing.status)) {
      return [
        bar,
        stepHeader(listing.id, 'details'),
        el('h1', { class: 'title', text: 'This listing is locked' }),
        el('p', { class: 'lead', text: `${STATUSES[listing.status].about} To change it, stop the review or take it down first.` }),
        el('a', { href: `#/list/${listing.id}/send`, class: 'button button--primary', text: 'Open the listing' }),
        tabBar('profile'),
      ];
    }
    photos = await listPhotos(listing.id);
  }
  /** Photos picked before the first save: { blob, url } */
  const waiting = [];
  const message = messageBox();

  // I want to: rent or sell
  let mode = listing?.mode ?? 'rent';
  const modeButtons = MODES.map((item) => {
    const button = el('button', { type: 'button', class: 'segmented__option', text: item.label });
    button.addEventListener('click', () => { mode = item.id; updateMode(); });
    return { item, button };
  });

  // Type of place
  let kind = listing?.kind ?? null;
  const kindError = el('p', { class: 'field__error', id: 'kind-error' });
  kindError.hidden = true;
  const kindButtons = KINDS.map((item) => {
    const button = el('button', { type: 'button', class: 'choice', text: item.label });
    button.addEventListener('click', () => { kind = item.id; updateKind(); });
    return { item, button };
  });
  function updateKind() {
    for (const { item, button } of kindButtons) button.setAttribute('aria-pressed', String(item.id === kind));
  }
  updateKind();

  const street = field({ id: 'street', label: 'Street address', autocomplete: 'street-address', value: listing?.street ?? '' });
  const area = field({ id: 'area', label: 'Suburb or township', value: listing?.area ?? '' });
  const city = field({ id: 'city', label: 'City or town', autocomplete: 'address-level2', value: listing?.city ?? '' });
  const price = field({ id: 'price', label: 'Rent per month (R)', value: listing?.price_rands ? String(listing.price_rands) : '' });
  price.input.inputMode = 'numeric';
  const deposit = field({ id: 'deposit', label: 'Deposit (R, optional)', value: listing?.deposit_rands != null ? String(listing.deposit_rands) : '' });
  deposit.input.inputMode = 'numeric';
  const available = field({ id: 'available', label: 'Available from (optional)', type: 'date', value: listing?.available_from ?? '' });

  const bedrooms = counter({ id: 'bedrooms', label: 'Bedrooms', value: listing?.bedrooms ?? 1 });
  const bathrooms = counter({ id: 'bathrooms', label: 'Bathrooms', value: listing?.bathrooms ?? 1 });
  const parking = counter({ id: 'parking', label: 'Parking bays', value: listing?.parking ?? 0 });

  const featureBoxes = FEATURES.map((item) => {
    const box = el('input', { type: 'checkbox', id: `feature-${item.id}`, class: 'check__box' });
    box.checked = (listing?.features ?? []).includes(item.id);
    return { item, box, node: el('label', { class: 'check', for: `feature-${item.id}` }, [box, el('span', { text: item.label })]) };
  });

  const description = el('textarea', { id: 'description', class: 'input input--area', rows: '5', maxlength: String(DESCRIPTION_MAX) });
  description.value = listing?.description ?? '';
  const descriptionError = el('p', { class: 'field__error', id: 'description-error' });
  descriptionError.hidden = true;

  function updateMode() {
    for (const { item, button } of modeButtons) button.setAttribute('aria-pressed', String(item.id === mode));
    price.node.querySelector('label').textContent = MODES.find((item) => item.id === mode).priceLabel;
    deposit.node.hidden = mode !== 'rent';
    available.node.hidden = mode !== 'rent';
  }
  updateMode();

  // Photos
  const photoGrid = el('ul', { class: 'photo-grid', 'aria-label': 'Photos' });
  const photoCount = el('p', { class: 'field__hint' });
  const photoMessage = messageBox();
  const picker = el('input', { type: 'file', id: 'photo-picker', accept: 'image/*', multiple: '', class: 'visually-hidden' });
  const addButton = el('label', { for: 'photo-picker', class: 'button button--quiet photo-add', text: 'Add photos' });

  function drawPhotos() {
    const shown = [...photos.map((photo) => ({ saved: photo, url: photo.url })), ...waiting.map((item) => ({ waiting: item, url: item.url }))];
    photoGrid.replaceChildren(...shown.map((item, index) => {
      const remove = el('button', { type: 'button', class: 'photo-grid__button', 'aria-label': `Remove photo ${index + 1}`, text: '✕' });
      remove.addEventListener('click', () => whileBusy(remove, '…', async () => {
        photoMessage.clear();
        try {
          if (item.saved) {
            await removePhoto(item.saved);
            photos = photos.filter((photo) => photo !== item.saved);
          } else {
            waiting.splice(waiting.indexOf(item.waiting), 1);
            URL.revokeObjectURL(item.url);
          }
          drawPhotos();
        } catch (error) {
          photoMessage.show(friendlyListingError(error));
        }
      }));
      const controls = [remove];
      if (index > 0 && item.saved) {
        const first = el('button', { type: 'button', class: 'photo-grid__button photo-grid__button--first', 'aria-label': `Make photo ${index + 1} the cover`, text: 'Cover' });
        first.addEventListener('click', () => whileBusy(first, '…', async () => {
          photoMessage.clear();
          const reordered = [item.saved, ...photos.filter((photo) => photo !== item.saved)];
          try {
            await reorderPhotos(reordered);
            photos = reordered.map((photo, position) => ({ ...photo, position }));
            drawPhotos();
          } catch (error) {
            photoMessage.show(friendlyListingError(error));
          }
        }));
        controls.unshift(first);
      }
      const image = el('img', { class: 'photo-grid__image', alt: index === 0 ? 'Cover photo' : `Photo ${index + 1}`, loading: 'lazy' });
      if (item.url) image.src = item.url;
      return el('li', { class: 'photo-grid__item' }, [
        image,
        ...(index === 0 ? [el('span', { class: 'photo-grid__badge', text: 'Cover' })] : []),
        ...(item.waiting ? [el('span', { class: 'photo-grid__badge photo-grid__badge--waiting', text: 'Not saved yet' })] : []),
        el('div', { class: 'photo-grid__controls' }, controls),
      ]);
    }));
    const total = shown.length;
    photoCount.textContent = total >= PHOTOS.min
      ? `${total} of up to ${PHOTOS.max} photos. The first one is the cover.`
      : `${total} of at least ${PHOTOS.min}. Add clear photos of the outside, each room, the bathroom and the kitchen.`;
    addButton.hidden = total >= PHOTOS.max;
  }
  drawPhotos();

  picker.addEventListener('change', async () => {
    const files = [...picker.files];
    picker.value = '';
    photoMessage.clear();
    const room = PHOTOS.max - photos.length - waiting.length;
    if (files.length > room) photoMessage.show(`Only ${room} more photo${room === 1 ? '' : 's'} can be added (up to ${PHOTOS.max}).`);
    addButton.textContent = 'Adding photos…';
    for (const file of files.slice(0, Math.max(room, 0))) {
      try {
        const blob = await shrinkPhoto(file);
        if (listing) {
          const saved = await addPhoto({ userId: session.user.id, listingId: listing.id, blob, position: photos.length });
          photos.push({ ...saved, url: URL.createObjectURL(blob) });
        } else {
          waiting.push({ blob, url: URL.createObjectURL(blob) });
        }
        drawPhotos();
      } catch (error) {
        photoMessage.show(friendlyListingError(error));
        break;
      }
    }
    addButton.textContent = 'Add photos';
  });

  const role = findRole(profile.role);
  const save = el('button', { type: 'button', class: 'button button--quiet', text: 'Save draft' });
  const next = el('button', { type: 'submit', class: 'button button--primary', text: 'Next: film your video tour' });

  const form = el('form', { class: 'form', novalidate: '' }, [
    el('div', { class: 'field' }, [
      el('span', { class: 'field__label', id: 'mode-label', text: 'I want to' }),
      el('div', { class: 'segmented', role: 'group', 'aria-labelledby': 'mode-label' }, modeButtons.map(({ button }) => button)),
    ]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field__label', text: 'Photos' }),
      photoGrid,
      picker,
      addButton,
      photoCount,
      photoMessage.node,
    ]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field__label', id: 'kind-label', text: 'Type of place' }),
      el('div', { class: 'choices', role: 'group', 'aria-labelledby': 'kind-label' }, kindButtons.map(({ button }) => button)),
      kindError,
    ]),
    street.node,
    area.node,
    city.node,
    price.node,
    deposit.node,
    el('div', { class: 'counters' }, [bedrooms.node, bathrooms.node, parking.node]),
    el('fieldset', { class: 'field checks' }, [
      el('legend', { class: 'field__label', text: 'What the place has' }),
      ...featureBoxes.map(({ node }) => node),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'description', class: 'field__label', text: 'About the place (optional)' }),
      description,
      el('p', { class: 'field__hint', text: 'What is close by (taxi rank, shops, schools), what is included, any house rules.' }),
      descriptionError,
    ]),
    available.node,
    el('p', { class: 'note', text: `You are listing as ${role.name === 'Owner' ? 'the owner' : 'an agent'}. Every listing is checked before it goes live, so renters and buyers know it is real.` }),
    message.node,
    el('div', { class: 'button-row' }, [save, next]),
  ]);

  function showErrors(errors) {
    street.setError(errors.street ?? null);
    area.setError(errors.area ?? null);
    city.setError(errors.city ?? null);
    price.setError(errors.price ?? null);
    deposit.setError(errors.deposit ?? null);
    available.setError(errors.availableFrom ?? null);
    kindError.textContent = errors.kind ?? '';
    kindError.hidden = !errors.kind;
    descriptionError.textContent = errors.description ?? '';
    descriptionError.hidden = !errors.description;
  }

  async function saveAll(button, busyText) {
    message.clear();
    const { errors, values } = checkDetails({
      mode,
      kind,
      street: street.input.value,
      area: area.input.value,
      city: city.input.value,
      price: price.input.value,
      deposit: deposit.input.value,
      availableFrom: available.input.value,
      bedrooms: bedrooms.value(),
      bathrooms: bathrooms.value(),
      parking: parking.value(),
      features: featureBoxes.filter(({ box }) => box.checked).map(({ item }) => item.id),
      description: description.value,
    });
    showErrors(errors);
    if (Object.keys(errors).length > 0) {
      message.show('Some details need fixing. Check the boxes marked in red.');
      form.querySelector('[aria-invalid="true"], .field__error:not([hidden])')?.scrollIntoView({ block: 'center' });
      return false;
    }
    let ok = false;
    await whileBusy(button, busyText, async () => {
      try {
        listing = listing ? await updateListing(listing.id, values) : await createListing(values);
        while (waiting.length > 0) {
          const item = waiting[0];
          const saved = await addPhoto({ userId: session.user.id, listingId: listing.id, blob: item.blob, position: photos.length });
          photos.push({ ...saved, url: item.url });
          waiting.shift();
        }
        ok = true;
      } catch (error) {
        message.show(friendlyListingError(error));
      }
    });
    drawPhotos();
    return ok;
  }

  save.addEventListener('click', async () => {
    const wasNew = !route.id;
    if (await saveAll(save, 'Saving…')) {
      if (wasNew) navigate(`#/list/${listing.id}`);
      else message.show('Saved.', 'success');
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (await saveAll(next, 'Saving…')) navigate(`#/list/${listing.id}/tour`);
  });

  const notes = listing?.status === 'changes_needed' && listing.review_note
    ? [el('p', { class: 'message message--error', text: `We asked for changes: ${listing.review_note}` })]
    : [];

  return [
    bar,
    stepHeader(listing?.id ?? null, 'details'),
    el('h1', { class: 'title', text: listing ? 'Edit your listing' : 'List your property' }),
    ...notes,
    form,
    tabBar('profile'),
  ];
}
