# Sprint 6 test cases: Street Verified

Run on a phone. You need an **owner** account with a listing that has a video tour, an **agent** account with a listing, and an **admin** account. Record failures in `docs/defect-log.md`.

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| S6-01 | Find it | Owner: My listings → open the listing | A gold box "Get the Street Verified badge · 1 of 3 checks done" (the tour counts). Tap it. |
| S6-02 | The screen | Look at "Prove your place is real" | Three checks: Your ID (Needed), Proof you own it (Needed), Check in at the property (✓ Done, because of the tour). Badge box: "1 of 3 checks done". The privacy note under it. |
| S6-03 | ID | Tap "Choose photo or file" under ID: the camera opens (back camera). Under selfie: the front camera. Send | "Being checked" on Your ID. Sending without one of the photos: "Choose a file." |
| S6-04 | Proof | Choose a photo or PDF of a rates account; Send | "Being checked". A PDF over 8 MB: "That PDF is over 8 MB. Send a photo of it instead." |
| S6-05 | Agent | Agent: open the checks for their listing | Proof asks for two files: the Fidelity Fund Certificate and the owner's mandate. Sending one only is refused. |
| S6-06 | Queue | Admin: Profile → Review queue | "Street Verified checks (N)" at the top: "ID: Lerato Dlamini" and "Ownership: 24 Ngakane Street, Orlando West". |
| S6-07 | Check the ID | Open the ID check | The ID photo and the selfie, with a checklist. "Not accepted" without a note: "Say what the person needs to send instead." With a note: back to the queue. |
| S6-08 | Owner sees why | Owner: open the checks | Your ID: "Not accepted", "Why: …", and the pickers again. Send again. |
| S6-09 | Approve | Admin approves the ID and the proof | Back to the queue each time. |
| S6-10 | Badge | Owner: open the checks; then Explore, the listing, the tour feed and My listings | "Street Verified · Earned". A gold "Street Verified" badge on the card, the listing page (with what was checked), the feed and "Verified" in My listings. |
| S6-11 | Documents deleted | Admin: Supabase → Storage → verification-docs | No files left for the decided checks. |
| S6-12 | Filter | Explore → Filters → "Street Verified only" | Only verified places. |
| S6-13 | New address | Owner: stop the review, change the street address, send again | The badge goes; Proof you own it is Needed again. |
| S6-14 | Private | A renter (or logged out) | Never sees anyone's documents or check status; only the badge. |
| S6-15 | One ID for all | Owner with a second listing: open its checks | Your ID is already Done ("Checked once for all your listings"). |
