# Sprint 10 test cases: rent record, reminders, reviews

Use a deal where the renter has confirmed the keys. Payments through Street Safe need the TradeSafe sandbox (`docs/street-safe-setup.md`); everything else works without it. Record failures in `docs/defect-log.md`.

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| S10-01 | Record starts | Renter confirms the keys; either side opens the deal | A **Rent record** button. The record lists every month of the lease with its due date; month 1 shows "Paid … through Street Safe" if the move-in payment went through Street Safe, otherwise "Due". |
| S10-02 | Before the keys | Open `#/deals/<id>/rent` on a deal not yet moved in | "The rent record starts when the renter confirms the keys." |
| S10-03 | Mark received | Owner: on a due month, type "EFT" and tap Mark received | The month shows "Paid …, confirmed by the owner · EFT"; note in the conversation "Thabo confirmed receiving the rent for February 2027 (R6 500)." |
| S10-04 | Only due months | Owner looks at months more than 10 days away | No Mark received button ("Later"). |
| S10-05 | Renter can't mark | Renter opens the record | No Mark received buttons. |
| S10-06 | Pay in order | Renter: the earliest unpaid month that is due has "Pay R6 500 through Street Safe"; later months have none | Pays on TradeSafe's sandbox page; back in the app the month shows Paid through Street Safe and the conversation gets "Lerato paid the rent for … through Street Safe. It was passed to Thabo." |
| S10-07 | Not switched on | Before the TradeSafe setup, renter taps Pay | "Street Safe payments are not switched on yet. Pay the owner as agreed and ask them to mark it received." |
| S10-08 | Reminders | In SQL Editor: `select public.send_rent_reminders('<due date minus 3 days>');` for a test deal | The renter gets an email "Rent of R6 500 is due on …" (once the email setup is done; until then it waits in `email_outbox`). Running it again sends nothing more. The same with the due date sends "due today"; with the due date plus 3 days a note "… is 3 days late." goes into the conversation. |
| S10-09 | Daily | Supabase → Integrations → Cron | Job `street-property-rent-reminders`, every day at 05:00 UTC (07:00 in South Africa). |
| S10-10 | Rate | Renter: deal page → Rate your deal; send without stars | "Choose 1 to 5 stars." Then 5 stars and a few words → "Lerato rated the deal. Rate yours to see what they said." The owner does **not** see the words yet. |
| S10-11 | Both rated | Owner rates 4 stars | "You have both rated the deal…"; both reviews show on the deal page. |
| S10-12 | Once | Try to rate again | No form; your review shows. |
| S10-13 | On the listing | Open one of the owner's listings, signed out | "Owner rated ★ 5.0 from 1 renter" in The place. |
| S10-14 | On the renter check | The owner of another listing opens this renter's shared check | "★ 4.0 from 1 owner" under the renter's name. A renter with none: "No reviews from owners yet." |
| S10-15 | 14 days | A deal where only one side rated, more than 14 days after the keys | The single review shows on the deal and counts on the listing. |
