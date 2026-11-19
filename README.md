# Street Property

Find a place to rent or buy in South Africa, street by street. Owners are checked, deposits are held until the keys change hands, and both sides sign the move-in check (Street Safe).

Phone-first web app: plain HTML, CSS and JavaScript (no build step), Supabase for accounts and data, GitHub Pages for hosting. Built sprint by sprint; see the build plan.

Live: https://netthabelo03-arch.github.io/street_property/

## Sprint 10 (this version): rent record, reminders, reviews

- **Rent record:** when the renter confirms the keys, every month of the lease gets a line with its due date. The renter pays the earliest due month through Street Safe (passed straight to the owner), or the owner taps **Mark received** for rent paid another way. Each paid month is the written receipt the lease promises.
- **Reminders:** every morning at 07:00 (South African time) the renter gets an email 3 days before rent or a deposit part is due and on the day; at 3 days late a note goes into the conversation. Runs in the database (`pg_cron`).
- **Rate your deal:** after the keys, owner and renter each rate the other once, 1 to 5 stars with a few words. Reviews stay hidden until both have rated, or 14 days after the keys. Owners' ratings show on their listings; renters' ratings show on their shared renter check.
- Debit orders are left for later.
- Database: `supabase/013_rent_reviews.sql` (dry run, 10 checks). Test cases: `docs/sprint-10-test-cases.md`.

## Sprint 9: Street Safe payments

- After both sign the lease, the renter pays the **first month's rent and the deposit** into **TradeSafe** (a registered South African escrow service) by card, Ozow or EFT on TradeSafe's own page.
- TradeSafe holds the money until the renter taps **I have the keys**, then pays the owner. If the deal is called off first, the renter is refunded.
- Owners and agents add their payout account under **Profile → Street Safe payouts**. The account and ID numbers go straight to TradeSafe; Street Property keeps only the bank, the account type and the last 4 digits.
- The deal's steps are now in the order they happen: lease, then payment, then the move-in check and keys.
- **Deposit plans:** the owner can let the renter pay the deposit in 2 or 3 parts. Part 1 goes with the move-in payment (held until the keys); later parts are paid with the rent after moving in and passed straight to the owner. The plan is written into the lease. Database: `supabase/012_deposit_plans.sql` (dry run, 8 checks).
- Database: `supabase/011_street_safe.sql` (dry run, 8 checks). Edge Function: `supabase/functions/street-safe`. TradeSafe's callbacks are never trusted: the function asks TradeSafe for the real state.
- **Switching it on:** `docs/street-safe-setup.md`. Test cases: `docs/sprint-9-test-cases.md`.

## Sprint 8: the Street Safe deal

- **We met:** at a confirmed viewing, both people tap "We met" at the address (checked by location, within about 300 m).
- **The deal** starts when the owner says yes to a renter's check: seven steps from Verified to Keys, with what to do next for each side. The deposit step is Sprint 9.
- **The lease:** the owner fills in rent, deposit, start date, length and any special terms; the database writes the lease from a standard template, and both sign by typing their full name. Each signature is tied to a SHA-256 fingerprint of the exact text. **The template is a draft and must be reviewed by a lawyer before launch.**
- **The move-in check:** every room photographed in the app (stamped with place, room and time) with notes; both sign once every room has a photo. Any change clears the signatures.
- **Keys:** the renter confirms; the listing comes down as let.
- Database: `supabase/010_deals.sql` (dry run `supabase/tests/010_dryrun.sql`, 13 checks). Photos sit in the private `deal-photos` bucket.
- Test cases: `docs/sprint-8-test-cases.md`.

## Sprint 7: renter check, reports, emails

- **Renter check** (`#/renter-check`, from Profile):
  - **Checks:** the ID check (the same one as Street Verified) plus income, from payslips or bank statements.
  - **Admins** check by hand: they write down the monthly take-home pay, and the documents are deleted. The result is good for 3 months.
  - **Later:** Stitch's bank link can replace the hand check without changing the screens.
- **Sharing in a conversation:** the renter adds the move-in date, how long, who is moving in and pets, ticks to agree, and shares.
  - **What the owner sees** (`#/enquiries/<id>/check`, as in the design): "ID checked" and "3.1× take-home pay covers the rent". Never the amount or the documents.
  - **The owner's answer:** "Yes, rent to …" or "Not this time". Not this time removes the renter's details from the owner's view.
  - The renter can stop sharing at any time.
