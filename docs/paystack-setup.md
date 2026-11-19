# Paid boosts setup (Paystack)

Owners pay for boosts (R49, R99, R179) on Paystack's own page by card or EFT. Until the steps below are done, the Promote page says "Paid boosts are not switched on yet"; the free tools (ad page, social post, To Let board) work already.

Never paste the secret key into a chat or into the app's code. It goes only into Supabase.

## 1. Paystack
1. Sign up at paystack.com as a South African business. Live payments need the business checks (KYC) and a South African bank account in the business name; test mode works straight away.
2. **Settings → API Keys & Webhooks** (test mode first):
   - Copy the **Test Secret Key** (starts with `sk_test_`).
   - **Test Webhook URL:** `https://oyydaebikpdrbaaiquhi.supabase.co/functions/v1/promote`
3. Leave the callback URL empty in Paystack: the app sends its own with each payment.

## 2. Supabase
1. **Edge Functions → promote → Settings:** switch **Verify JWT with legacy secret** off and save. (The function checks the app's login itself; Paystack's webhook arrives without one and is checked by its signature.)
2. **Edge Functions → Secrets → Add new secret:** `PAYSTACK_SECRET_KEY` = the test secret key.

## 3. Check (test mode)
1. Open one of your live listings → **Promote this place**. The page says "Test mode".
2. Tap **Pay R49** and pay with a Paystack test card on Paystack's page.
3. You come back to the Promote page; within a few seconds it says "Boosted until …".
4. In Explore, the listing is now first for its area. A R179 boost also shows a **Featured** badge.
5. If nothing changes, look at **Edge Functions → promote → Logs**.

## Going live
Swap the secret for the **Live Secret Key** (`sk_live_…`), and set the **Live Webhook URL** in Paystack to the same address as above.

## Prices
The prices are in three places that must match (the tests check this): `boost_price()` in `supabase/014_promote.sql`, `PRICES` in `supabase/functions/promote/index.ts`, and `BOOSTS` in `src/promote/rules.js`.
