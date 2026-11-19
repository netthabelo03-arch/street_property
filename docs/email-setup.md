# Email setup (Brevo, free)

Street Property sends two kinds of email:
1. **Sign-up and password emails**, sent by Supabase Auth. They need an SMTP server (Supabase's own only reaches your team).
2. **Notifications** (messages, viewings, listing reviews, checks), sent by the `send-emails` Edge Function.

One free Brevo account covers both (300 emails a day). No domain name is needed to start: Brevo lets you send from one email address you confirm. When you have a domain (for example streetproperty.co.za), add it in Brevo for better delivery.

Never paste the keys into a chat or into the app's code. They go only into Brevo and Supabase.

## 1. Brevo
1. Sign up at brevo.com.
2. **Senders, domains and dedicated IPs → Senders → Add a sender**, with the email address the mails should come from, and confirm the code Brevo emails you.
3. **SMTP and API → API keys → Generate a new API key**. Copy it (it starts with `xkeysib-`).
4. **SMTP and API → SMTP**: note the SMTP server (`smtp-relay.brevo.com`), port `587`, your login, and generate an SMTP key.

## 2. Notifications (Supabase → Edge Functions)
1. **Functions → send-emails → Settings**: switch **Verify JWT with legacy secret** off, then **Save changes**. (The database wakes this function without a login; all it can do is send what the database queued.)
2. **Secrets → Add new secret**:
   - `BREVO_API_KEY` = the API key from step 1.3
   - `EMAIL_FROM` = `Street Property <the sender address from step 1.2>`

## 3. Sign-up emails (Supabase → Authentication → Emails → SMTP Settings)
Switch on **Enable custom SMTP** and fill in:
- Sender email: the sender address from step 1.2; sender name: Street Property
- Host `smtp-relay.brevo.com`, port `587`
- Username: your Brevo SMTP login; password: the SMTP key from step 1.4

Save. Then in **Authentication → Rate limits** raise "emails per hour" (for example to 100).

## Check
Sign up with a new email address: the confirmation should arrive from your sender address. Send a message in the app: the other person should get an email within a minute. If not, look at **Edge Functions → send-emails → Logs**.
