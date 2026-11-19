// Your renter check (#/renter-check), and the owner's view of a renter who
// shared it (#/enquiries/<id>/check), as in the design.

import { loadViewer } from '../viewer.js';
import { myRenterCheck, submitIncome, renterCheckFor, decideRenter } from '../renter/api.js';
import { renterStates, coverLine, householdLine, moveInLine } from '../renter/rules.js';
import { uploadDoc, removeDocs, submitIdentity } from '../verify/api.js';
import { checkDocFile } from '../verify/rules.js';
import { getEnquiry } from '../enquiries/api.js';
import { enquiryTitle, enquiryPrice, initials } from '../enquiries/rules.js';
import { friendlyListingError } from '../listings/errors.js';
import { topBar, tabBar } from '../shell.js';
import { el, messageBox, whileBusy } from '../dom.js';
import { picker } from './verify.js';

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

export async function renderRenterCheck({ session }) {
  const { profile } = await loadViewer(session);
  const me = session.user.id;
  const r = await myRenterCheck();
  const [idState, incomeState] = renterStates(r);
  const message = messageBox();
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

  let idAction = null;
  if (['needed', 'rejected'].includes(idState.state)) {
    const idFile = picker({ id: 'id-photo', label: 'Your South African ID or passport (the photo page)', capture: 'environment' });
    const selfie = picker({ id: 'selfie', label: 'A selfie, face clearly visible', capture: 'user' });
    const go = el('button', { type: 'button', class: 'button button--primary', text: 'Send my ID for checking' });
    go.addEventListener('click', () => send(go, [{ file: idFile.file, folder: 'identity' }, { file: selfie.file, folder: 'identity' }],
      ([idPath, selfiePath]) => submitIdentity(idPath, selfiePath)));
    idAction = el('div', { class: 'stack' }, [idFile.node, selfie.node, go]);
  }

  let incomeAction = null;
  if (['needed', 'rejected', 'expired'].includes(incomeState.state)) {
    const first = picker({ id: 'income-1', label: 'Your latest payslip, or a bank statement', capture: null });
    const second = picker({ id: 'income-2', label: 'Another payslip or statement (optional)', capture: null });
    const third = picker({ id: 'income-3', label: 'Another (optional)', capture: null });
    const go = el('button', { type: 'button', class: 'button button--primary', text: 'Send for checking' });
    go.addEventListener('click', () => {
      const chosen = [first, second, third].filter((pick, n) => n === 0 || pick.file());
      send(go, chosen.map((pick) => ({ file: pick.file, folder: 'income' })), (paths) => submitIncome(paths));
    });
    incomeAction = el('div', { class: 'stack' }, [first.node, second.node, third.node, go]);
  } else if (incomeState.state === 'done') {
    const until = new Date(`${r.valid_until}T12:00:00Z`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
    incomeAction = el('p', { class: 'field__hint', text: `We noted a take-home pay of R${String(r.monthly_income_rands).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} a month. Owners never see this amount, only how many times it covers their rent. Good until ${until}.` });
  }

  return [
    topBar({ profile, session }),
    el('p', { class: 'eyebrow', text: 'Street Safe' }),
    el('h1', { class: 'title', text: 'Your renter check' }),
    el('p', { class: 'lead', text: 'Show owners you are who you say and can afford the rent, without handing your ID and payslips to strangers. Do it once, then share the result in any conversation.' }),
    el('ol', { class: 'check-list' }, [
      card(1, 'Your ID', 'A photo of your South African ID or passport, and a selfie. Owners see that it is checked, and your first name.', idState, idAction),
      card(2, 'Your income', 'Your latest payslip, or 3 months of bank statements. Owners see how many times your take-home pay covers their rent, never the amount or the documents.', incomeState, incomeAction),
    ]),
    message.node,
    el('p', { class: 'note', text: 'Our team checks the documents and deletes them as soon as the check is done. Nothing is shared until you choose to share it with an owner, in your conversation with them.' }),
    el('a', { href: '#/enquiries', class: 'button button--quiet', text: 'Go to my enquiries' }),
    tabBar('profile'),
  ];
}

/** The owner's view of a shared renter check, with Yes or Not this time. */
export async function renderEnquiryCheck({ session, navigate, route }) {
  const { profile } = await loadViewer(session);
  const [item, check] = await Promise.all([getEnquiry(route.id), renterCheckFor(route.id)]);
  const back = el('a', { href: `#/enquiries/${route.id}`, class: 'text-link', text: '← Conversation' });
  if (!item || !check || !check.shared_at || check.my_side !== 'owner') {
    return [
      topBar({ profile, session }),
      back,
      el('h1', { class: 'title', text: 'Nothing shared' }),
      el('p', { class: 'lead', text: check?.owner_decision === 'declined' ? 'You chose someone else; their details are no longer shown.' : 'The renter has not shared their check with you.' }),
      tabBar('enquiries'),
    ];
  }
  const cover = coverLine(check.cover_ratio);
  const message = messageBox();
  const first = check.renter_name.split(' ')[0] || 'this renter';
  const yes = el('button', { type: 'button', class: 'button button--primary', text: `Yes, rent to ${first}` });
  const no = el('button', { type: 'button', class: 'button button--quiet', text: 'Not this time' });
  async function decide(button, accept) {
    message.clear();
    await whileBusy(button, 'Sending…', async () => {
      try {
        await decideRenter(route.id, accept);
        navigate(`#/enquiries/${route.id}`);
      } catch (error) {
        message.show(friendlyListingError(error));
      }
    });
  }
  yes.addEventListener('click', () => decide(yes, true));
  no.addEventListener('click', () => decide(no, false));

  const decided = check.owner_decision === 'accepted';
  return [
    topBar({ profile, session }),
    back,
    el('p', { class: 'eyebrow', text: 'Renter check' }),
    el('p', { class: 'lead', text: `For your ${enquiryTitle(item).toLowerCase()} · ${enquiryPrice(item)}` }),
    el('div', { class: 'renter-head' }, [
      el('span', { class: 'avatar avatar--big', 'aria-hidden': 'true', text: initials(check.renter_name) }),
      el('div', { class: 'stack stack--tight' }, [
        el('h1', { class: 'title title--medium', text: check.renter_name }),
        el('p', { class: 'lead', text: householdLine(check) }),
        el('p', { class: 'field__hint', text: moveInLine(check) }),
      ]),
    ]),
    el('ul', { class: 'check-list' }, [
      el('li', { class: `check-card check-card--${check.id_checked ? 'done' : 'needed'}` }, [
        el('div', { class: 'stack stack--tight check-card__body' }, [
          el('div', { class: 'check-card__top' }, [
            el('p', { class: 'check-card__title', text: 'ID' }),
            el('span', { class: `chip ${check.id_checked ? 'chip--good' : 'chip--waiting'}`, text: check.id_checked ? 'Checked' : 'Not checked yet' }),
          ]),
          el('p', { class: 'check-card__text', text: check.id_checked ? 'ID or passport matched to a selfie by Street Property. You see the name only.' : 'This renter has not finished the ID check.' }),
        ]),
      ]),
      el('li', { class: `check-card check-card--${check.income_checked ? 'done' : 'needed'}` }, [
        el('div', { class: 'stack stack--tight check-card__body' }, [
          el('div', { class: 'check-card__top' }, [
            el('p', { class: 'check-card__title', text: 'Income' }),
            el('span', { class: `chip ${check.income_checked ? 'chip--good' : 'chip--waiting'}`, text: check.income_checked ? 'Checked' : 'Not checked yet' }),
          ]),
          ...(cover ? [el('p', { class: `cover cover--${cover.strength}` }, [el('span', { class: 'cover__x', text: cover.text }), el('span', { text: ` ${cover.words}` })])] : []),
          el('p', { class: 'check-card__text', text: check.income_checked ? 'From payslips or bank statements checked by Street Property in the last 3 months.' : 'This renter has not finished the income check.' }),
        ]),
      ]),
    ]),
    el('p', { class: 'note', text: `${first} chose to share this with you. You never see their documents or exact income.` }),
    message.node,
    ...(decided
      ? [el('p', { class: 'message message--success', text: `You said yes to ${first}. Agree on the details in the conversation; signing the lease in the app is coming soon.` })]
      : [el('div', { class: 'button-row' }, [no, yes]), el('p', { class: 'field__hint', text: `If you say not this time, ${first} is told politely and their details are removed from your view.` })]),
    tabBar('enquiries'),
  ];
}
