# Sprint 7 test cases: renter check, reports, emails

Run on phones with a **renter**, an **owner** with a live listing, and an **admin**. Email cases need the email setup in `docs/email-setup.md` done first. Record failures in `docs/defect-log.md`.

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| S7-01 | Find it | Renter: Profile → My renter check | "Your renter check": Your ID (Needed) and Your income (Needed), and how it works. |
| S7-02 | ID | Take the ID photo and a selfie, send | Your ID: "Being checked". (Same ID check as Street Verified: an owner who did it already sees it Checked.) |
| S7-03 | Income | Choose a payslip PDF and a bank statement photo, send | Your income: "Being checked". Sending with no file: "Choose a file." |
| S7-04 | Admin | Admin: Review queue → "Income: Lerato Dlamini" | The documents, a checklist and a "Monthly take-home pay" box. Approve with the box empty: "Enter the monthly take-home pay in rands." Enter 14 000 and approve. |
| S7-05 | Result | Renter: My renter check | Your income: Checked, "We noted a take-home pay of R14 000… Owners never see this amount… Good until <date>." |
| S7-06 | Share | Renter: open a conversation with an owner | "Renter check" section: move-in date, how long, who is moving in, pets, the agree box. Share without the box ticked: "Tick the box to agree to share." Tick and share. |
| S7-07 | Owner sees | Owner: open the conversation | Note "Lerato shared their renter check."; the Renter check section: "ID checked · pay covers the rent 3.1×"; Open renter check. |
| S7-08 | Owner view | Tap Open renter check | As in the design: initials, "Lerato D.", household and pets, move-in line, ID Checked, Income Checked with "3.1× take-home pay covers the rent", and Not this time / Yes, rent to Lerato. No amount, no documents anywhere. |
| S7-09 | Yes | Tap Yes, rent to Lerato | Back in the conversation; note "Good news, Lerato…" for both; the renter sees "Thabo said yes". |
| S7-10 | Not this time | With a second renter who shared: Not this time | Polite note to the renter; the owner's view says "You chose someone else"; their details are gone from the owner's screens. |
| S7-11 | Stop sharing | Renter: Stop sharing | Note "… stopped sharing"; the owner's Open renter check says "Nothing shared". |
| S7-12 | Not checked yet | A renter who sent nothing opens a conversation | "Do my renter check" instead of the share form. |
| S7-13 | Reports | Renter reports a conversation; admin opens Review queue | "Reported conversations (1)". Open it: who reported, the reason, the place, Read the conversation, What you did, Take the listing down. |
| S7-14 | Close report | Close without a note; then with a note and "Take the listing down" | No note: refused. With: the report goes; the listing is taken down; the owner sees why in My listings (and gets an email). |
| S7-15 | Email: message | Renter sends a message (email set up) | The owner gets an email within a minute: "Lerato wrote about Ngakane Street, Orlando West", with the message and an Open Street Property button. A second message within 15 minutes sends no second email. |
| S7-16 | Email: viewing | Renter suggests a time | The owner gets "Update about …: Viewing suggested for …". The renter gets nothing for their own action. |
| S7-17 | Email: checks and listing | Admin approves a listing, an ID, an income check | Each person gets an email ("Your listing is live", "Your ID check is done", …). |
| S7-18 | Emails off | Profile → untick "Email me about…", Save | No more emails for that person. |
| S7-19 | Sign-up email | Sign up a new account with a real email (after SMTP is set) | The confirmation email arrives from your sender address, not from Supabase's test sender. |
