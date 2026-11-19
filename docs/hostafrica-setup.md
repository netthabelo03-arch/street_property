# Moving the website to HostAfrica

The app stays on the free Supabase plan for now (database, logins, files, payments, reminders). HostAfrica hosts the website itself, on your own .co.za domain, with your email.

GitHub Pages keeps working as a second copy while you move.

## 1. Order the hosting
1. On hostafrica.co.za order **cPanel Web Hosting Starter** (it includes a free .co.za domain and SSL).
2. Choose the domain, for example `streetproperty.co.za`. Check that it is free first.
3. Wait for the welcome email with your cPanel login. Log in to cPanel yourself; never paste the password into a chat.

## 2. Turn on HTTPS
cPanel → **SSL/TLS Status** → **Run AutoSSL**. Wait until the domain shows a green lock (a few minutes, up to an hour after the domain is new).

## 3. Put the app on the domain (once)
1. cPanel → **Git Version Control** → **Create**.
2. Switch on **Clone a Repository**.
   - Clone URL: `https://github.com/netthabelo03-arch/street_property.git`
   - Repository path: `repositories/street_property`
   - Repository name: `street_property`
3. **Create**. Then **Manage** → **Pull or Deploy** → **Deploy HEAD Commit**.
4. Open `https://<your domain>/`: Street Property should load.

The file `.cpanel.yml` copies only what the app needs into `public_html`; `.htaccess` turns on HTTPS, keeps the database scripts and notes private, and makes phones check for new files after each update.

## 4. Every update after that
cPanel → **Git Version Control** → **Manage** → **Pull or Deploy** → **Update from Remote**, then **Deploy HEAD Commit**. (Two clicks after each sprint.)

## 5. Tell Claude the domain
Then these get switched to the new address:
- Supabase → Authentication → URL Configuration: the Site URL and redirect URLs (sign-up and password emails link there).
- The `APP_URL` secret for the emails, Street Safe and Promote functions.
- The success and failure addresses in TradeSafe, and the docs.

## 6. Email
- cPanel → **Email Accounts** → create `hello@<your domain>` for people to write to.
- App notifications keep going through Brevo; add the domain in Brevo (Senders, domains) so they come from `hello@<your domain>`.
- Sign-up and password emails can use either Brevo SMTP (`docs/email-setup.md`) or this mailbox: host `mail.<your domain>`, port 465, the mailbox and its password, typed into Supabase by you.

## On the free Supabase plan
- A project with no visits for 7 days is paused. Before launch, if that happens, open the Supabase dashboard and press **Restore**; once people use the app every day it stays awake.
- Limits to watch (Supabase → Usage): 500 MB database and 1 GB of files. Video tours fill the files first (about 45 listings). That is the moment to choose: Supabase Pro, or moving everything to a HostAfrica server.
