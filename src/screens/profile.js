// Profile: a name and how the person uses the app (renter, owner or agent).

import { ROLES, canList } from '../roles.js';
import { updateProfile } from '../auth/api.js';
import { loadViewer, forgetViewer } from '../viewer.js';
import { checkOptionalName } from '../auth/validate.js';
import { friendlyAuthError } from '../auth/errors.js';
import { topBar, tabBar } from '../shell.js';
import { el, field, messageBox, whileBusy } from '../dom.js';
import { normalizePhone, showPhone } from '../enquiries/rules.js';

export async function renderProfile({ session }) {
  const message = messageBox();
  const { profile, admin } = await loadViewer(session);
  const heading = el('div', { class: 'stack' }, [
    el('h1', { class: 'title', text: 'Profile' }),
    el('p', { class: 'lead', text: session.user.email ?? '' }),
  ]);

  if (profile === null) {
    message.show('Your profile was not found. The database setup script may not have been run yet.');
    return [topBar({ profile: null, session }), heading, message.node, tabBar('profile')];
  }

  let bar = topBar({ profile, session });
  let role = profile.role;
  const options = ROLES.map((item) => {
    const button = el('button', { type: 'button', class: 'role-option' }, [
      el('span', { class: 'role-option__name', text: item.name }),
      el('span', { class: 'role-option__about', text: item.about }),
    ]);
    button.addEventListener('click', () => {
      role = item.id;
      updateRole();
    });
    return { item, button };
  });
  function updateRole() {
    for (const { item, button } of options) button.setAttribute('aria-pressed', String(item.id === role));
  }
  updateRole();

  const name = field({ id: 'full-name', label: 'Your name (optional)', autocomplete: 'name', value: profile.full_name });
  const phone = field({ id: 'phone', label: 'Cell number (optional)', type: 'tel', autocomplete: 'tel', value: profile.phone ? showPhone(profile.phone) : '' });
  const share = el('input', { type: 'checkbox', id: 'share-whatsapp', class: 'check__box' });
  share.checked = profile.share_whatsapp === true;
  const emails = el('input', { type: 'checkbox', id: 'email-notifications', class: 'check__box' });
  emails.checked = profile.email_notifications !== false;
  const emailRow = el('label', { class: 'check check--tall', for: 'email-notifications' }, [
    emails,
    el('span', { class: 'check__text' }, [
      el('span', { class: 'check__label', text: 'Email me about messages, viewings and checks' }),
      el('span', { class: 'check__hint', text: 'At most one email per conversation every 15 minutes.' }),
    ]),
  ]);
  const shareRow = el('label', { class: 'check check--tall', for: 'share-whatsapp' }, [
    share,
    el('span', { class: 'check__text' }, [
      el('span', { class: 'check__label', text: 'Share it on WhatsApp after a confirmed viewing' }),
      el('span', { class: 'check__hint', text: 'Only the person whose viewing is confirmed sees it, and only until two days after the viewing. Never shown on listings.' }),
    ]),
  ]);
  const save = el('button', { type: 'submit', class: 'button button--primary', text: 'Save changes' });
  const form = el('form', { class: 'form', novalidate: '' }, [
    name.node,
    phone.node,
    shareRow,
    emailRow,
    el('div', { class: 'field' }, [
      el('span', { class: 'field__label', id: 'role-label', text: 'I use Street Property as' }),
      el('div', { class: 'role-options', role: 'group', 'aria-labelledby': 'role-label' }, options.map(({ button }) => button)),
    ]),
    message.node,
    el('div', { class: 'push-down' }, [save]),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.clear();
    const nameError = checkOptionalName(name.input.value);
    name.setError(nameError);
    const phoneText = phone.input.value.trim();
    const cleanPhone = phoneText ? normalizePhone(phoneText) : null;
    const phoneError = phoneText && !cleanPhone ? 'Enter a South African cell number, like 082 123 4567.' : null;
    phone.setError(phoneError);
    if (nameError || phoneError) return;
    await whileBusy(save, 'Saving…', async () => {
      try {
        const saved = await updateProfile(session.user.id, { fullName: name.input.value, role, phone: cleanPhone, shareWhatsapp: share.checked, emailNotifications: emails.checked });
        emails.checked = saved.email_notifications !== false;
        phone.input.value = saved.phone ? showPhone(saved.phone) : '';
        share.checked = saved.share_whatsapp === true;
        name.input.value = saved.full_name;
        role = saved.role;
        updateRole();
        forgetViewer();
        const fresh = topBar({ profile: saved, session });
        bar.replaceWith(fresh);
        bar = fresh;
        message.show('Saved.', 'success');
      } catch (error) {
        message.show(friendlyAuthError(error));
      }
    });
  });

  const shortcuts = [
    el('a', { href: '#/renter-check', class: 'button button--quiet', text: 'My renter check' }),
    ...(canList(profile.role) ? [el('a', { href: '#/my-listings', class: 'button button--quiet', text: 'My listings' })] : []),
    ...(admin ? [el('a', { href: '#/review', class: 'button button--quiet', text: 'Review queue' })] : []),
  ];
  return [
    bar,
    heading,
    ...(admin ? [el('p', { class: 'chip chip--waiting', text: 'Admin' })] : []),
    ...(shortcuts.length ? [el('div', { class: 'stack' }, shortcuts)] : []),
    form,
    tabBar('profile'),
  ];
}
