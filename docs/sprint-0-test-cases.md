# Sprint 0 test cases

Run on a phone (Android and iPhone) after the setup in the README. Record failures in `docs/defect-log.md`.

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| S0-01 | Explore, signed out | Open the app | Street Property logo, Sign up and Log in at the top; "Find your place"; Rent / Buy switch; search box; "No places listed yet"; Create a free account; the Street Safe card. No tab bar. |
| S0-02 | Rent / Buy | Tap Buy, then Rent | The heading changes to "Homes for sale near you", then back to "Places to rent near you". |
| S0-03 | Sign up | Sign up with a new email and a password missing a symbol | The checklist shows the missing rule; the account is not created. |
| S0-04 | Sign up | Sign up with a strong password | The account is created (or a confirmation email is sent, if that is switched on). You land on Explore, signed in, with the tab bar. |
| S0-05 | Existing email | Sign up again with the same email | "An account with this email already exists. Sign in instead." |
| S0-06 | Log in | Log out, then log in with a wrong password, then the right one | Wrong: "Email or password is incorrect." Right: back on Explore. |
| S0-07 | Forgot password | Forgot password, enter the email, open the link | The new-password screen opens; after saving, you are signed in. |
| S0-08 | Profile | Profile tab: set a name, choose Owner, Save | "Saved."; the top bar shows the first name and an "Owner" chip. Reload: still saved. |
| S0-09 | Explore as owner | Back to Explore as an owner | The empty state says you will be able to list your place soon. |
| S0-10 | Protected screen | Log out, then open `#/profile` | You are sent to Log in; after logging in you land on Profile. |
| S0-11 | Tabs | Tap Map, Saved, Enquiries | Nothing happens; they are greyed out (coming soon). |
| S0-12 | Offline | Turn on airplane mode, reload | The app opens from its saved copy and shows the yellow offline bar. |
| S0-13 | Not connected | (Before step 2 of the setup) Try to sign up | "Accounts are not switched on yet…" |
| S0-14 | Terms and Privacy | Open the links on the sign-up screen | Each page says it is a draft and lists placeholders. |
