# Street Safe payments setup (TradeSafe)

Street Safe holds the renter's first month's rent and deposit at **TradeSafe**, a registered South African escrow service, until the renter confirms the keys. Then TradeSafe pays the owner. If the deal is called off first, the renter is refunded.

Until the steps below are done, the app says "Street Safe payments are not switched on yet" and nobody can pay.

Never paste the client secret into a chat or into the app's code. It goes only into Supabase.

## 1. TradeSafe (start in sandbox, no real money)
1. Register at tradesafe.co.za and open the **developer portal** (developer.tradesafe.co.za).
2. **Create an application** in sandbox mode.
3. In the application settings:
   - **API Callback URL:**
     `https://oyydaebikpdrbaaiquhi.supabase.co/functions/v1/street-safe?callback=<your callback word>`
     Make up the callback word yourself: a long random word, for example 30 letters and numbers. You use the same word in step 2.
   - **Success URL** and **Failure URL:** `https://netthabelo03-arch.github.io/street_property/#/enquiries`
   - **Payment gateways:** card, Ozow and EFT (SnapScan optional).
4. Copy the **Client ID** and **Client secret**.

## 2. Supabase
1. **Edge Functions → street-safe → Settings:** switch **Verify JWT with legacy secret** off and save. (The function checks the app's login itself; TradeSafe's callbacks arrive without one.)
2. **Edge Functions → Secrets → Add new secret:**
   - `TRADESAFE_CLIENT_ID` = the Client ID
   - `TRADESAFE_CLIENT_SECRET` = the Client secret
   - `STREET_SAFE_CALLBACK_KEY` = the callback word from step 1.3
   - Optional: `STREET_SAFE_FEE_PAYER` = `SELLER` (the owner pays TradeSafe's fee, the default), `BUYER` or `BUYER_SELLER`.
3. Leave `TRADESAFE_ENV` unset while testing (sandbox). For real money set it to `production`, after TradeSafe has approved the live application, and change the keys to the live ones.

## 3. Check (sandbox)
1. Owner: Profile → **Street Safe payouts**: the screen says "Test mode". Save a bank account (sandbox accepts test details).
2. Do a deal to "lease signed by both", then the renter taps **Pay R… into Street Safe** and pays on TradeSafe's sandbox page.
3. Within a minute the deal shows "held by TradeSafe" and the conversation gets a note.
4. Finish the move-in check; the renter taps **I have the keys**. The deal shows "paid to the owner".
5. If something does not move, look at **Edge Functions → street-safe → Logs**.

## Before going live
- The lawyer's answer on the deposit: today Street Safe releases the deposit to the owner when the renter gets the keys, and the lease says the owner keeps it in an interest-bearing account. Holding it until move-out instead is possible later.
- Check the bank names against TradeSafe's list (enum `UniversalBranchCode` in their API playground) and fix `BANKS` in `supabase/functions/street-safe/index.ts` if any differ.
