# Sprint 5 test cases: tour feed and saved places

Run on a phone (Android and iPhone). You need at least three live listings with tours. Record failures in `docs/defect-log.md`.

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| S5-01 | Open the feed | Explore → Tours | Full screen. The first place's tour plays: bars at the top (one per room), "Outside and gate · 1 of 5", the label ("All areas · to rent · any price"), and at the bottom "Filmed on site", the price, title, street and area, and Book a viewing. |
| S5-02 | Follows the search | On Explore search "soweto", Buy, Filters max price; then Tours | Only matching places; the label says so ("Soweto · for sale · under R…"). |
| S5-03 | Rooms | Tap the right side, then the left | Next room; start of the room or the room before. When the last room ends, the next place starts. |
| S5-04 | Places | Swipe up, then down (or the ⌄ / ⌃ buttons; arrow keys on a computer) | Next place, then back. The next place starts quickly (its tour is loaded in advance). |
| S5-05 | End | Swipe past the last place | "That's all N places", with Change filters and Watch from the start. |
| S5-06 | Save while logged out | Logged out, tap Save | The log-in screen; after logging in, back on the feed. |
| S5-07 | Save | Logged in, tap Save on a place | The heart fills, "Saved"; a note "Saved. Find it in the Saved tab." Tap again: "Removed from Saved". |
| S5-08 | Ask / Book a viewing | Tap Ask, or Book a viewing | The listing page opens, with the Ask box. |
| S5-09 | Share | Tap Share | The phone's share sheet (WhatsApp, SMS…) with the place's link; on a computer "Link copied". The link opens that listing for anyone. |
| S5-10 | Close | Tap ✕ | Back on Explore; nothing keeps playing. |
| S5-11 | No matches | Search "zzz", then Tours | "No tours match yet" with Change filters and Back to Explore. |
| S5-12 | Saved tab | Open the Saved tab | Saved places newest first as cards, each with Remove from saved. The count line says how many. |
| S5-13 | Heart on a listing | Open a listing | "♡ Save this place"; tap: "♥ Saved"; it shows in Saved. Not shown on your own listing. |
| S5-14 | Taken down | Owner takes down a saved place | In Saved it shows "No longer listed" with Remove from saved; no price or photo. |
| S5-15 | Private | Another account opens Saved | Only their own saved places. |
