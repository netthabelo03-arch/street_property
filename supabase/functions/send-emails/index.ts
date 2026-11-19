// Street Property: sends the emails waiting in public.email_outbox.
//
// Deployed as the Edge Function "send-emails" with "Verify JWT" switched off:
// calling it needs no secret, because all it does is send what the database
// already queued. The database wakes it whenever an email is queued.
//
// Secrets (Supabase → Edge Functions → Secrets), set by the project owner:
//   BREVO_API_KEY   or   RESEND_API_KEY   (one of the two)
//   EMAIL_FROM      for example  Street Property <hello@yourdomain.co.za>
//   APP_URL         optional, defaults to the GitHub Pages address
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Without an email key nothing is sent and the emails wait. Emails older than a
// day are dropped instead of being sent late.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const APP_URL = Deno.env.get('APP_URL') ?? 'https://netthabelo03-arch.github.io/street_property/';
const FROM = Deno.env.get('EMAIL_FROM') ?? '';
const BREVO = Deno.env.get('BREVO_API_KEY') ?? '';
const RESEND = Deno.env.get('RESEND_API_KEY') ?? '';
const BATCH = 25;

type Email = { id: string; to_user: string; subject: string; body: string; link: string; created_at: string; attempts: number };

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function render(email: Email) {
  const link = APP_URL + email.link;
  const text = `${email.body}\n\nOpen Street Property: ${link}\n\nYou get these emails because you use Street Property. Turn them off in your Profile.`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#16191D;max-width:520px">
<p style="font-weight:bold;color:#0F2E28">Street Property</p>
<p>${escapeHtml(email.body).replace(/\n/g, '<br>')}</p>
<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#157F6A;color:#fff;border-radius:8px;text-decoration:none">Open Street Property</a></p>
<p style="font-size:12px;color:#6b7076">You get these emails because you use Street Property. Turn them off in your Profile.</p>
</div>`;
  return { text, html };
}

function fromParts() {
  const match = FROM.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return match ? { name: match[1] || 'Street Property', email: match[2] } : { name: 'Street Property', email: FROM.trim() };
}

async function send(to: string, email: Email) {
  const { text, html } = render(email);
  if (BREVO) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: fromParts(), to: [{ email: to }], subject: email.subject, textContent: text, htmlContent: html }),
    });
    if (!response.ok) throw new Error(`Brevo ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${RESEND}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject: email.subject, text, html }),
  });
  if (!response.ok) throw new Error(`Resend ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

Deno.serve(async () => {
  if ((!BREVO && !RESEND) || !FROM) {
    return Response.json({ sent: 0, waiting: true, reason: 'No email service set up yet (BREVO_API_KEY or RESEND_API_KEY, and EMAIL_FROM).' });
  }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Drop emails that would arrive more than a day late.
  await db.from('email_outbox').update({ error: 'too old, not sent' })
    .is('sent_at', null).is('error', null).lt('created_at', new Date(Date.now() - 86400000).toISOString());

  const { data: waiting, error } = await db.from('email_outbox')
    .select('id, to_user, subject, body, link, created_at, attempts')
    .is('sent_at', null).is('error', null).lt('attempts', 5)
    .order('created_at').limit(BATCH);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0;
  for (const email of (waiting ?? []) as Email[]) {
    // Claim it first, so two wake-ups at once cannot send it twice.
    const { data: claimed } = await db.from('email_outbox')
      .update({ attempts: email.attempts + 1 }).eq('id', email.id).eq('attempts', email.attempts).is('sent_at', null)
      .select('id');
    if (!claimed?.length) continue;
    try {
      const { data: user } = await db.auth.admin.getUserById(email.to_user);
      const to = user?.user?.email;
      if (!to) throw new Error('no email address');
      await send(to, email);
      await db.from('email_outbox').update({ sent_at: new Date().toISOString(), error: null }).eq('id', email.id);
      sent += 1;
    } catch (problem) {
      const message = String((problem as Error)?.message ?? problem).slice(0, 300);
      await db.from('email_outbox').update({ error: email.attempts + 1 >= 5 ? message : null }).eq('id', email.id);
    }
  }
  return Response.json({ sent });
});
