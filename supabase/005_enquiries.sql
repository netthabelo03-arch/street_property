-- Sprint 4: enquiries (a conversation between a renter or buyer and the
-- owner or agent about one listing), messages, and viewings.
-- Run this once in the Supabase dashboard (SQL Editor) after 004_map.sql.
-- Safe to run again.
--
-- Privacy rules:
--   * only the two people in a conversation can read it;
--   * the full street address is shown to the renter only once a viewing is
--     confirmed (until two days after it);
--   * a phone number is shown to the other person only if its owner chose to
--     share it on WhatsApp, and only once a viewing is confirmed.
-- Everything is written through the functions below, never directly.

-- Phone and WhatsApp choice on the profile (each person reads only their own).
alter table public.profiles add column if not exists phone text
  check (phone is null or phone ~ '^\+27[1-9][0-9]{8}$');
alter table public.profiles add column if not exists share_whatsapp boolean not null default false;
grant update (full_name, role, phone, share_whatsapp) on public.profiles to authenticated;

-- Conversations --------------------------------------------------------------

create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  renter_id uuid not null references auth.users (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  renter_read_at timestamptz not null default now(),
  owner_read_at timestamptz not null default 'epoch',
  unique (listing_id, renter_id),
  check (renter_id <> owner_id)
);
create index if not exists enquiries_renter_idx on public.enquiries (renter_id, last_message_at desc);
create index if not exists enquiries_owner_idx on public.enquiries (owner_id, last_message_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  -- null for notes the app adds itself ("Viewing confirmed for …")
  sender_id uuid references auth.users (id) on delete set null,
  kind text not null default 'text' check (kind in ('text', 'system')),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists messages_enquiry_idx on public.messages (enquiry_id, created_at);

create table if not exists public.viewings (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  starts_at timestamptz not null,
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'declined', 'cancelled')),
  proposed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
-- At most one viewing waiting or confirmed per conversation.
create unique index if not exists viewings_one_active_idx on public.viewings (enquiry_id) where status in ('proposed', 'confirmed');

create table if not exists public.enquiry_reports (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (char_length(reason) between 5 and 500),
  created_at timestamptz not null default now()
);

alter table public.enquiries enable row level security;
alter table public.messages enable row level security;
alter table public.viewings enable row level security;
alter table public.enquiry_reports enable row level security;

drop policy if exists "The two people read their conversation" on public.enquiries;
create policy "The two people read their conversation"
  on public.enquiries for select to authenticated
  using ((select auth.uid()) in (renter_id, owner_id));

drop policy if exists "The two people read its messages" on public.messages;
create policy "The two people read its messages"
  on public.messages for select to authenticated
  using (exists (select 1 from public.enquiries e where e.id = enquiry_id and (select auth.uid()) in (e.renter_id, e.owner_id)));

drop policy if exists "The two people read its viewings" on public.viewings;
create policy "The two people read its viewings"
  on public.viewings for select to authenticated
  using (exists (select 1 from public.enquiries e where e.id = enquiry_id and (select auth.uid()) in (e.renter_id, e.owner_id)));

drop policy if exists "Admins read reports" on public.enquiry_reports;
create policy "Admins read reports"
  on public.enquiry_reports for select to authenticated
  using ((select public.is_admin()));

revoke all on public.enquiries, public.messages, public.viewings, public.enquiry_reports from anon, authenticated;
grant select on public.enquiries, public.messages, public.viewings, public.enquiry_reports to authenticated;

-- Helpers --------------------------------------------------------------------

-- The conversation, locked, if the caller is one of its two people.
create or replace function public.my_enquiry(p_enquiry uuid)
returns public.enquiries
language plpgsql
security definer
set search_path = ''
as $$
declare
  found public.enquiries;
begin
  select * into found from public.enquiries e where e.id = p_enquiry for update;
  if found.id is null or auth.uid() is null or auth.uid() not in (found.renter_id, found.owner_id) then
    raise exception 'Conversation not found' using errcode = 'P0001', hint = 'enquiry_not_found';
  end if;
  return found;
