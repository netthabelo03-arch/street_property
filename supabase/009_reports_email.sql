-- Sprint 7 (launch readiness): the admin screen for reported conversations,
-- and email notifications.
-- Run this once in the Supabase dashboard (SQL Editor) after 008_renter_check.sql.
-- Safe to run again.

-- Reports ----------------------------------------------------------------------

alter table public.enquiry_reports add column if not exists resolved_at timestamptz;
alter table public.enquiry_reports add column if not exists resolved_by uuid references auth.users (id) on delete set null;
alter table public.enquiry_reports add column if not exists outcome text check (outcome is null or char_length(outcome) <= 500);

-- Open reports, oldest first, with who reported whom and about which place.
create or replace function public.report_list()
returns table (
  id uuid,
  enquiry_id uuid,
  reason text,
  created_at timestamptz,
  reporter_name text,
  reporter_side text,
  renter_name text,
  owner_name text,
  listing_id uuid,
  street text,
  area text,
  listing_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins handle reports' using errcode = 'P0001', hint = 'not_admin';
  end if;
  return query
    select r.id, r.enquiry_id, r.reason, r.created_at,
      coalesce(nullif(btrim(rp.full_name), ''), 'No name given'),
      case when r.reporter_id = e.renter_id then 'renter' else 'owner' end,
      coalesce(nullif(btrim(pr.full_name), ''), 'No name given'),
      coalesce(nullif(btrim(po.full_name), ''), 'No name given'),
      l.id, l.street, l.area, l.status
    from public.enquiry_reports r
    join public.enquiries e on e.id = r.enquiry_id
    join public.listings l on l.id = e.listing_id
    left join public.profiles rp on rp.id = r.reporter_id
    left join public.profiles pr on pr.id = e.renter_id
    left join public.profiles po on po.id = e.owner_id
    where r.resolved_at is null
    order by r.created_at;
end;
$$;

-- The messages of a reported conversation (only while a report on it is open).
create or replace function public.report_messages(p_report uuid)
returns table (sender text, kind text, body text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins handle reports' using errcode = 'P0001', hint = 'not_admin';
  end if;
  return query
    select case when m.sender_id is null then 'note' when m.sender_id = e.renter_id then 'renter' else 'owner' end,
           m.kind, m.body, m.created_at
    from public.enquiry_reports r
    join public.enquiries e on e.id = r.enquiry_id
    join public.messages m on m.enquiry_id = e.id
    where r.id = p_report and r.resolved_at is null
    order by m.created_at;
end;
$$;

-- Close a report with what was done. Optionally take the listing down.
create or replace function public.resolve_report(p_report uuid, p_outcome text, p_take_down boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  outcome_text text := nullif(btrim(coalesce(p_outcome, '')), '');
  listing uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins handle reports' using errcode = 'P0001', hint = 'not_admin';
  end if;
  if outcome_text is null or char_length(outcome_text) < 5 or char_length(outcome_text) > 500 then
    raise exception 'Write down what was done' using errcode = 'P0001', hint = 'outcome_needed';
  end if;
  select e.listing_id into listing
    from public.enquiry_reports r join public.enquiries e on e.id = r.enquiry_id
    where r.id = p_report and r.resolved_at is null;
  if listing is null then
    raise exception 'This report is already closed' using errcode = 'P0001', hint = 'report_closed';
  end if;
  update public.enquiry_reports set resolved_at = now(), resolved_by = auth.uid(), outcome = outcome_text where id = p_report;
  if p_take_down then
    update public.listings set status = 'taken_down', review_note = 'Taken down by Street Property after a report: ' || outcome_text
    where id = listing and status in ('live', 'in_review');
  end if;
end;
$$;

-- Email notifications -------------------------------------------------------------
-- Database changes put emails in an outbox; a small server function (the
-- "send-emails" Edge Function) sends them through Brevo or Resend once an API
-- key is set, and marks them sent. Nobody using the app can read the outbox.

alter table public.profiles add column if not exists email_notifications boolean not null default true;
grant update (email_notifications) on public.profiles to authenticated;

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_user uuid not null references auth.users (id) on delete cascade,
  topic text not null,
  topic_key text,
  subject text not null,
  body text not null,
  link text not null default '#/',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts smallint not null default 0,
  error text
);
create index if not exists email_outbox_waiting_idx on public.email_outbox (created_at) where sent_at is null;
create index if not exists email_outbox_recent_idx on public.email_outbox (to_user, topic_key, created_at);
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;

-- Queue one email, unless the person turned emails off, or the same kind of
-- email about the same thing went out in the last 15 minutes.
create or replace function public.queue_email(p_user uuid, p_topic text, p_key text, p_subject text, p_body text, p_link text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null then return; end if;
  if not coalesce((select p.email_notifications from public.profiles p where p.id = p_user), true) then return; end if;
  if p_key is not null and exists (
    select 1 from public.email_outbox o
    where o.to_user = p_user and o.topic_key = p_key and o.created_at > now() - interval '15 minutes'
  ) then return; end if;
  insert into public.email_outbox (to_user, topic, topic_key, subject, body, link)
  values (p_user, p_topic, p_key, left(p_subject, 150), left(p_body, 2000), coalesce(p_link, '#/'));
end;
$$;
revoke all on function public.queue_email(uuid, text, text, text, text, text) from public, anon, authenticated;

-- A new message or note: email the other person in the conversation.
create or replace function public.email_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  talk public.enquiries;
  place public.listings;
  title text;
  writer text;
  recipient uuid;
begin
  select * into talk from public.enquiries e where e.id = new.enquiry_id;
  select * into place from public.listings l where l.id = talk.listing_id;
  title := coalesce(place.street_public, place.area) || ', ' || place.area;
  if new.kind = 'text' then
    recipient := case when new.sender_id = talk.renter_id then talk.owner_id else talk.renter_id end;
    writer := public.first_name_of(new.sender_id, case when new.sender_id = talk.renter_id then 'A renter' else 'The owner' end);
    perform public.queue_email(recipient, 'message', 'enquiry:' || talk.id,
      writer || ' wrote about ' || title,
      writer || ' wrote:' || chr(10) || chr(10) || left(new.body, 400),
      '#/enquiries/' || talk.id);
  else
    -- Notes (viewings, renter checks) go to the person who did not cause them.
    recipient := case when auth.uid() = talk.renter_id then talk.owner_id
                      when auth.uid() = talk.owner_id then talk.renter_id end;
    perform public.queue_email(recipient, 'note', 'note:' || talk.id || ':' || md5(new.body),
      'Update about ' || title, new.body, '#/enquiries/' || talk.id);
  end if;
  return null;
end;
$$;
drop trigger if exists email_on_message on public.messages;
create trigger email_on_message after insert on public.messages
  for each row execute function public.email_on_message();

-- A listing approved or sent back: email its owner.
create or replace function public.email_on_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = old.status then return null; end if;
  if new.status = 'live' and old.status = 'in_review' then
    perform public.queue_email(new.owner_id, 'listing', null,
      'Your listing is live',
      'We checked your listing in ' || new.area || ' and it is now live. Renters can see it, watch the tour and ask you about it.',
      '#/list/' || new.id || '/send');
  elsif new.status = 'changes_needed' then
    perform public.queue_email(new.owner_id, 'listing', null,
      'Your listing needs a change',
      'We checked your listing in ' || new.area || '. Please change this, then send it again:' || chr(10) || chr(10) || coalesce(new.review_note, ''),
      '#/list/' || new.id || '/send');
  elsif new.status = 'taken_down' and new.review_note like 'Taken down by Street Property%' then
    perform public.queue_email(new.owner_id, 'listing', null, 'Your listing was taken down', new.review_note, '#/list/' || new.id || '/send');
  end if;
  return null;
end;
$$;
drop trigger if exists email_on_review on public.listings;
create trigger email_on_review after update of status on public.listings
  for each row execute function public.email_on_review();

-- Checks decided: email the person.
create or replace function public.email_on_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid;
  what text;
  link text;
begin
  if new.status = old.status or new.status not in ('approved', 'rejected') then return null; end if;
  if tg_table_name = 'identity_checks' then
    who := new.user_id; what := 'ID check'; link := '#/profile';
  elsif tg_table_name = 'income_checks' then
    who := new.user_id; what := 'income check'; link := '#/renter-check';
  else
    select l.owner_id into who from public.listings l where l.id = new.listing_id;
    what := 'proof of ownership'; link := '#/list/' || new.listing_id || '/verify';
  end if;
  perform public.queue_email(who, 'check', null,
    case when new.status = 'approved' then 'Your ' || what || ' is done' else 'Your ' || what || ' was not accepted' end,
    case when new.status = 'approved' then 'Your ' || what || ' is approved. The documents you sent have been deleted.'
         else 'We could not accept your ' || what || ':' || chr(10) || chr(10) || coalesce(new.note, '') || chr(10) || chr(10) || 'The documents you sent have been deleted. Please send new ones.' end,
    link);
  return null;
end;
$$;
drop trigger if exists email_on_identity_check on public.identity_checks;
create trigger email_on_identity_check after update of status on public.identity_checks
  for each row execute function public.email_on_check();
drop trigger if exists email_on_ownership_check on public.ownership_checks;
create trigger email_on_ownership_check after update of status on public.ownership_checks
  for each row execute function public.email_on_check();
drop trigger if exists email_on_income_check on public.income_checks;
create trigger email_on_income_check after update of status on public.income_checks
  for each row execute function public.email_on_check();

-- Wake the sender when something is queued. The function only sends what is
-- in the outbox, so calling it needs no secret.
create extension if not exists pg_net with schema extensions;

create or replace function public.wake_email_sender()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://oyydaebikpdrbaaiquhi.supabase.co/functions/v1/send-emails',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return null;
exception when others then
  -- Never block the app because the email sender could not be reached.
  return null;
end;
$$;
drop trigger if exists wake_email_sender on public.email_outbox;
create trigger wake_email_sender after insert on public.email_outbox
  for each statement execute function public.wake_email_sender();

do $$
declare
  fn text;
begin
  foreach fn in array array['public.report_list()', 'public.report_messages(uuid)', 'public.resolve_report(uuid, text, boolean)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
