// Street Property: Street Safe payments through TradeSafe (escrow).
//
// Deployed as the Edge Function "street-safe" with "Verify JWT" switched off,
// because TradeSafe's callbacks arrive without a Supabase login. Calls from
// the app are checked here instead: they must carry the person's login.
//
// What it does
//   action "status"  → whether payments are switched on
//   action "payout"  → an owner adds the bank account Street Safe pays into.
//                      The account number goes straight to TradeSafe; only the
//                      bank, the account type and the last 4 digits are kept.
//   action "pay"     → the renter pays the first month's rent and the deposit
//                      into TradeSafe (returns TradeSafe's payment page).
//   action "pay_part"→ after moving in, the renter pays a later part of a
//                      deposit plan; TradeSafe passes it straight to the owner.
//   action "sync"    → checks the payments with TradeSafe and acts on the deal:
//                      keys confirmed → pay the owner; deal called off → refund.
//   ?callback=<key>  → TradeSafe tells us a transaction changed. The message is
//                      never trusted: we ask TradeSafe for the real state.
//
// Secrets (Supabase → Edge Functions → Secrets), set by the project owner:
//   TRADESAFE_CLIENT_ID, TRADESAFE_CLIENT_SECRET   from the TradeSafe developer portal
//   TRADESAFE_ENV            "sandbox" (default) or "production"
//   STREET_SAFE_CALLBACK_KEY a long random word, also put in the callback URL at TradeSafe
//   STREET_SAFE_FEE_PAYER    optional: SELLER (default), BUYER or BUYER_SELLER
//   APP_URL                  optional, defaults to the GitHub Pages address
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Without the TradeSafe keys every action answers { waiting: true } and the app
// says Street Safe payments are not switched on yet.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CLIENT_ID = Deno.env.get('TRADESAFE_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('TRADESAFE_CLIENT_SECRET') ?? '';
const PRODUCTION = Deno.env.get('TRADESAFE_ENV') === 'production';
const API_URL = PRODUCTION ? 'https://api.tradesafe.co.za/graphql' : 'https://api-developer.tradesafe.dev/graphql';
const AUTH_URL = Deno.env.get('TRADESAFE_AUTH_URL') ?? 'https://auth.tradesafe.co.za/oauth/token';
const CALLBACK_KEY = Deno.env.get('STREET_SAFE_CALLBACK_KEY') ?? '';
const FEE_PAYER = ['SELLER', 'BUYER', 'BUYER_SELLER'].includes(Deno.env.get('STREET_SAFE_FEE_PAYER') ?? '')
  ? Deno.env.get('STREET_SAFE_FEE_PAYER')!
  : 'SELLER';
const READY = Boolean(CLIENT_ID && CLIENT_SECRET && CALLBACK_KEY);

// Our bank choices → TradeSafe's names. Check these against the TradeSafe
// playground (enum UniversalBranchCode / BankAccountType) when the keys arrive.
export const BANKS: Record<string, string> = {
  absa: 'ABSA', capitec: 'CAPITEC', fnb: 'FNB', nedbank: 'NEDBANK', standard: 'STANDARD_BANK',
  discovery: 'DISCOVERY', tyme: 'TYMEBANK', investec: 'INVESTEC', african: 'AFRICAN_BANK',
};
export const ACCOUNT_TYPES: Record<string, string> = { cheque: 'CHEQUE', savings: 'SAVINGS', transmission: 'TRANSMISSION' };

const PAID = ['FUNDS_RECEIVED', 'INITIATED', 'SENT', 'DELIVERED'];
const RELEASED = ['FUNDS_RELEASED'];
const REFUNDED = ['CANCELED', 'CANCELLED', 'REFUNDED', 'DECLINED'];

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const problem = (code: string, status = 400) => reply({ error: code }, status);

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

// TradeSafe ------------------------------------------------------------------------

let access: { token: string; until: number } | null = null;

async function accessToken() {
  if (access && access.until > Date.now() + 60_000) return access.token;
  const response = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  if (!response.ok) throw new Error(`TradeSafe login ${response.status}`);
  const data = await response.json();
  access = { token: data.access_token, until: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return access.token;
}

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.errors?.length) {
    // Never log the variables: they can hold bank details.
    throw new Error(`TradeSafe ${response.status}: ${(data.errors?.[0]?.message ?? '').slice(0, 200)}`);
  }
  return data.data;
}

function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  return { givenName: parts[0] ?? '', familyName: parts.slice(1).join(' ') };
}

async function personFor(userId: string) {
  const [{ data: profile }, { data: auth }] = await Promise.all([
    db.from('profiles').select('full_name, phone').eq('id', userId).maybeSingle(),
    db.auth.admin.getUserById(userId),
  ]);
  const name = splitName(profile?.full_name ?? '');
  return { ...name, email: auth?.user?.email ?? '', mobile: profile?.phone ?? '' };
}

