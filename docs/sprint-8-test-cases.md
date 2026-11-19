# Sprint 8 test cases: the Street Safe deal

Run on two phones: a **renter** and an **owner** with a live listing (filmed at the address), who have a confirmed viewing and where the renter shared their renter check. Record failures in `docs/defect-log.md`.

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| S8-01 | We met: too early | More than 30 minutes before the confirmed viewing, open the conversation | No "We met" button yet. |
| S8-02 | We met: away | At viewing time, away from the place, tap We met (allow location) | "You need to be at the address…". Nothing recorded. |
| S8-03 | We met: location blocked | Block location for the site, tap We met | "Location is blocked for this site…". |
| S8-04 | We met | Both at the place: renter taps, then owner taps | Renter: "Waiting for Thabo". After the owner: "You both confirmed you met at the place" and the note in the conversation. |
| S8-05 | Deal starts | Owner: Open renter check → Yes, rent to Lerato → Go to the deal | Both see "Street Safe deal →" in the conversation, and the deal under Enquiries → Street Safe deals. |
| S8-06 | Timeline | Open the deal | Seven steps: Verified, Viewing done (Done when both tapped, "Not done" in red otherwise), Renter checked, Deposit "Coming soon · Sprint 9", Lease "Now", Move-in check, Keys. Owner: "Fill in the lease"; renter: "Waiting for Thabo to send the lease". |
| S8-07 | Lease terms | Owner: Fill in the lease; try rent 200, a past start date | Friendly errors. Then rent 6 500, deposit 6 500, a date next month, 12 months, special term "No smoking inside", Send. |
| S8-08 | Lease text | Both open the lease | Draft warning; the terms; the full lease with names, the full address, "R6 500 a month", deposit rules, inspections, 20 business days' notice, "No smoking inside"; a fingerprint; both signatures "Not signed yet". |
| S8-09 | Can't change | Owner: open the lease again | No form; the lease cannot be edited once sent. |
| S8-10 | Sign | Renter: sign with "Lerato" only; then without the box ticked | "Type your full name…"; "Tick the box…". Then sign as "Lerato Dlamini". Note "Lerato signed the lease." |
| S8-11 | Both signed | Owner signs | "The lease is signed by both. Next: the move-in check together." Timeline: Lease Done, Move-in check Now. |
| S8-12 | Print | Lease → Print or save as PDF | Only the lease and signatures print; no bars or buttons. |
| S8-13 | Move-in check | Open the move-in check | "0 of 7 rooms done", each room with Take a photo and a note box; Sign disabled until every room has a photo. |
| S8-14 | Photos | Take photos of each room on both phones | Each photo shows the stamp "Orlando West · Kitchen · 19 Nov 2026, 14:05" at the bottom; progress counts up; the other phone sees them after reloading. |
| S8-15 | Sign again after a change | Renter signs; owner then edits a note | The renter's signature is cleared; both must sign again. |
| S8-16 | Both sign the check | Both sign | Note "The move-in check is signed by both…". Owner sees no keys button. |
| S8-17 | Keys | Renter: I have the keys | Deal: "You have moved in. Welcome home!"; all steps done except the deposit. The listing leaves Explore and shows taken down "Let through Street Property on <date>" in the owner's My listings. |
| S8-18 | Call off | On a new deal before the keys: Call the deal off | Note in the conversation; the deal shows "called off"; not possible after the keys. |
| S8-19 | Privacy | A third account opens `#/deals/<id>` | "Deal not found". Move-in photo links stop working after an hour. |
