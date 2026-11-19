# Sprint 4 test cases: enquiries and viewings

Run on two phones (or a phone and a computer), one signed in as the **owner** of a live listing and one as a **renter**. Record failures in `docs/defect-log.md`.

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| S4-01 | Signed out | Open a live listing while logged out | "Interested? Ask the owner" with "Log in to ask the owner". After logging in you are back on the same listing. |
| S4-02 | First message | As the renter, open the listing | A message box, pre-filled ("Hi, is this place still available?…"). Edit it and tap Send to the owner. The conversation opens with your message. |
| S4-03 | Own listing | As the owner, open your own listing | No Ask box; "This is your listing. Manage it." |
| S4-04 | Same conversation | As the renter, open the listing again | "Open your conversation" instead of a new message box. |
| S4-05 | Unread badge | As the owner | The Enquiries tab shows a gold number. Enquiries → Messages: the conversation in bold, "Sipho · Asking you", with the preview. Open it: the badge goes. |
| S4-06 | Reply | Owner replies; renter keeps the conversation open | The reply appears within about 8 seconds without reloading. |
| S4-07 | Long or empty | Send an empty message; paste over 1000 characters | Nothing is sent for an empty box; the box stops at 1000 characters. |
| S4-08 | Suggest a viewing | Renter: choose tomorrow at 06:30, then 10:00 | 06:30: "Viewings are between 07:00 and 19:00." 10:00: the panel shows the date tile and "Waiting for Lerato"; a note in the messages: "Viewing suggested for …". |
| S4-09 | Confirm | Owner: open the conversation | "Lerato suggested this time" → the owner sees "Sipho suggested this time" with Confirm / This time does not work. Tap Confirm. |
| S4-10 | Address after confirming | Renter: look at the viewing panel and the place at the top | The full address with the house number now shows. Before confirming it showed only the street name. |
| S4-11 | WhatsApp | Owner: Profile → add cell number, tick "Share it on WhatsApp…", Save. Renter: reopen the conversation | A green "WhatsApp Lerato (082 …)" button. It opens WhatsApp with a message ready. Without the tick: no button. |
| S4-12 | Number stays private | Before a confirmed viewing, or for a third account | No WhatsApp button and no number anywhere. |
| S4-13 | Different time | Owner: "Suggest a different time" → another day | The confirmed viewing is replaced; the renter is asked to confirm the new time. |
| S4-14 | Decline / cancel | Renter: "This time does not work"; then suggest again and "Withdraw this time" | Notes appear in the messages; the full address goes back to the street name. |
| S4-15 | Viewings tab | Renter: Enquiries → Viewings | Upcoming viewings by date with the date tile, title, place, day and time, and status. |
| S4-16 | Scam warning | Owner sends "Please pay the deposit first by EFT" | The renter sees a yellow warning under that message. |
| S4-17 | Report | Renter: Report this conversation, with a reason | "Thank you. We will look at this conversation." A one-word reason is refused. |
| S4-18 | Taken down | Owner takes the listing down | The renter's conversation says "No longer listed"; no new viewing can be suggested; messages still work. |
| S4-19 | Someone else | A third account opens the conversation's address | "Conversation not found". |
| S4-20 | Profile number | Enter "12345" as cell number | "Enter a South African cell number, like 082 123 4567." |