async function createToken(userId: string, bank?: { bank: string; accountNumber: string; accountType: string; idNumber: string }) {
  const person = await personFor(userId);
  if (!person.givenName || !person.familyName) throw new UserProblem('name_needed');
  if (!person.mobile) throw new UserProblem('phone_needed');
  const input: Record<string, unknown> = {
    user: {
      givenName: person.givenName, familyName: person.familyName, email: person.email, mobile: person.mobile,
      ...(bank ? { idNumber: bank.idNumber, idType: 'NATIONAL', idCountry: 'ZAF' } : {}),
    },
  };
  if (bank) input.bankAccount = { bank: bank.bank, accountNumber: bank.accountNumber, accountType: bank.accountType };
  const data = await gql('mutation tokenCreate($input: TokenInput) { tokenCreate(input: $input) { id } }', { input });
  return data.tokenCreate.id as string;
}

class UserProblem extends Error {}

// The deal ------------------------------------------------------------------------

type Deal = {
  id: string; enquiry_id: string; owner_id: string; renter_id: string; status: string;
  rent_rands: number; deposit_rands: number | null; deposit_parts: number; start_date: string; area: string; kind: string; bedrooms: number;
  safe_tx: string | null; safe_state: string;
};
type Part = { deal_id: string; part: number; amount_rands: number; due_date: string; safe_tx: string | null; safe_state: string };

async function loadDeal(id: string): Promise<Deal | null> {
  const { data } = await db.from('deals')
    .select('id, enquiry_id, owner_id, renter_id, status, rent_rands, deposit_rands, deposit_parts, start_date, safe_tx, safe_state, listings(area, kind, bedrooms)')
    .eq('id', id).maybeSingle();
  if (!data) return null;
  const place = (data as any).listings ?? {};
  return { ...(data as any), area: place.area, kind: place.kind, bedrooms: place.bedrooms };
}

async function laterParts(dealId: string): Promise<Part[]> {
  const { data, error } = await db.from('deposit_payments').select('deal_id, part, amount_rands, due_date, safe_tx, safe_state').eq('deal_id', dealId).order('part');
  if (error) throw new Error(error.message);
  return (data ?? []) as Part[];
}

/** The deposit paid before moving in: all of it, or the first part of a plan. */
async function firstDepositPart(deal: Deal) {
  const later = await laterParts(deal.id);
  return Math.max(0, (deal.deposit_rands ?? 0) - later.reduce((sum, p) => sum + p.amount_rands, 0));
}

function placeName(deal: Deal) {
  return `${deal.bedrooms ? `${deal.bedrooms}-bed ` : ''}${String(deal.kind ?? 'place').replace(/_/g, ' ')} in ${deal.area}`;
}

async function renterToken(userId: string) {
  const { data } = await db.from('safe_accounts').select('token').eq('user_id', userId).maybeSingle();
  if (data?.token) return data.token as string;
  const token = await createToken(userId);
  await db.from('safe_accounts').upsert({ user_id: userId, token, can_receive: false, updated_at: new Date().toISOString() });
  return token;
}

async function record(deal: Deal, state: string, extra: Record<string, unknown> = {}) {
  const { error } = await db.rpc('safe_record', { p_deal: deal.id, p_state: state, ...extra });
  if (error) throw new Error(error.message);
}

/** Ask TradeSafe where the money is, and act on the deal. */
async function reconcile(deal: Deal) {
  if (!deal.safe_tx) return deal.safe_state;
  const data = await gql('query transaction($id: ID!) { transaction(id: $id) { id state allocations { id state } } }', { id: deal.safe_tx });
  const tx = data.transaction;
  let state = PAID.includes(tx.state) ? 'paid' : RELEASED.includes(tx.state) ? 'released' : REFUNDED.includes(tx.state) ? 'refunded' : 'waiting';

  if (state === 'paid' && deal.status === 'cancelled') {
    await gql('mutation transactionCancel($id: ID!, $comment: String!) { transactionCancel(id: $id, comment: $comment) { id state } }',
      { id: tx.id, comment: 'The rental deal was called off on Street Property.' });
    state = 'refunded';
  } else if (state === 'paid' && deal.status === 'moved_in') {
    for (const allocation of tx.allocations ?? []) {
      if (!['INITIATED', 'SENT', 'DELIVERED'].includes(allocation.state)) {
        await gql('mutation allocationStartDelivery($id: ID!) { allocationStartDelivery(id: $id) { id state } }', { id: allocation.id });
      }
      await gql('mutation allocationAcceptDelivery($id: ID!) { allocationAcceptDelivery(id: $id) { id state } }', { id: allocation.id });
    }
    state = 'released';
  }
  if (state !== deal.safe_state) await record(deal, state);
  return state;
}

