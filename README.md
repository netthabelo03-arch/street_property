# Street Property

Find a place to rent or buy in South Africa, street by street. Owners are checked, deposits are held until the keys change hands, and both sides sign the move-in check (Street Safe).

Phone-first web app: plain HTML, CSS and JavaScript (no build step), Supabase for accounts and data, GitHub Pages for hosting. Built sprint by sprint; see the build plan.

Live: https://netthabelo03-arch.github.io/street_property/

## Sprint 1 (this version): listings and video tours

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

1. **Supabase.** Create a project (region: Africa (Cape Town) if offered, else the nearest). In SQL Editor, run `supabase/001_profiles.sql`, then `supabase/002_listings.sql`.
2. **Connect the app.** In `src/config.js`, fill in `SUPABASE_URL` (Project Settings, Data API) and `SUPABASE_PUBLISHABLE_KEY` (Project Settings, API Keys, the `sb_publishable_…` key). Never put a secret key in the app.
3. **Sign-in links.** In Supabase, Authentication, URL Configuration: set Site URL to the app's address and add it under Redirect URLs.
4. **Admins.** After signing up, add yourself in SQL Editor: `insert into public.admins (user_id) values ('<your user id>');`
5. **Host it.** Push to GitHub and turn on Pages (Settings, Pages, deploy from the `gh-pages` branch).

## Tests

`npm test` (Node 20+). No network needed.
