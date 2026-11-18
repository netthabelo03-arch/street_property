# Sprint 1 test cases: listings, video tour, review

Run on a phone (Android and iPhone). Record failures in `docs/defect-log.md`.

**Before you start**
- You need two accounts:
  - **Owner:** on Profile, set "I use Street Property as" to Owner.
  - **Admin:** a second account. To make it an admin, run this in Supabase (SQL Editor), with that account's user id from Authentication → Users:
    `insert into public.admins (user_id) values ('<user id>');`
- Film the tour at a real place: your location is saved with every clip.

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| S1-01 | Renter blocked | As a renter, open `#/list/new` | "Only owners and agents can list a place", with a button to the profile. Explore shows no List your place button. |
| S1-02 | Start a listing | As an owner, on Explore tap List your place | Step 1 of 3. Rent it out is chosen; the price box says "Rent per month (R)". |
| S1-03 | Sell | Tap Sell it | The price box says "Asking price (R)"; Deposit and Available from disappear. Tap Rent it out again: they come back. |
| S1-04 | Wrong details | Tap Next with everything empty | "Some details need fixing"; red messages under type of place, street, suburb, city and price. Nothing is saved. |
| S1-05 | Price limits | Rent R100, then R4 500 | R100: "Enter an amount between R300 and R500 000." R4 500 (typed with a space) is accepted. |
| S1-06 | Photos before saving | Fill in the details, add 3 photos from the gallery | They show with "Not saved yet"; the first is marked Cover. The hint says "3 of at least 5". |
| S1-07 | Save draft | Tap Save draft | The address changes to `#/list/<id>`; the photos lose "Not saved yet". My listings shows the place as Draft. |
| S1-08 | More photos | Add 3 more; make the 4th the cover; remove one | Each photo is added within a few seconds (shrunk on the phone). Cover moves first; the removed one is gone after a reload. |
| S1-09 | Photo limit | Try to add photos past 12 | "Only N more photos can be added (up to 12)"; Add photos disappears at 12. |
| S1-10 | Camera and location | Next: film your video tour, then Start camera | The phone asks for location, then the camera. The back camera shows; the code (4 letters and numbers) is in the corner; "Location found (within about N m)". |
| S1-11 | Location blocked | Block location for the site, then Start camera | "Location is blocked for this site…"; the camera does not start. |
| S1-12 | Record a room | Record outside and gate for about 10 seconds, then Stop | The button counts up ("Stop · 0:10 of 0:30"); after Stop: "Saving clip…", then "Saved: Outside and gate."; the room shows ✓ 0:10; the next room is chosen. |
| S1-13 | Code in the clip | Tap the filmed room to play it | The clip plays and shows the code and date and time in the top corner, burned into the video. No sound. |
| S1-14 | 30-second limit | Record a room without pressing Stop | Recording stops by itself at 0:30 and saves. |
| S1-15 | 2-minute limit | Fill the tour to 2:00 | The record button says "The tour is full (2:00)". Filming a room again frees its time. |
| S1-16 | Film again / remove | Pick a filmed room, Film again; then Remove clip on another | The new clip replaces the old one (one row, new time). The removed room shows no tick. |
| S1-17 | Leave the screen | While the camera is on, go to Profile | The camera light goes off. |
| S1-18 | Not ready to send | Go to step 3 with 4 photos and 2 clips | "Before you can send it" lists the missing photo and clips; Send for checking is greyed out. |
| S1-19 | Send | Complete to 5+ photos, outside and 3 more rooms; Send for checking | Back on My listings: "Being checked". Opening Details or Film the tour says the listing is locked. |
| S1-20 | Stop the review | Open the listing, Stop the review to make changes (tap twice) | Status back to Draft; it can be edited again. Send it again. |
| S1-21 | Not visible yet | Log in as a renter (or log out) | Nothing about the listing shows anywhere. |
| S1-22 | Review queue | As the admin, Profile → Review queue | The listing shows, with when it was sent. |
| S1-23 | Check a listing | Open it | Details, all photos, each clip playable with its code, time and distance from the outside clip; "Open the filmed spot in Google Maps" opens the spot. |
| S1-24 | Ask for changes | Tap Ask for changes with no note, then with "Film the bathroom too" | No note: "Say what the owner needs to change". With the note: back to the queue, which is now empty. |
| S1-25 | Owner sees the note | As the owner, open My listings | "Changes needed" with "We asked: Film the bathroom too". Edit, send again. |
| S1-26 | Approve | As the admin, approve it | Back to the queue. The owner's listing shows Live. |
| S1-27 | Take down | As the owner, Take it down (tap twice) | Status Taken down. It can be edited and sent again. |
| S1-28 | Delete a draft | Start a new listing with photos and a clip, then Delete this draft (tap twice) | It is gone from My listings, and its photos and clips are deleted from storage (Supabase → Storage). |
| S1-29 | Old browser | Open Film your video tour in a browser that cannot record | "This browser cannot film the tour…" with Skip for now. |