/** A later deposit part: once TradeSafe has it, pass it straight to the owner. */
async function reconcilePart(deal: Deal, part: Part) {
  if (!part.safe_tx || ['released', 'refunded'].includes(part.safe_state)) return part.safe_state;
  const data = await gql('query transaction($id: ID!) { transaction(id: $id) { id state allocations { id state } } }', { id: part.safe_tx });
  const tx = data.transaction;
  let state = PAID.includes(tx.state) ? 'paid' : RELEASED.includes(tx.state) ? 'released' : REFUNDED.includes(tx.state) ? 'refunded' : 'waiting';
  if (state === 'paid') {
    for (const allocation of tx.allocations ?? []) {
      if (!['INITIATED', 'SENT', 'DELIVERED'].includes(allocation.state)) {
        await gql('mutation allocationStartDelivery($id: ID!) { allocationStartDelivery(id: $id) { id state } }', { id: allocation.id });
      }
      await gql('mutation allocationAcceptDelivery($id: ID!) { allocationAcceptDelivery(id: $id) { id state } }', { id: allocation.id });
    }
    state = 'released';
  }
  if (state !== part.safe_state) {
    const { error } = await db.rpc('safe_record_part', { p_deal: deal.id, p_part: part.part, p_state: state });
    if (error) throw new Error(error.message);
  }
  return state;
}

async function payPart(deal: Deal, userId: string, partNumber: number) {
  if (deal.renter_id !== userId) throw new UserProblem('not_the_renter');
  if (deal.status !== 'moved_in') throw new UserProblem('part_after_keys');
  const part = (await laterParts(deal.id)).find((p) => p.part === partNumber);
  if (!part) throw new UserProblem('deposit_part_missing');
  if (!['none', 'waiting'].includes(part.safe_state)) throw new UserProblem('already_paid');
  const { data: owner } = await db.from('safe_accounts').select('token, can_receive').eq('user_id', deal.owner_id).maybeSingle();
  if (!owner?.can_receive) throw new UserProblem('owner_not_ready');
  let txId = part.safe_tx;
  if (!txId) {
    const renter = await renterToken(userId);
    const created = await gql(`mutation transactionCreate($input: CreateTransactionInput!) {
        transactionCreate(input: $input) { id } }`, {
      input: {
        title: `Deposit part ${part.part} of ${deal.deposit_parts}: ${placeName(deal)}`,
        description: 'A deposit part paid through Street Property, passed to the owner once received.',
        industry: 'GENERAL_GOODS_SERVICES',
        currency: 'ZAR',
        feeAllocation: FEE_PAYER,
        workflow: 'STANDARD',
        allocations: { create: [{ title: `Deposit part ${part.part} of ${deal.deposit_parts}`, description: `Due ${part.due_date}`, value: part.amount_rands, daysToDeliver: 7, daysToInspect: 1 }] },
        parties: { create: [{ token: renter, role: 'BUYER' }, { token: owner.token, role: 'SELLER' }] },
      },
    });
    txId = created.transactionCreate.id as string;
    const { error } = await db.rpc('safe_record_part', { p_deal: deal.id, p_part: part.part, p_state: 'waiting', p_tx: txId });
    if (error) throw new Error(error.message);
  }
  const link = await gql('mutation checkoutLink($id: ID!) { checkoutLink(transactionId: $id) }', { id: txId });
  return link.checkoutLink as string;
}

async function pay(deal: Deal, userId: string) {
  if (deal.renter_id !== userId) throw new UserProblem('not_the_renter');
  if (deal.status !== 'signed') throw new UserProblem('pay_after_lease');
  if (!['none', 'waiting'].includes(deal.safe_state)) throw new UserProblem('already_paid');
  const { data: owner } = await db.from('safe_accounts').select('token, can_receive').eq('user_id', deal.owner_id).maybeSingle();
  if (!owner?.can_receive) throw new UserProblem('owner_not_ready');

  let txId = deal.safe_tx;
  if (!txId) {
    const renter = { token: await renterToken(userId) };
    const deposit = await firstDepositPart(deal);
    const daysToStart = Math.max(0, Math.ceil((new Date(`${deal.start_date}T00:00:00Z`).getTime() - Date.now()) / 86_400_000));
    const days = Math.min(Math.max(daysToStart + 14, 7), 120);
    const place = placeName(deal);
    const allocations = [{ title: "First month's rent", description: `Rent for ${place}`, value: deal.rent_rands, daysToDeliver: days, daysToInspect: 7 }];
    if (deposit > 0) {
      const title = deal.deposit_parts > 1 ? `Deposit part 1 of ${deal.deposit_parts}` : 'Deposit';
      allocations.push({ title, description: `${title} for ${place}`, value: deposit, daysToDeliver: days, daysToInspect: 7 });
    }
    const created = await gql(`mutation transactionCreate($input: CreateTransactionInput!) {
        transactionCreate(input: $input) { id allocations { id } } }`, {
      input: {
        title: `Rent and deposit: ${place}`,
        description: 'Held by TradeSafe for Street Property until the renter confirms the keys.',
        industry: 'GENERAL_GOODS_SERVICES',
        currency: 'ZAR',
        feeAllocation: FEE_PAYER,
        workflow: 'STANDARD',
        allocations: { create: allocations },
        parties: { create: [{ token: renter.token, role: 'BUYER' }, { token: owner.token, role: 'SELLER' }] },
      },
    });
    txId = created.transactionCreate.id as string;
    await record(deal, 'waiting', {
      p_tx: txId, p_rent: deal.rent_rands, p_deposit: deposit,
      p_allocations: (created.transactionCreate.allocations ?? []).map((a: { id: string }) => a.id),
    });
  }
  const link = await gql('mutation checkoutLink($id: ID!) { checkoutLink(transactionId: $id) }', { id: txId });
  return link.checkoutLink as string;
}

