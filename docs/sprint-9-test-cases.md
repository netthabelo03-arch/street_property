# Sprint 9 test cases: Street Safe payments

Run in TradeSafe **sandbox** (see `docs/street-safe-setup.md`) on two phones: an **owner** and a **renter** with a deal whose lease both have signed. Record failures in `docs/defect-log.md`.

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| S9-01 | Not switched on | Before the setup, renter opens the deal and taps Pay | "Street Safe payments are not switched on yet…". Owner's payouts screen shows the same warning. |
| S9-02 | Order | Open a deal | Steps: Verified, Viewing, Renter checked, Lease, **Rent and deposit held by Street Safe**, Move-in check, Keys. |
| S9-03 | Owner not ready | Renter opens a signed deal before the owner set up payouts | "Waiting for Thabo to set up Street Safe payouts"; no Pay button. The owner sees "Set up Street Safe payouts". |
| S9-04 | Payout checks | Owner: Profile → Street Safe payouts; try no bank, account "12-34", ID "1234" | Friendly errors for each. |
| S9-05 | Payout saved | Save a real-looking account and a valid ID number | "Payouts go to your FNB cheque or current account ending 4417". The account and ID numbers are not shown anywhere and the boxes are empty. |
| S9-06 | Renter can't set payouts | Renter opens `#/payouts` | "Payouts are for owners and agents…". |
| S9-07 | Phone needed | Renter without a cellphone number taps Pay | "Add your cellphone number in your Profile first." |
| S9-08 | Pay | Renter taps Pay R13 000 into Street Safe | TradeSafe's sandbox page opens with R13 000 (rent + deposit). Pay by card. |
| S9-09 | Held | Back in the app, open the deal | Within a minute: "R13 000 held by TradeSafe since …"; note "Lerato paid R13 000 into Street Safe…" for both. |
| S9-10 | No paying twice | Renter opens the deal again | No Pay button. |
| S9-11 | Keys release | Finish the move-in check; renter taps I have the keys | Deal: "R13 000 paid to the owner on …"; note "Street Safe paid R13 000 to Thabo." TradeSafe sandbox shows the transaction released. |
| S9-12 | Refund | On another deal paid into Street Safe, call the deal off | Note "Street Safe is refunding R13 000 to Lerato."; deal shows "refunded to the renter". |
| S9-13 | Callback key | Open `…/functions/v1/street-safe?callback=wrong` | 403. |
| S9-14 | Privacy | In SQL Editor: `select * from safe_accounts` | Only bank, type and last 4 digits, plus TradeSafe's token. No account numbers or ID numbers anywhere. |