- **Reported conversations** (`#/review/reports`): admins read the conversation (only while the report is open), close it with what they did, and can take the listing down.
- **Email notifications:**
  - **When:** new messages (at most one per conversation every 15 minutes), viewing updates, listing approved or sent back or taken down, and check results.
  - **How:** an outbox in the database and the `send-emails` Edge Function, through Brevo or Resend.
  - **Turning them off:** a setting on the Profile.
  - **Setup:** see `docs/email-setup.md`.
- **Database:** `supabase/008_renter_check.sql` (dry run: 11 checks) and `supabase/009_reports_email.sql` (dry run: 9 checks).
- **Sprint 6 fixes:** document photos keep enough detail for small print, and the ID and selfie pickers take photos only.

## Sprint 6: Street Verified

- **Prove your place is real** (`#/list/<id>/verify`, from the listing's page in My listings). Three checks earn the badge:
  1. **ID:** a photo of the ID or passport, and a selfie. Done once per person.
  2. **Proof of ownership:** a title deed or rates account. Agents send their Fidelity Fund Certificate and the owner's mandate.
  3. **Check-in at the property:** the video tour filmed at the address.
- **Admins** check IDs and documents by hand in the review queue (`#/review/check/<kind>/<id>`), with a checklist, and approve or reject with a note.
  - **Documents** sit in a private bucket that only admins can open, and are deleted as soon as a check is decided. Only the result is kept.
  - **Later:** an ID-check provider and Lexis WinDeed can replace the hand checks without changing the screens.
- **Badge:** a gold "Street Verified" badge on cards, the listing page, the tour feed and My listings, plus a "Street Verified only" filter.
  - It comes off if the address changes.
  - It is optional: listings still go live after the normal review.
- **Database:** `supabase/007_verified.sql`; its dry run has 14 checks.

## Sprint 5: tour feed and saved places

- **Tour feed** (`#/tours`, from the Tours chip on Explore): one place at a time, full screen, its video tour playing room by room.
  - **Moving around:** swipe up for the next place and down for the one before; tap right or left for rooms. The next place's tour loads in advance, and more places load before the end.
  - **Follows Explore:** the same Rent / Buy, search words and filters, shown as a label at the top.
  - **Actions:** Save (heart), Ask, Share (the phone's share sheet, or copy the link) and Book a viewing.
- **Saved tab** (`#/saved`): hearted places, newest first. A place no longer listed stays, marked, until removed. The heart is also on each listing page.
- **Database:** `supabase/006_saved.sql`; its dry run has 7 checks. Only live places can be saved, each person sees only their own, and there is a limit of 200.

## Sprint 4: enquiries and viewings

- **Ask the owner** on every live listing, with a first message ready. Logging in brings you back to the listing.
- **Enquiries tab:** Viewings (upcoming, by date) and Messages (every conversation, with unread counts). The tab shows a badge for unread messages.
- **Conversation:**
  - **Messages:** checked every 8 seconds while open.
  - **Viewing panel:** suggest a time (07:00 to 19:00, up to 60 days ahead), confirm or decline, suggest a different time, or cancel. Notes are added to the messages.
- **After a confirmed viewing:** the renter sees the full address, and each side sees the other's WhatsApp button if that person chose to share their number (Profile). Both last until two days after the viewing.
- **Safety:** a warning under messages that ask for money or bank details before a viewing, and Report this conversation. There are limits of 15 new enquiries a day and 60 messages an hour.
- **Terms and Privacy:** the drafts now cover messages, phone sharing and the private address.
- **Database:** `supabase/005_enquiries.sql`; its dry run has 18 checks.

## Sprint 3: map, full-screen tour, private address

- **Map tab** (`#/map`): live listings as price pins on a dark street map.
  - **Search as you move:** pins update for the area on screen, with Explore's Rent / Buy and filters.
  - **Pins:** tap one to see its card. Pins sit on a spot rounded to about 100 m, never on the house.
  - **Library:** Leaflet 1.9.4 from cdnjs, checked with an integrity hash. Map tiles come from OpenStreetMap; switch `TILES` in `src/map/leaflet.js` to a provider with an API key before launch.
- **Listing page:**
  - **Full-screen tour:** room after room, with a bar per room; tap right for next, left for back.
  - **The area:** a small map with a circle, not a pin.
- **Private address:** the full street and exact spots are now readable only by the owner and admins, through `listing_private()` and `clip_places()`.
  - **Everyone else gets:** `street_public` (no house number) and `approx_lat` / `approx_lng`.
  - **Database:** `supabase/004_map.sql`; its dry run has 12 checks.

## Sprint 2: Explore and filters

- **Explore** shows live listings, newest checked first, 20 at a time with Show more.
  - **Each card:** cover photo, "Filmed on site", tour length, price, title, place and key facts.
  - **Rent / Buy**, and search by street, suburb, township or city. Every word must match.
  - **Tours:** each card plays its outside clip, silently, while it is on screen.
- **Filters:** price range, bedrooms, type of place, and must-haves (backup power, water, prepaid electricity, pets, parking). The button shows how many places match. Filters are kept while you browse and cleared when the tab closes.
- **Listing page** (`#/place/<id>`): swipeable photos, facts, must-haves, and the video tour, which plays room after room. Sprint 3 adds the map; Sprint 4 adds Ask the owner.
- **Privacy:** the public sees the street without the house number.
- **Database:** `supabase/003_search.sql` adds `search_listings()`. It runs with the caller's own rights, so only live listings ever show. The dry run (`supabase/tests/003_dryrun.sql`) runs 12 checks.
- **Demo** (`demo.html`): eleven sample places, and it starts as a renter on Explore.

## Sprint 1: listings and video tours

- **List a property** (owners and agents), in 3 steps:
  1. **Details and photos:** rent or sell, type of place, address, price, deposit, rooms, what the place has, about. 5 to 12 photos, shrunk on the phone to 1600 px before upload.
  2. **Film your video tour:** one clip per room, up to 30 seconds each and 2 minutes in all. Today's code for the listing and the time are burned into the corner of every clip, and the phone's location is saved with each clip. No sound.
  3. **Send for checking:** a checklist of anything missing, then send.
- **My listings:** every listing with its state (Draft, Being checked, Changes needed, Live, Taken down). From here the owner can stop a review, take a listing down or delete a draft.
- **Review queue (admins):** photos, every clip with its code, time and distance from the outside clip, a link to the filmed spot on Google Maps, then Approve or Ask for changes (with a note).
- **Database:** `supabase/002_listings.sql`. Only database functions change a listing's state. Clips can only be saved through `add_tour_clip()`, which writes the code and time itself. Files are kept in private storage buckets: photos up to 2 MB, clips up to 12 MB.
- **Dry run:** `supabase/tests/002_dryrun.sql` runs 24 checks and then rolls everything back.

Limits to watch:
- A listing uses about 2 MB of photos and up to 18 MB of video.
- Supabase's free plan has 1 GB of storage, which is roughly 45 listings.
- Move to the Pro plan (100 GB) before launch.

## Sprint 0



- App shell in the Street Property look (dark charcoal, teal and a gold street line; Space Grotesk and Inter)
- Explore home screen with the Rent / Buy switch, search box and the Street Safe promise
- Accounts: sign up, log in, forgot password, set a new password
- Profile: name and role (renter or buyer, owner, agent)
- Tab bar: Explore and Profile work; Map, Saved and Enquiries are shown greyed out until their sprints
- Draft Terms and Privacy pages (to be replaced after a lawyer's review)
- Works offline as an installable app (service worker)

## Set up

1. **Supabase.** Create a project (region: Africa (Cape Town) if offered, else the nearest). In SQL Editor, run `supabase/001_profiles.sql`, then `supabase/002_listings.sql`, then `supabase/003_search.sql`, then `supabase/004_map.sql`, then `supabase/005_enquiries.sql`, then `supabase/006_saved.sql`, then `supabase/007_verified.sql`, `008_renter_check.sql`, `009_reports_email.sql`, `010_deals.sql`, `011_street_safe.sql`, `012_deposit_plans.sql` and `013_rent_reviews.sql`. Deploy `supabase/functions/send-emails` and `supabase/functions/street-safe` as Edge Functions and follow `docs/email-setup.md` and `docs/street-safe-setup.md`.
2. **Connect the app.** In `src/config.js`, fill in `SUPABASE_URL` (Project Settings, Data API) and `SUPABASE_PUBLISHABLE_KEY` (Project Settings, API Keys, the `sb_publishable_…` key). Never put a secret key in the app.
3. **Sign-in links.** In Supabase, Authentication, URL Configuration: set Site URL to the app's address and add it under Redirect URLs.
4. **Admins.** After signing up, add yourself in SQL Editor: `insert into public.admins (user_id) values ('<your user id>');`
5. **Host it.** Push to GitHub and turn on Pages (Settings, Pages, deploy from the `gh-pages` branch).
6. **Before every deploy,** run `node tools/stamp.mjs`. It gives each file in `index.html` a versioned address, so phones never mix old and new files after an update. The tests fail if you forget.

## Tests

`npm test` (Node 20+). No network needed.
