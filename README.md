# Street Property

Find a place to rent or buy in South Africa, street by street. Owners are checked, deposits are held until the keys change hands, and both sides sign the move-in check (Street Safe).

Phone-first web app: plain HTML, CSS and JavaScript (no build step), Supabase for accounts and data, GitHub Pages for hosting. Built sprint by sprint; see the build plan.

## Sprint 0 (this version)

- App shell in the Street Property look (off-white, ink, deep teal; Space Grotesk and Inter)
- Explore home screen with the Rent / Buy switch, search box and the Street Safe promise
- Accounts: sign up, log in, forgot password, set a new password
- Profile: name and role (renter or buyer, owner, agent)
- Tab bar: Explore and Profile work; Map, Saved and Enquiries are shown greyed out until their sprints
- Draft Terms and Privacy pages (to be replaced after a lawyer's review)
- Works offline as an installable app (service worker)

## Set up

1. **Supabase.** Create a project (region: Africa (Cape Town) if offered, else the nearest). In SQL Editor, paste `supabase/001_profiles.sql` and Run.
2. **Connect the app.** In `src/config.js`, fill in `SUPABASE_URL` (Project Settings, Data API) and `SUPABASE_PUBLISHABLE_KEY` (Project Settings, API Keys, the `sb_publishable_…` key). Never put a secret key in the app.
3. **Sign-in links.** In Supabase, Authentication, URL Configuration: set Site URL to the app's address and add it under Redirect URLs.
4. **Admins.** After signing up, add yourself in SQL Editor: `insert into public.admins (user_id) values ('<your user id>');`
5. **Host it.** Push to GitHub and turn on Pages (Settings, Pages, deploy from the `gh-pages` branch).

## Tests

`npm test` (Node 20+). No network needed.
