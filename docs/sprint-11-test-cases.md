# Sprint 11 test cases: Promote

Paid boosts need Paystack test mode (`docs/paystack-setup.md`). Everything else works now. Use an owner with a live listing. Record failures in `docs/defect-log.md`.

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| S11-01 | Way in | Owner: My listings → a live listing | "Promote this place" link under the actions. Not shown for drafts or listings in review. |
| S11-02 | Not switched on | Promote page before the Paystack setup | "Paid boosts are not switched on yet."; tapping Pay says the same. The free tools are there. |
| S11-03 | Not the owner | Another account opens `#/list/<id>/promote` | "Only the owner of a listing can promote it." |
| S11-04 | Boost | Test mode: Pay R49, pay with a test card | Back on the Promote page: "Boosted until …". "Your boosts" lists it. |
| S11-05 | Ranking | Explore and Tours, searching the listing's area | The boosted listing is first, even above newer listings. |
| S11-06 | Featured | Pay R179 | Featured badge on the Explore card, the listing page and the ad page; the boost starts when the earlier one ends ("Featured until …"). |
| S11-07 | Cancel | Start a boost and close Paystack's page | Nothing changes; no boost. |
| S11-08 | Ad page | The listing page → Share this place (or Share or print an ad) | `#/ad/<id>`: photo, To let, price, title, area, badges, description, a QR code and the link. Works signed out. |
| S11-09 | QR | Scan the QR code with another phone | Opens the listing in Street Property. |
| S11-10 | Social post | Make a social post | A 1080 × 1350 picture: photo, TO LET, price, title, area, QR code, "Street Property". Share opens the phone's share sheet (WhatsApp, Facebook, Instagram); Save the picture downloads it. |
| S11-11 | Words | Copy the words | The text with the link is on the clipboard. |
| S11-12 | Print | Print on the ad page | Only the ad prints, black on white, with the QR code. |
| S11-13 | To Let board | Ad page → To Let board → Print | One A4 page: TO LET, what and price, a big QR code, "Scan for the video tour and to ask the owner". |
| S11-14 | Not live | Open `#/ad/<id>` for a draft | "This place is not listed right now." |
| S11-15 | True cost | A rent listing → What it really costs | "About R… a month" (rent plus a starting electricity guess) and the move-in amount. Change the estimates and add take-home pay: the total and the % of pay update; over 35% says so. Nothing is saved. |