async function payout(userId: string, body: Record<string, string>) {
  const bank = BANKS[body.bank];
  const accountType = ACCOUNT_TYPES[body.accountType];
  const accountNumber = String(body.accountNumber ?? '').replace(/\s/g, '');
  const idNumber = String(body.idNumber ?? '').replace(/\s/g, '');
  if (!bank) throw new UserProblem('bank_needed');
  if (!accountType) throw new UserProblem('account_type_needed');
  if (!/^\d{6,16}$/.test(accountNumber)) throw new UserProblem('account_number');
  if (!/^\d{13}$/.test(idNumber)) throw new UserProblem('id_number');
  const { data: profile } = await db.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (!['owner', 'agent'].includes(profile?.role)) throw new UserProblem('not_a_lister');
  const token = await createToken(userId, { bank, accountNumber, accountType, idNumber });
  const { error } = await db.from('safe_accounts').upsert({
    user_id: userId, token, bank: body.bank, account_last4: accountNumber.slice(-4), account_type: body.accountType,
    can_receive: true, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return { bank: body.bank, last4: accountNumber.slice(-4) };
}

// The door ---------------------------------------------------------------------------

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(request.url);

  // TradeSafe's callback.
  if (url.searchParams.has('callback')) {
    if (!READY || url.searchParams.get('callback') !== CALLBACK_KEY) return new Response('no', { status: 403 });
    const body = await request.json().catch(() => ({}));
    const txId = typeof body?.id === 'string' ? body.id : '';
    if (txId) {
      const { data } = await db.from('deals').select('id').eq('safe_tx', txId).maybeSingle();
      if (data) {
        const deal = await loadDeal(data.id);
        if (deal) await reconcile(deal).catch((e) => console.error('callback', e.message));
      } else {
        const { data: part } = await db.from('deposit_payments').select('deal_id, part, amount_rands, due_date, safe_tx, safe_state').eq('safe_tx', txId).maybeSingle();
        const deal = part ? await loadDeal(part.deal_id) : null;
        if (deal && part) await reconcilePart(deal, part as Part).catch((e) => console.error('callback part', e.message));
      }
    }
    return new Response('ok');
  }

  if (request.method !== 'POST') return problem('bad_request', 405);
  const jwt = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who } = await db.auth.getUser(jwt);
  const userId = who?.user?.id;
  if (!userId) return problem('sign_in', 401);

  const body = await request.json().catch(() => ({}));
  if (body.action === 'status') return reply({ ready: READY, sandbox: !PRODUCTION });
  if (!READY) return reply({ waiting: true });

  try {
    if (body.action === 'payout') return reply(await payout(userId, body));
    const deal = typeof body.deal === 'string' ? await loadDeal(body.deal) : null;
    if (!deal || ![deal.owner_id, deal.renter_id].includes(userId)) return problem('deal_not_found', 404);
    if (body.action === 'pay') return reply({ url: await pay(deal, userId) });
    if (body.action === 'pay_part') return reply({ url: await payPart(deal, userId, Number(body.part)) });
    if (body.action === 'sync') {
      const state = await reconcile(deal);
      const parts: Record<number, string> = {};
      for (const part of await laterParts(deal.id)) {
        if (['waiting', 'paid'].includes(part.safe_state)) parts[part.part] = await reconcilePart(deal, part);
      }
      return reply({ state, parts });
    }
    return problem('bad_request');
  } catch (error) {
    if (error instanceof UserProblem) return problem(error.message);
    console.error(body.action, (error as Error).message);
    return problem('street_safe_down', 502);
  }
});
