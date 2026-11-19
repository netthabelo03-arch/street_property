# Sprint 3 test cases: map, full-screen tour, private address

Run on a phone (Android and iPhone). Record failures in `docs/defect-log.md`.

**Before you start:** have at least three live listings in different areas, some close together (see Sprint 1).

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| S3-01 | Map tab | Tap Map in the tab bar (or the Map chip on Explore when signed out) | A dark street map of Johannesburg and Soweto with a price pin for each live listing in view. The line under it says how many places are here. |
| S3-02 | Move the map | Drag to another area, zoom out | Pins update for the new area after a moment. |
| S3-03 | Pin | Tap a pin | It turns green; the listing card shows under the map. Tap the card: the listing opens. Tap the empty map: the card goes. |
| S3-04 | Filters on the map | Switch to Buy; set Filters (e.g. 2+ beds) | Only matching pins. Sale pins show R895k or R1.45m. Search words from Explore do not apply on the map. |
| S3-05 | Back to the same spot | Open a listing from the map, go back | The map is where you left it. |
| S3-06 | Pin is not the house | Compare a pin with the real address | The pin is within about 100 m, not on the house. Two listings in the same block get separate pins. |
| S3-07 | Many places | With more than 50 live listings in view | "Showing the 50 newest of N… Zoom in to see more." |
| S3-08 | Area on the listing | Open a listing; scroll to The area | A small map with a circle about 250 m across; "The exact address is not shown publicly." |
| S3-09 | Full-screen tour | Tap "Watch the tour full screen" | Black full screen. Bars across the top, one per room; the room name and "1 of 5". Clips play one after another. |
| S3-10 | Skip | Tap the right side, then the left side | Right: next room. Left: start of this room, or the room before if you tap near the start. |
| S3-11 | Pause | Tap the pause button at the bottom | The clip pauses; tap again to play. |
| S3-12 | End | Let it play to the end | "That was the whole tour" with Watch again and Close. |
| S3-13 | Close | Tap ✕ (or Esc, or the phone's back button) | Back on the listing, scrolled where you were. |
| S3-14 | Owner still sees the address | As the owner, open My listings and your listing's page | The full street with the house number shows on your own screens, and in edit details. |
| S3-15 | Admin still sees everything | As an admin, open the review queue and a listing | The full address, and the distance of each clip from the outside clip. |
| S3-16 | Address hidden from others | Signed out, open a listing | Only the street name, no house number, anywhere on the page. |
