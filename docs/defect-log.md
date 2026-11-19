# Defect log

| ID | Date | Sprint found | Sprint fixed | Area | What went wrong | Expected | Severity | Status |
|----|------|--------------|--------------|------|-----------------|----------|----------|--------|
| D-001 | 2026-11-19 | 0 | 1 | Explore | The owner empty state promised listing "soon" | Now links to List your place and My listings | Low | Fixed |
| D-002 | 2026-11-19 | 0 | 1 | Look | An unclosed comment in app.css hid the styles for status chips, the top-bar links and small buttons. The Log out button showed as a plain grey box and chips had no colour. | Chips are coloured; Log out matches the top bar. A test now checks that every comment is closed. | Medium | Fixed |
| D-003 | 2026-11-19 | 1 | 1 | Video tour | After Start camera, the camera label still said "Camera off" | Shows "Ready: <room>" | Low | Fixed |
| D-004 | 2026-11-19 | 1 | 1 | Review | Long distances showed as metres ("17283 m") | "17.3 km" | Low | Fixed |
| D-005 | 2026-11-19 | 0 | 2 | Explore | The Street Safe card promised checked owners and held deposits, which are not built yet | Says what is true now (checked listings, tours filmed at the address) and what is coming | Medium | Fixed |
| D-006 | 2026-11-19 | 2 | 3 | Privacy | Anyone could read the full street address and the exact filmed spot of a live listing from the database, even though the screens hid the house number | Only the owner and admins can read them; everyone else gets the street name and a spot rounded to about 100 m | High | Fixed |
| D-007 | 2026-11-19 | 0 | 4 | Log in | The "come back after logging in" memory used a name left over from plusespot (event-cal.next) | Named street-property.next | Low | Fixed |
| D-008 | 2026-11-19 | 5 | 5 | Tours | A clip could stay paused on its first frame when the phone ignored play() while it was loading | Play is tried again as soon as the clip can play (tour feed and full-screen tour) | Medium | Fixed |
| D-009 | 2026-11-19 | 6 | 7 | Street Verified | Document photos were shrunk like listing photos (1600 px), so small print on a deed or rates account could be unreadable | Documents keep up to 2600 px (6 MB) | Medium | Fixed |
| D-010 | 2026-11-19 | 6 | 7 | Street Verified | The ID and selfie pickers also offered PDFs although they open the camera | Photos only, button says "Take a photo" | Low | Fixed |
| D-011 | 2026-11-19 | 8 | 8 | Lease | The lease end date was worked out as a timestamp, so writing the lease failed (found by the dry run, before release) | The end date is a date | High | Fixed |
