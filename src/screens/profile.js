// Profile: a name and how the person uses the app (renter, owner or agent).

import { ROLES } from '../roles.js';
import { updateProfile } from '../auth/api.js';
import { loadViewer, forgetViewer } from '../viewer.js';
import { checkOptionalName } from '../auth/validate.js';
import { friendlyAuthError } from '../auth/errors.js';
import { topBar, tabBar } from '../shell.js';
import { el, field, messageBox, whileBusy } from '../dom.js';

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
  const save = el('button', { type: 'submit', class: 'button button--primary', text: 'Save changes' });
  const form = el('form', { class: 'form', novalidate: '' }, [
    name.node,
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
    if (nameError) return;
    await whileBusy(save, 'Saving…', async () => {
      try {
        const saved = await updateProfile(session.user.id, { fullName: name.input.value, role });
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

  return [bar, heading, ...(admin ? [el('p', { class: 'chip chip--waiting', text: 'Admin' })] : []), form, tabBar('profile')];
}
