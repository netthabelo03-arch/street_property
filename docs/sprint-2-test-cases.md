# Sprint 2 test cases: Explore and filters

Run on a phone (Android and iPhone), signed out and signed in. Record failures in `docs/defect-log.md`.

**Before you start:** you need at least two live listings, one to rent and one for sale, each with photos and a tour (see Sprint 1). Use different areas, prices and must-haves. The demo (`demo.html`) already has eleven.

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| S2-01 | Results | Open Explore | Live places to rent, newest checked first: cover photo, "Filmed on site", "Video tour · m:ss", price "/ month", title, place and facts. A count line such as "6 places to rent". |
| S2-02 | No house number | Look at a card and the listing page | The street shows without the house number ("Ngakane Street, Orlando West, Soweto"). |
| S2-03 | Buy | Tap Buy | Only places for sale; prices without "/ month"; the count says "for sale". Any price filter is cleared. |
| S2-04 | Search | Type "soweto", then "orlando soweto", then "zzz" | Results narrow as you type (after a short pause). Every word must match. "zzz": "Nothing matches yet" with Clear search and filters. |
| S2-05 | Odd characters | Search "%" and "_" | Nothing matches (they are not wildcards). |
| S2-06 | Filters | Tap Filters; set max rent R6 000, 2+ beds, Flat, Backup power | The button at the bottom updates: "Show N places". Tap it: back on Explore with only matching places; "Filters · 4"; chips "Up to R6 000", "2+ beds", "Flat", "Backup power". |
| S2-07 | Price check | In Filters, minimum 7000 and maximum 6000 | "The minimum is more than the maximum." The button says "Fix the price first". |
| S2-08 | Reset | Filters → Reset | Everything cleared; search words and Rent/Buy kept. |
| S2-09 | Parking | Must have: Parking | Only places with at least one parking bay. |
| S2-10 | Tours | Tap Tours | Each card plays its outside clip silently while it is on screen (the photo shows until it loads). Tap Tours again: photos come back. |
| S2-11 | Keep the search | Search and filter, open a place, tap ← Explore | The same search, filters and results. Closing the browser tab clears them. |
| S2-12 | Show more | With more than 20 matches, scroll to the end | Show more loads the next 20. |
| S2-13 | Listing page | Open a place | Photos swipe one by one (1 / 6); price; title; place; "Filmed on site" and "Checked by Street Property"; facts; must-haves; description; the video tour with a button per room. |
| S2-14 | Tour plays through | Play the first room | When a room ends, the next one starts. Tapping a room jumps to it. |
| S2-15 | Not live | Open the address of a draft or taken-down listing while signed out | "This place is not listed" with Back to Explore. |
| S2-16 | Own listing | As its owner, open your live listing from Explore | "This is your listing. Manage it." |
| S2-17 | Signed out | Log out and repeat S2-01 to S2-13 | Everything works without an account; no tab bar. |
| S2-18 | No listings at all | (Fresh project) Open Explore | "No places listed yet"; owners see List your place. |
