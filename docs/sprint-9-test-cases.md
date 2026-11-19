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

## Deposit plans

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| S9-15 | Plan choice | Owner fills in the lease: deposit 6 500, Deposit "In 3 parts" | The line under it reads "R2 168 before moving in, R2 166 on 1 January 2027, R2 166 on 1 February 2027" (dates follow the start date). |
| S9-16 | Too small | Deposit 500 in 2 parts, Send | "A deposit paid in parts must be at least R300 a part." |
| S9-17 | In the lease | Send the lease; both open it | Clause 5: "The deposit is R6 500. It is paid in 3 parts: R2 168 before moving in, R2 166 with the rent on … and R2 166 with the rent on …". The terms say "Deposit R6 500 in 3 parts". |
| S9-18 | Move-in payment | After signing, renter opens the deal | Button "Pay R8 668 into Street Safe" (rent + part 1). The deal shows "Deposit in 3 parts": part 1 with the move-in payment, parts 2 and 3 with due dates, all "To pay". |
| S9-19 | Later parts wait | Before the keys | No Pay button on parts 2 and 3. |
| S9-20 | Pay a part | After the keys, renter taps Pay part 2 and pays on TradeSafe's sandbox page | Part 2 shows "Paid to the owner"; note "Lerato paid deposit part 2 of 3 (R2 166) through Street Safe. It was passed to Thabo." |
