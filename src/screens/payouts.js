// Street Safe payouts (#/payouts): the bank account owners and agents are paid
// into. The account number and ID number go straight to TradeSafe through the
// street-safe Edge Function; Street Property keeps only the bank, the account
// type and the last 4 digits.

import { loadViewer } from '../viewer.js';
import { streetSafe, myPayoutAccount } from '../deals/api.js';
import { PAYOUT_BANKS, ACCOUNT_TYPES, checkPayout, payoutLine } from '../deals/rules.js';
import { friendlyListingError } from '../listings/errors.js';
import { topBar, tabBar } from '../shell.js';
import { el, messageBox, whileBusy } from '../dom.js';

export async function renderPayouts({ session }) {
  const { profile } = await loadViewer(session);
  const head = [
    topBar({ profile, session }),
    el('a', { href: '#/profile', class: 'text-link', text: '← Profile' }),
    el('p', { class: 'eyebrow', text: 'Street Safe' }),
    el('h1', { class: 'title', text: 'Get paid through Street Safe' }),
  ];
  if (!['owner', 'agent'].includes(profile?.role)) {
    return [...head, el('p', { class: 'lead', text: 'Payouts are for owners and agents. Renters pay on TradeSafe’s own page and need no bank details here.' }), tabBar('profile')];
  }
  const [account, status] = await Promise.all([
    myPayoutAccount(session.user.id).catch(() => null),
    streetSafe('status').catch(() => null),
  ]);
  const message = messageBox();
  const current = payoutLine(account);

  const option = (value, text) => el('option', { value, text });
  const bank = el('select', { id: 'payout-bank', class: 'input' }, [option('', 'Choose your bank'), ...PAYOUT_BANKS.map((b) => option(b.id, b.name))]);
  const type = el('select', { id: 'payout-type', class: 'input' }, [option('', 'Choose'), ...ACCOUNT_TYPES.map((t) => option(t.id, t.name))]);
  const number = el('input', { id: 'payout-number', class: 'input', inputmode: 'numeric', autocomplete: 'off' });
  const idNumber = el('input', { id: 'payout-id', class: 'input', inputmode: 'numeric', autocomplete: 'off', maxlength: '13' });
  const save = el('button', { type: 'submit', class: 'button button--primary', text: current ? 'Change the account' : 'Save the account' });
  const field = (id, label, input, hint) => el('div', { class: 'field' }, [
    el('label', { for: id, class: 'field__label', text: label }), input, ...(hint ? [el('p', { class: 'field__hint', text: hint })] : []),
  ]);
  const form = el('form', { class: 'stack', novalidate: '' }, [
    el('div', { class: 'two-up' }, [field('payout-bank', 'Bank', bank), field('payout-type', 'Account type', type)]),
    field('payout-number', 'Account number', number),
    field('payout-id', 'Your SA ID number', idNumber, 'TradeSafe must know who it pays (FICA). The account must be in your own name.'),
    save,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    message.clear();
    const values = { bank: bank.value, accountType: type.value, accountNumber: number.value.replace(/\s/g, ''), idNumber: idNumber.value.replace(/\s/g, '') };
    const first = Object.values(checkPayout(values))[0];
    if (first) {
      message.show(first);
      return;
    }
    whileBusy(save, 'Saving…', async () => {
      try {
        const answer = await streetSafe('payout', values);
        if (answer?.waiting) {
          message.show('Street Safe payments are not switched on yet. Try again soon.');
          return;
        }
        number.value = '';
        idNumber.value = '';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (problem) {
        message.show(friendlyListingError(problem));
      }
    });
  });

  return [
    ...head,
    el('p', { class: 'lead', text: 'Renters pay the first month’s rent and the deposit into TradeSafe, a registered South African escrow service. TradeSafe pays you as soon as the renter confirms they have the keys.' }),
    ...(status && !status.ready ? [el('p', { class: 'note note--warning', text: 'Street Safe payments are not switched on yet. You can come back to this.' })] : []),
    ...(status?.ready && status.sandbox ? [el('p', { class: 'note note--warning', text: 'Test mode: no real money moves yet.' })] : []),
    ...(current ? [el('p', { class: 'message message--success', text: `Payouts go to your ${current}.` })] : []),
    form,
    message.node,
    el('p', { class: 'note', text: 'Your account number and ID number go straight to TradeSafe. Street Property keeps only the bank, the account type and the last 4 digits.' }),
    tabBar('profile'),
  ];
}
