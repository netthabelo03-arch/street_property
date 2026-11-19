// Street Property: paid boosts through Paystack.
//
// Deployed as the Edge Function "promote" with "Verify JWT" switched off,
// because Paystack's webhook arrives without a Supabase login. Calls from the
// app are checked here instead: they must carry the person's login.
//
//   action "status" → whether boosts can be bought, and the prices
//   action "boost"  → { listing, tier }: opens an order and returns Paystack's
//                     payment page (card, EFT and the other methods Paystack offers)
//   action "verify" → { listing }: asks Paystack about the owner's unpaid orders
//                     for that listing (used when they come back from paying)
//   webhook         → Paystack's charge.success. The body is never trusted: the
//                     payment is looked up with Paystack before a boost starts.
//
// Secrets (Supabase → Edge Functions → Secrets), set by the project owner:
//   PAYSTACK_SECRET_KEY   sk_test_… while testing, sk_live_… for real money
//   APP_URL               optional, defaults to the GitHub Pages address
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Without the key, every action answers { waiting: true }.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://netthabelo03-arch.github.io/street_property/';
const READY = SECRET.startsWith('sk_');
const TEST_MODE = SECRET.startsWith('sk_test_');
export const PRICES = { week: { rands: 49, days: 7 }, fortnight: { rands: 99, days: 14 }, month: { rands: 179, days: 30 } };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const problem = (code: string, status = 400) => reply({ error: code }, status);

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

async function paystack(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false) throw new Error(`Paystack ${response.status}: ${String(data.message ?? '').slice(0, 200)}`);
  return data.data;
}

async function hmacSha512Hex(key: string, body: string) {
  const crypto = globalThis.crypto.subtle;
  const k = await crypto.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const signature = await crypto.sign('HMAC', k, new TextEncoder().encode(body));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Ask Paystack about one order (its reference is the boost id) and act on the answer. */
async function settle(boostId: string) {
  let paid: { status: string; amount: number; currency: string } | null = null;
  try {
    paid = await paystack(`/transaction/verify/${encodeURIComponent(boostId)}`);
  } catch {
    return 'pending';
  }
  if (paid?.status === 'success' && paid.currency === 'ZAR') {
    const { data, error } = await db.rpc('boost_paid', { p_boost: boostId, p_amount_cents: paid.amount });
    if (error) throw new Error(error.message);
    return data as string;
  }
  if (['failed', 'abandoned', 'reversed'].includes(paid?.status ?? '')) {
    await db.rpc('boost_failed', { p_boost: boostId });
    return 'failed';
  }
  return 'pending';
}

class UserProblem extends Error {}

async function startBoost(userId: string, listingId: string, tier: string) {
  if (!(tier in PRICES)) throw new UserProblem('boost_tier');
  const { data: order, error } = await db.rpc('boost_create', { p_owner: userId, p_listing: listingId, p_tier: tier });
  if (error) throw new UserProblem(error.hint || 'street_safe_down');
  const { data: auth } = await db.auth.admin.getUserById(userId);
  const email = auth?.user?.email;
  if (!email) throw new UserProblem('email_needed');
  const page = await paystack('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email,
      amount: order.amount_rands * 100,
      currency: 'ZAR',
      reference: order.id,
      callback_url: `${APP_URL}#/list/${listingId}/promote`,
      metadata: { kind: 'boost', listing: listingId, tier, cancel_action: `${APP_URL}#/list/${listingId}/promote` },
    }),
  });
  return page.authorization_url as string;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return problem('bad_request', 405);
  const raw = await request.text();

  // Paystack's webhook.
  const signature = request.headers.get('x-paystack-signature');
  if (signature !== null) {
    if (!READY) return new Response('no', { status: 403 });
    if (!sameText(await hmacSha512Hex(SECRET, raw), signature)) return new Response('bad signature', { status: 401 });
    const event = JSON.parse(raw || '{}');
    const reference = String(event?.data?.reference ?? '');
    if (event?.event === 'charge.success' && /^[0-9a-f-]{36}$/i.test(reference)) {
      await settle(reference).catch((e) => console.error('webhook', e.message));
    }
    return new Response('ok');
  }

  const jwt = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who } = await db.auth.getUser(jwt);
  const userId = who?.user?.id;
  if (!userId) return problem('sign_in', 401);

  const body = JSON.parse(raw || '{}');
  if (body.action === 'status') return reply({ ready: READY, test: TEST_MODE, prices: PRICES });
  if (!READY) return reply({ waiting: true });

  try {
    if (body.action === 'boost') return reply({ url: await startBoost(userId, String(body.listing ?? ''), String(body.tier ?? '')) });
    if (body.action === 'verify') {
      const { data: open } = await db.from('listing_boosts').select('id')
        .eq('owner_id', userId).eq('listing_id', String(body.listing ?? '')).eq('state', 'pending')
        .gt('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString());
      const results: Record<string, string> = {};
      for (const order of open ?? []) results[order.id] = await settle(order.id);
      return reply({ results });
    }
    return problem('bad_request');
  } catch (error) {
    if (error instanceof UserProblem) return problem(error.message);
    console.error(body.action, (error as Error).message);
    return problem('promote_down', 502);
  }
});