end;
$$;
revoke all on function public.my_enquiry(uuid) from public, anon, authenticated;

create or replace function public.clean_message(p_body text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  body text := btrim(coalesce(p_body, ''));
begin
  if body = '' then
    raise exception 'Write a message first' using errcode = 'P0001', hint = 'message_empty';
  end if;
  if char_length(body) > 1000 then
    raise exception 'Keep messages under 1000 characters' using errcode = 'P0001', hint = 'message_too_long';
  end if;
  return body;
end;
$$;

-- "Sat 22 Nov at 10:00", South African time.
create or replace function public.viewing_words(p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$ select to_char(p_at at time zone 'Africa/Johannesburg', 'Dy FMDD Mon "at" HH24:MI'); $$;

create or replace function public.add_note(p_enquiry uuid, p_body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.messages (enquiry_id, sender_id, kind, body) values (p_enquiry, null, 'system', p_body);
  -- The note is news to the other person, not to whoever caused it.
  update public.enquiries set
    last_message_at = now(),
    renter_read_at = case when auth.uid() = renter_id then now() else renter_read_at end,
    owner_read_at = case when auth.uid() = owner_id then now() else owner_read_at end
  where id = p_enquiry;
$$;
revoke all on function public.add_note(uuid, text) from public, anon, authenticated;

-- Starting and writing ---------------------------------------------------------

-- Ask about a live listing. Asking again about the same listing continues the
-- same conversation. Returns the conversation's id.
create or replace function public.start_enquiry(p_listing uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  place public.listings;
  body text := public.clean_message(p_body);
  found uuid;
begin
  if me is null then
    raise exception 'Log in first' using errcode = 'P0001', hint = 'not_signed_in';
  end if;
  select * into place from public.listings l where l.id = p_listing;
  if place.id is null or place.status <> 'live' then
    raise exception 'This place is no longer listed' using errcode = 'P0001', hint = 'listing_not_live';
  end if;
  if place.owner_id = me then
    raise exception 'This is your own listing' using errcode = 'P0001', hint = 'own_listing';
  end if;
  select e.id into found from public.enquiries e where e.listing_id = p_listing and e.renter_id = me;
  if found is null then
    if (select count(*) from public.enquiries e where e.renter_id = me and e.created_at > now() - interval '1 day') >= 15 then
      raise exception 'You have asked about many places today. Try again tomorrow.' using errcode = 'P0001', hint = 'too_many_enquiries';
    end if;
    insert into public.enquiries (listing_id, renter_id, owner_id) values (p_listing, me, place.owner_id)
      on conflict (listing_id, renter_id) do nothing
      returning id into found;
    if found is null then
      select e.id into found from public.enquiries e where e.listing_id = p_listing and e.renter_id = me;
    end if;
  end if;
  perform public.send_message(found, body);
  return found;
end;
$$;

create or replace function public.send_message(p_enquiry uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  talk public.enquiries := public.my_enquiry(p_enquiry);
  body text := public.clean_message(p_body);
  made uuid;
begin
  if (select count(*) from public.messages m where m.sender_id = me and m.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'You are sending messages very fast. Wait a few minutes.' using errcode = 'P0001', hint = 'too_many_messages';
  end if;
  insert into public.messages (enquiry_id, sender_id, kind, body) values (talk.id, me, 'text', body) returning id into made;
  update public.enquiries set
    last_message_at = now(),
    renter_read_at = case when me = renter_id then now() else renter_read_at end,
    owner_read_at = case when me = owner_id then now() else owner_read_at end
  where id = talk.id;
  return made;
end;
$$;

create or replace function public.mark_read(p_enquiry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  talk public.enquiries := public.my_enquiry(p_enquiry);
begin
  update public.enquiries set
    renter_read_at = case when me = renter_id then now() else renter_read_at end,
    owner_read_at = case when me = owner_id then now() else owner_read_at end
  where id = talk.id;
end;
$$;

-- Viewings ---------------------------------------------------------------------

-- Suggest a time. Replaces a viewing that is still waiting or confirmed.
create or replace function public.propose_viewing(p_enquiry uuid, p_starts_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  talk public.enquiries := public.my_enquiry(p_enquiry);
  local_time time := (p_starts_at at time zone 'Africa/Johannesburg')::time;
  made uuid;
begin
  if (select l.status from public.listings l where l.id = talk.listing_id) <> 'live' then
    raise exception 'This place is no longer listed' using errcode = 'P0001', hint = 'listing_not_live';
  end if;
  if p_starts_at is null or p_starts_at < now() + interval '1 hour' or p_starts_at > now() + interval '60 days' then
    raise exception 'Choose a time from an hour from now up to 60 days ahead' using errcode = 'P0001', hint = 'viewing_time';
  end if;
  if local_time < time '07:00' or local_time > time '19:00' then
    raise exception 'Viewings are between 07:00 and 19:00' using errcode = 'P0001', hint = 'viewing_hours';
  end if;
  update public.viewings set status = 'cancelled', decided_at = now()
    where enquiry_id = talk.id and status in ('proposed', 'confirmed');
  insert into public.viewings (enquiry_id, starts_at, proposed_by) values (talk.id, p_starts_at, me) returning id into made;
  perform public.add_note(talk.id, 'Viewing suggested for ' || public.viewing_words(p_starts_at) || '.');
  return made;
end;
$$;

-- The other person confirms or declines a suggested time.
create or replace function public.respond_viewing(p_viewing uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  visit public.viewings;
  talk public.enquiries;
begin
  select * into visit from public.viewings v where v.id = p_viewing for update;
  if visit.id is null then
    raise exception 'Viewing not found' using errcode = 'P0001', hint = 'viewing_not_found';
  end if;
  talk := public.my_enquiry(visit.enquiry_id);
  if visit.status <> 'proposed' then
    raise exception 'This viewing is no longer waiting for an answer' using errcode = 'P0001', hint = 'viewing_not_waiting';
  end if;
  if visit.proposed_by = me then
    raise exception 'The other person needs to answer this time' using errcode = 'P0001', hint = 'own_proposal';
  end if;
  if p_accept and visit.starts_at < now() then
    raise exception 'That time has passed. Suggest a new one.' using errcode = 'P0001', hint = 'viewing_time';
  end if;
  update public.viewings set status = case when p_accept then 'confirmed' else 'declined' end, decided_at = now()
    where id = visit.id;
  perform public.add_note(talk.id, case when p_accept
    then 'Viewing confirmed for ' || public.viewing_words(visit.starts_at) || '.'
    else 'The suggested time (' || public.viewing_words(visit.starts_at) || ') did not work. Suggest another one.' end);
  return case when p_accept then 'confirmed' else 'declined' end;
end;
$$;

create or replace function public.cancel_viewing(p_viewing uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  visit public.viewings;
  talk public.enquiries;
begin
  select * into visit from public.viewings v where v.id = p_viewing for update;
  if visit.id is null then
    raise exception 'Viewing not found' using errcode = 'P0001', hint = 'viewing_not_found';
  end if;
  talk := public.my_enquiry(visit.enquiry_id);
  if visit.status not in ('proposed', 'confirmed') then
    raise exception 'This viewing is already over or cancelled' using errcode = 'P0001', hint = 'viewing_not_waiting';
  end if;
  update public.viewings set status = 'cancelled', decided_at = now() where id = visit.id;
  perform public.add_note(talk.id, 'The viewing for ' || public.viewing_words(visit.starts_at) || ' was cancelled.');
end;
$$;

create or replace function public.report_enquiry(p_enquiry uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  talk public.enquiries := public.my_enquiry(p_enquiry);
  reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(reason) < 5 or char_length(reason) > 500 then
    raise exception 'Say in a few words what went wrong' using errcode = 'P0001', hint = 'report_reason';
  end if;
  insert into public.enquiry_reports (enquiry_id, reporter_id, reason) values (talk.id, auth.uid(), reason);
end;
$$;

-- Reading ------------------------------------------------------------------------

-- The caller's conversations, newest first, with what the list needs.
-- One conversation with `p_enquiry`; then the address and WhatsApp number are
-- included when the rules above allow.
create or replace function public.enquiry_list(p_enquiry uuid default null)
returns table (
  id uuid,
  listing_id uuid,
  my_side text,
  listing_mode text,
  listing_kind text,
  listing_bedrooms smallint,
  listing_area text,
  listing_city text,
  listing_price integer,
  listing_status text,
  street text,
  other_name text,
  other_whatsapp text,
  last_body text,
  last_kind text,
  last_from_me boolean,
  last_message_at timestamptz,
  unread integer,
  viewing_id uuid,
  viewing_at timestamptz,
  viewing_status text,
  viewing_mine boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select e.*, case when e.renter_id = auth.uid() then 'renter' else 'owner' end as side,
           case when e.renter_id = auth.uid() then e.owner_id else e.renter_id end as other_id,
           case when e.renter_id = auth.uid() then e.renter_read_at else e.owner_read_at end as read_at
    from public.enquiries e
    where auth.uid() in (e.renter_id, e.owner_id)
      and (p_enquiry is null or e.id = p_enquiry)
  )
  select
    m.id, m.listing_id, m.side,
    l.mode, l.kind, l.bedrooms, l.area, l.city, l.price_rands, l.status,
    -- The full street: always for the owner; for the renter only with a confirmed viewing.
    case when m.side = 'owner' or v.status = 'confirmed' and v.starts_at > now() - interval '2 days'
         then l.street else l.street_public end,
    coalesce(nullif(split_part(btrim(p.full_name), ' ', 1), ''), case when m.side = 'renter' then (case when l.lister = 'agent' then 'The agent' else 'The owner' end) else 'The renter' end),
    case when p_enquiry is not null and p.share_whatsapp and p.phone is not null
              and v.status = 'confirmed' and v.starts_at > now() - interval '2 days'
         then p.phone end,
    left(lm.body, 140), lm.kind, lm.sender_id = auth.uid(), m.last_message_at,
    (select count(*)::int from public.messages x
      where x.enquiry_id = m.id and x.created_at > m.read_at and x.sender_id is distinct from auth.uid()),
    v.id, v.starts_at, v.status, v.proposed_by = auth.uid()
  from mine m
  join public.listings l on l.id = m.listing_id
  left join public.profiles p on p.id = m.other_id
  left join lateral (
    select x.body, x.kind, x.sender_id from public.messages x where x.enquiry_id = m.id order by x.created_at desc limit 1
  ) lm on true
  left join lateral (
    select y.id, y.starts_at, y.status, y.proposed_by from public.viewings y
    where y.enquiry_id = m.id order by (y.status in ('proposed', 'confirmed')) desc, y.created_at desc limit 1
  ) v on true
  order by m.last_message_at desc;
$$;

-- Unread messages across all conversations, for the tab bar.
create or replace function public.unread_total()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.enquiries e
  join public.messages x on x.enquiry_id = e.id
  where auth.uid() in (e.renter_id, e.owner_id)
    and x.sender_id is distinct from auth.uid()
    and x.created_at > case when e.renter_id = auth.uid() then e.renter_read_at else e.owner_read_at end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.start_enquiry(uuid, text)', 'public.send_message(uuid, text)', 'public.mark_read(uuid)',
    'public.propose_viewing(uuid, timestamptz)', 'public.respond_viewing(uuid, boolean)', 'public.cancel_viewing(uuid)',
    'public.report_enquiry(uuid, text)', 'public.enquiry_list(uuid)', 'public.unread_total()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
