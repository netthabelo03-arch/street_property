-- Sprint 8: the Street Safe deal, from "yes" to the keys.
--   * "We met": after a confirmed viewing, both people tap it at the address.
--   * A deal starts when the owner says yes to a renter's check.
--   * The lease: the owner fills in the terms, the database writes the lease
--     from its template (so the standard clauses cannot be changed), and both
--     sign the same text. A fingerprint (SHA-256) of the text is kept with
--     each signature.
--   * The move-in check: every room photographed in the app, with notes;
--     both sign when every room is done.
--   * Keys: the renter confirms; the listing then comes off as let.
-- The deposit held by Street Safe is Sprint 9.
--
-- THE LEASE TEMPLATE BELOW IS A DRAFT. It must be reviewed by a lawyer before
-- Street Property opens to the public.
--
-- Run this once in the Supabase dashboard (SQL Editor) after 009_reports_email.sql.
-- Safe to run again.

-- "We met" --------------------------------------------------------------------

alter table public.viewings add column if not exists met_renter_at timestamptz;
alter table public.viewings add column if not exists met_owner_at timestamptz;

-- Metres between two points.
create or replace function public.metres_between(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$;

-- Tap "We met" at the address, from 30 minutes before the viewing to 7 days after.
create or replace function public.mark_met(p_viewing uuid, p_lat double precision, p_lng double precision, p_accuracy double precision default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  visit public.viewings;
  talk public.enquiries;
  place public.listings;
  slack double precision := least(coalesce(p_accuracy, 0), 150);
begin
  select * into visit from public.viewings v where v.id = p_viewing for update;
  if visit.id is null then
    raise exception 'Viewing not found' using errcode = 'P0001', hint = 'viewing_not_found';
  end if;
  talk := public.my_enquiry(visit.enquiry_id);
  if visit.status <> 'confirmed' then
    raise exception 'Only a confirmed viewing can be marked' using errcode = 'P0001', hint = 'viewing_not_confirmed';
  end if;
  if now() < visit.starts_at - interval '30 minutes' or now() > visit.starts_at + interval '7 days' then
    raise exception 'Tap this at the viewing' using errcode = 'P0001', hint = 'not_viewing_time';
  end if;
  select * into place from public.listings l where l.id = talk.listing_id;
  if p_lat is null or p_lng is null or place.filmed_lat is null
     or public.metres_between(p_lat, p_lng, place.filmed_lat, place.filmed_lng) > 300 + slack then
    raise exception 'You need to be at the address' using errcode = 'P0001', hint = 'not_at_address';
  end if;
  if me = talk.renter_id then
    update public.viewings set met_renter_at = coalesce(met_renter_at, now()) where id = visit.id;
  else
    update public.viewings set met_owner_at = coalesce(met_owner_at, now()) where id = visit.id;
  end if;
  select * into visit from public.viewings v where v.id = p_viewing;
  if visit.met_renter_at is not null and visit.met_owner_at is not null then
    perform public.add_note(talk.id, 'You both confirmed you met at the viewing.');
    return 'both';
  end if;
  return 'waiting';
end;
$$;

-- The deal ----------------------------------------------------------------------

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null unique references public.enquiries (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  renter_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'agreeing' check (status in ('agreeing', 'signing', 'signed', 'moved_in', 'cancelled')),
  rooms text[] not null,
  rent_rands integer,
  deposit_rands integer,
  start_date date,
  lease_months smallint,
  special_terms text check (special_terms is null or char_length(special_terms) <= 1000),
  lease_text text,
  lease_hash text,
  sent_at timestamptz,
  owner_signed_at timestamptz,
  owner_signed_name text,
  renter_signed_at timestamptz,
  renter_signed_name text,
  owner_checked_at timestamptz,
  renter_checked_at timestamptz,
  keys_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists deals_owner_idx on public.deals (owner_id, created_at desc);
create index if not exists deals_renter_idx on public.deals (renter_id, created_at desc);

create table if not exists public.inspection_rooms (
  deal_id uuid not null references public.deals (id) on delete cascade,
  room text not null,
  note text check (note is null or char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  primary key (deal_id, room)
);

create table if not exists public.inspection_photos (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  room text not null,
  path text not null unique,
  taken_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inspection_photos_deal_idx on public.inspection_photos (deal_id, room, created_at);

alter table public.deals enable row level security;
alter table public.inspection_rooms enable row level security;
alter table public.inspection_photos enable row level security;

drop policy if exists "The two people read their deal" on public.deals;
create policy "The two people read their deal" on public.deals for select to authenticated
  using ((select auth.uid()) in (owner_id, renter_id) or (select public.is_admin()));
drop policy if exists "The two people read the move-in notes" on public.inspection_rooms;
create policy "The two people read the move-in notes" on public.inspection_rooms for select to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id and ((select auth.uid()) in (d.owner_id, d.renter_id) or (select public.is_admin()))));
drop policy if exists "The two people see the move-in photos" on public.inspection_photos;
create policy "The two people see the move-in photos" on public.inspection_photos for select to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id and ((select auth.uid()) in (d.owner_id, d.renter_id) or (select public.is_admin()))));

revoke all on public.deals, public.inspection_rooms, public.inspection_photos from anon, authenticated;
grant select on public.deals, public.inspection_rooms, public.inspection_photos to authenticated;

-- The rooms to check: the same list the app uses for the video tour.
create or replace function public.deal_rooms(p_kind text, p_bedrooms int, p_bathrooms int)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  single boolean := p_kind in ('backyard_room', 'shared_room');
  beds int := greatest(least(coalesce(p_bedrooms, 0), 9), 1);
  baths int := greatest(least(coalesce(p_bathrooms, 0), 9), 1);
  rooms text[] := array['outside'];
begin
  if single then
    rooms := array_append(rooms, 'bedroom_1');
  else
    rooms := array_cat(rooms, array['lounge', 'kitchen']);
    for n in 1..beds loop rooms := array_append(rooms, 'bedroom_' || n); end loop;
  end if;
  for n in 1..baths loop rooms := array_append(rooms, 'bathroom_' || n); end loop;
  if single then rooms := array_append(rooms, 'kitchen'); end if;
  return array_append(rooms, 'meters');
end;
$$;

-- A yes from the owner starts the deal, with what the renter asked for.
create or replace function public.start_deal_on_yes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  place public.listings;
begin
  if new.owner_decision = 'accepted' and old.owner_decision is distinct from 'accepted' then
    select * into place from public.listings l where l.id = new.listing_id;
    insert into public.deals (enquiry_id, listing_id, owner_id, renter_id, rooms, rent_rands, deposit_rands, start_date, lease_months)
    values (new.id, new.listing_id, new.owner_id, new.renter_id,
            public.deal_rooms(place.kind, place.bedrooms, place.bathrooms),
            place.price_rands, place.deposit_rands,
            coalesce(new.move_in, current_date + 7), coalesce(new.lease_months, 12))
    on conflict (enquiry_id) do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists start_deal_on_yes on public.enquiries;
create trigger start_deal_on_yes after update of owner_decision on public.enquiries
  for each row execute function public.start_deal_on_yes();

-- The deal, locked, if the caller is in it.
create or replace function public.my_deal(p_deal uuid)
returns public.deals
language plpgsql
security definer
set search_path = ''
as $$
declare
  found public.deals;
begin
  select * into found from public.deals d where d.id = p_deal for update;
  if found.id is null or auth.uid() is null or auth.uid() not in (found.owner_id, found.renter_id) then
    raise exception 'Deal not found' using errcode = 'P0001', hint = 'deal_not_found';
  end if;
  if found.status = 'cancelled' then
    raise exception 'This deal was cancelled' using errcode = 'P0001', hint = 'deal_cancelled';
  end if;
  return found;
end;
$$;
revoke all on function public.my_deal(uuid) from public, anon, authenticated;

-- The lease -----------------------------------------------------------------------

create or replace function public.rands(p integer)
returns text
language sql
immutable
set search_path = ''
as $$ select 'R' || regexp_replace(p::text, '(\d)(?=(\d{3})+$)', '\1 ', 'g'); $$;

create or replace function public.long_date(p date)
returns text
language sql
immutable
set search_path = ''
as $$ select to_char(p, 'FMDD FMMonth YYYY'); $$;

-- The lease, written from the template and the deal's terms. DRAFT TEMPLATE.
create or replace function public.lease_text_for(p_deal uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.deals;
  place public.listings;
  owner_name text;
  renter_name text;
  end_date date;
begin
  select * into d from public.deals x where x.id = p_deal;
  select * into place from public.listings l where l.id = d.listing_id;
  select coalesce(nullif(btrim(p.full_name), ''), 'The Landlord') into owner_name from public.profiles p where p.id = d.owner_id;
  select coalesce(nullif(btrim(p.full_name), ''), 'The Tenant') into renter_name from public.profiles p where p.id = d.renter_id;
  end_date := (d.start_date + make_interval(months => d.lease_months)) - 1;
  return concat_ws(chr(10),
    'RESIDENTIAL LEASE AGREEMENT',
    '(Street Property draft template, to be reviewed by a lawyer before use.)',
    '',
    '1. The parties',
    'Landlord: ' || owner_name || (case when place.lister = 'agent' then ', acting as agent for the owner under a written mandate' else '' end) || '.',
    'Tenant: ' || renter_name || '.',
    '',
    '2. The property',
    place.street || ', ' || place.area || ', ' || place.city || '.',
    '',
    '3. The lease period',
    'From ' || public.long_date(d.start_date) || ' to ' || public.long_date(end_date) || ' (' || d.lease_months || ' months).',
    '',
    '4. Rent',
    'The rent is ' || public.rands(d.rent_rands) || ' a month, paid in advance on or before the 1st day of each month. The landlord gives the tenant a written receipt for every payment.',
    '',
    '5. Deposit',
    (case when coalesce(d.deposit_rands, 0) > 0
      then 'The deposit is ' || public.rands(d.deposit_rands) || '. It is kept in an interest-bearing account, and the interest belongs to the tenant. At the end of the lease, the landlord may use the deposit only for unpaid rent and for damage found at the joint move-out inspection, beyond fair wear and tear, and refunds the rest with interest within 14 days of the tenant moving out (21 days if repairs are needed).'
      else 'No deposit is payable.' end),
    '',
    '6. Inspections',
    'Landlord and tenant inspect the property together before the tenant moves in, and again in the 3 days before the tenant moves out. Both inspections are recorded room by room with photos in the Street Property app and signed by both.',
    '',
    '7. Looking after the property',
    'The tenant keeps the property clean and in the condition it was in at the start, apart from fair wear and tear, and reports damage quickly. The landlord keeps the property fit to live in and repairs what is not caused by the tenant.',
    '',
    '8. Electricity and water',
    (case when 'prepaid' = any (place.features) then 'Electricity is prepaid and bought by the tenant. ' else '' end) || 'Water and other services are paid as the parties agree in writing.',
    '',
    '9. Pets',
    (case when 'pets' = any (place.features) then 'Pets are allowed, with the landlord''s agreement on how many and which.' else 'No pets without the landlord''s written agreement.' end),
    '',
    '10. Ending the lease',
    'The tenant may end the lease early by giving 20 business days'' written notice, as the Consumer Protection Act allows; the landlord may charge a reasonable cancellation penalty. A party in breach must be given 20 business days'' written notice to put it right before the lease can be cancelled.',
    '',
    '11. Special terms',
    coalesce(nullif(btrim(d.special_terms), ''), 'None.'),
    '',
    '12. Signing',
    'The parties sign this lease electronically in the Street Property app. Each signature records the full name typed, the date and time, and a fingerprint of this exact text, so both parties have signed the same lease.'
  );
end;
$$;
revoke all on function public.lease_text_for(uuid) from public, anon, authenticated;

-- The owner sets the terms and sends the lease to sign.
create or replace function public.send_lease(p_deal uuid, p_rent integer, p_deposit integer, p_start date, p_months integer, p_special text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deals := public.my_deal(p_deal);
  body text;
begin
  if d.owner_id <> auth.uid() then
    raise exception 'Only the owner sends the lease' using errcode = 'P0001', hint = 'not_the_owner';
  end if;
  if d.status <> 'agreeing' then
    raise exception 'The lease was already sent' using errcode = 'P0001', hint = 'lease_sent';
  end if;
  if p_rent is null or p_rent < 300 or p_rent > 500000 then
    raise exception 'Enter the monthly rent' using errcode = 'P0001', hint = 'lease_rent';
  end if;
  if p_deposit is not null and (p_deposit < 0 or p_deposit > 10000000) then
    raise exception 'Check the deposit' using errcode = 'P0001', hint = 'lease_deposit';
  end if;
  if p_start is null or p_start < current_date or p_start > current_date + 365 then
    raise exception 'Choose a start date in the next 12 months' using errcode = 'P0001', hint = 'lease_start';
  end if;
  if p_months is null or p_months not in (6, 12, 24, 36) then
    raise exception 'Choose 6, 12, 24 or 36 months' using errcode = 'P0001', hint = 'lease_months';
  end if;
  if char_length(coalesce(p_special, '')) > 1000 then
    raise exception 'Keep special terms under 1000 characters' using errcode = 'P0001', hint = 'lease_special';
  end if;
  update public.deals set rent_rands = p_rent, deposit_rands = p_deposit, start_date = p_start,
    lease_months = p_months, special_terms = nullif(btrim(coalesce(p_special, '')), '')
  where id = d.id;
  body := public.lease_text_for(d.id);
  update public.deals set lease_text = body, lease_hash = encode(sha256(convert_to(body, 'UTF8')), 'hex'),
    sent_at = now(), status = 'signing'
  where id = d.id;
  perform public.add_note(d.enquiry_id, 'The lease is ready to sign.');
end;
$$;

-- Sign the lease by typing your full name. The text cannot change once sent.
create or replace function public.sign_lease(p_deal uuid, p_name text, p_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  d public.deals := public.my_deal(p_deal);
  v_name text := btrim(coalesce(p_name, ''));
begin
  if d.status <> 'signing' then
    raise exception 'The lease is not waiting for signatures' using errcode = 'P0001', hint = 'lease_not_signing';
  end if;
  if p_hash is distinct from d.lease_hash then
    raise exception 'The lease changed. Read it again before signing.' using errcode = 'P0001', hint = 'lease_changed';
  end if;
  if char_length(v_name) < 3 or char_length(v_name) > 120 or v_name !~ '\s' then
    raise exception 'Type your full name (first name and surname)' using errcode = 'P0001', hint = 'signature_name';
  end if;
  if me = d.owner_id then
    if d.owner_signed_at is not null then return 'already'; end if;
    update public.deals set owner_signed_at = now(), owner_signed_name = v_name where id = d.id;
  else
    if d.renter_signed_at is not null then return 'already'; end if;
    update public.deals set renter_signed_at = now(), renter_signed_name = v_name where id = d.id;
  end if;
  select * into d from public.deals x where x.id = p_deal;
  if d.owner_signed_at is not null and d.renter_signed_at is not null then
    update public.deals set status = 'signed' where id = d.id;
    perform public.add_note(d.enquiry_id, 'The lease is signed by both. Next: the move-in check together.');
    return 'signed';
  end if;
  perform public.add_note(d.enquiry_id, public.first_name_of(me, 'Someone') || ' signed the lease.');
  return 'waiting';
end;
$$;

-- Either side can call the deal off before the keys are handed over.
create or replace function public.cancel_deal(p_deal uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  d public.deals := public.my_deal(p_deal);
begin
  if d.status = 'moved_in' then
    raise exception 'The renter has already moved in' using errcode = 'P0001', hint = 'deal_done';
  end if;
  update public.deals set status = 'cancelled', cancelled_at = now() where id = d.id;
  perform public.add_note(d.enquiry_id, public.first_name_of(me, 'Someone') || ' called the deal off.');
end;
$$;

-- The move-in check ---------------------------------------------------------------

-- Photos go to the private "deal-photos" bucket under <deal id>/<room>/.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deal-photos', 'deal-photos', false, 4194304, array['image/jpeg'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "The two people add move-in photos" on storage.objects;
create policy "The two people add move-in photos" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'deal-photos'
    and exists (select 1 from public.deals d
                where d.id::text = (storage.foldername(name))[1]
                  and (select auth.uid()) in (d.owner_id, d.renter_id)
                  and d.status = 'signed'
                  and (d.owner_checked_at is null or d.renter_checked_at is null))
  );
drop policy if exists "The two people see move-in photos" on storage.objects;
create policy "The two people see move-in photos" on storage.objects for select to authenticated
  using (
    bucket_id = 'deal-photos'
    and exists (select 1 from public.deals d
                where d.id::text = (storage.foldername(name))[1]
                  and ((select auth.uid()) in (d.owner_id, d.renter_id) or (select public.is_admin())))
  );

-- Changing a room after someone signed means both sign again.
create or replace function public.inspection_open(p_deal uuid)
returns public.deals
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deals := public.my_deal(p_deal);
begin
  if d.status <> 'signed' then
    raise exception 'The move-in check starts once the lease is signed by both' using errcode = 'P0001', hint = 'check_not_open';
  end if;
  if d.owner_checked_at is not null and d.renter_checked_at is not null then
    raise exception 'The move-in check is already signed by both' using errcode = 'P0001', hint = 'check_signed';
  end if;
  update public.deals set owner_checked_at = null, renter_checked_at = null where id = d.id;
  return d;
end;
$$;
revoke all on function public.inspection_open(uuid) from public, anon, authenticated;

create or replace function public.add_inspection_photo(p_deal uuid, p_room text, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deals := public.inspection_open(p_deal);
begin
  if not (p_room = any (d.rooms)) then
    raise exception 'Unknown room' using errcode = 'P0001', hint = 'bad_room';
  end if;
  if p_path is null or p_path not like d.id::text || '/' || p_room || '/%' then
    raise exception 'Photo saved in the wrong place' using errcode = 'P0001', hint = 'bad_doc_path';
  end if;
  if (select count(*) from public.inspection_photos p where p.deal_id = d.id and p.room = p_room) >= 12 then
    raise exception 'Up to 12 photos a room' using errcode = 'P0001', hint = 'too_many_room_photos';
  end if;
  insert into public.inspection_photos (deal_id, room, path, taken_by) values (d.id, p_room, p_path, auth.uid());
end;
$$;

create or replace function public.set_room_note(p_deal uuid, p_room text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deals := public.inspection_open(p_deal);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not (p_room = any (d.rooms)) then
    raise exception 'Unknown room' using errcode = 'P0001', hint = 'bad_room';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'Keep the note under 500 characters' using errcode = 'P0001', hint = 'note_too_long';
  end if;
  insert into public.inspection_rooms (deal_id, room, note, updated_at) values (d.id, p_room, v_note, now())
  on conflict (deal_id, room) do update set note = excluded.note, updated_at = now();
end;
$$;

-- Sign the move-in check: every room needs at least one photo.
create or replace function public.sign_inspection(p_deal uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  d public.deals := public.my_deal(p_deal);
  missing int;
begin
  if d.status <> 'signed' then
    raise exception 'The move-in check starts once the lease is signed by both' using errcode = 'P0001', hint = 'check_not_open';
  end if;
  select count(*) into missing from unnest(d.rooms) r
    where not exists (select 1 from public.inspection_photos p where p.deal_id = d.id and p.room = r);
  if missing > 0 then
    raise exception 'Add at least one photo of every room' using errcode = 'P0001', hint = 'rooms_missing';
  end if;
  if me = d.owner_id then
    update public.deals set owner_checked_at = coalesce(owner_checked_at, now()) where id = d.id;
  else
    update public.deals set renter_checked_at = coalesce(renter_checked_at, now()) where id = d.id;
  end if;
  select * into d from public.deals x where x.id = p_deal;
  if d.owner_checked_at is not null and d.renter_checked_at is not null then
    perform public.add_note(d.enquiry_id, 'The move-in check is signed by both. The renter can now confirm the keys.');
    return 'both';
  end if;
  return 'waiting';
end;
$$;

-- Keys --------------------------------------------------------------------------

create or replace function public.confirm_keys(p_deal uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deals := public.my_deal(p_deal);
begin
  if d.renter_id <> auth.uid() then
    raise exception 'Only the renter confirms the keys' using errcode = 'P0001', hint = 'not_the_renter';
  end if;
  if d.status <> 'signed' or d.owner_checked_at is null or d.renter_checked_at is null then
    raise exception 'Sign the move-in check together first' using errcode = 'P0001', hint = 'check_first';
  end if;
  update public.deals set status = 'moved_in', keys_at = now() where id = d.id;
  update public.listings set status = 'taken_down', review_note = 'Let through Street Property on ' || public.long_date(current_date) || '.'
    where id = d.listing_id and status in ('live', 'in_review');
  perform public.add_note(d.enquiry_id, 'Keys handed over. Welcome home!');
end;
$$;

-- Everything a deal screen needs, for either person.
create or replace function public.deal_view(p_deal uuid)
returns table (
  id uuid, enquiry_id uuid, listing_id uuid, my_side text, status text, rooms text[],
  rent_rands integer, deposit_rands integer, start_date date, lease_months smallint, special_terms text,
  lease_text text, lease_hash text, sent_at timestamptz,
  owner_signed_at timestamptz, owner_signed_name text, renter_signed_at timestamptz, renter_signed_name text,
  owner_checked_at timestamptz, renter_checked_at timestamptz, keys_at timestamptz,
  listing_kind text, listing_bedrooms smallint, listing_bathrooms smallint, street text, area text, city text,
  listing_verified boolean, met_both boolean, other_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.enquiry_id, d.listing_id, case when d.owner_id = auth.uid() then 'owner' else 'renter' end, d.status, d.rooms,
    d.rent_rands, d.deposit_rands, d.start_date, d.lease_months, d.special_terms,
    d.lease_text, d.lease_hash, d.sent_at,
    d.owner_signed_at, d.owner_signed_name, d.renter_signed_at, d.renter_signed_name,
    d.owner_checked_at, d.renter_checked_at, d.keys_at,
    l.kind, l.bedrooms, l.bathrooms, l.street, l.area, l.city,
    l.verified_at is not null,
    exists (select 1 from public.viewings v where v.enquiry_id = d.enquiry_id and v.met_renter_at is not null and v.met_owner_at is not null),
    public.first_name_of(case when d.owner_id = auth.uid() then d.renter_id else d.owner_id end, case when d.owner_id = auth.uid() then 'The renter' else 'The owner' end)
  from public.deals d
  join public.listings l on l.id = d.listing_id
  where d.id = p_deal and auth.uid() in (d.owner_id, d.renter_id);
$$;

-- The caller's deals, newest first.
create or replace function public.my_deals()
returns table (id uuid, enquiry_id uuid, my_side text, status text, area text, listing_kind text, listing_bedrooms smallint, rent_rands integer, other_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.enquiry_id, case when d.owner_id = auth.uid() then 'owner' else 'renter' end, d.status, l.area, l.kind, l.bedrooms, d.rent_rands,
    public.first_name_of(case when d.owner_id = auth.uid() then d.renter_id else d.owner_id end, case when d.owner_id = auth.uid() then 'The renter' else 'The owner' end),
    d.created_at
  from public.deals d join public.listings l on l.id = d.listing_id
  where auth.uid() in (d.owner_id, d.renter_id)
  order by d.created_at desc;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.mark_met(uuid, double precision, double precision, double precision)',
    'public.send_lease(uuid, integer, integer, date, integer, text)', 'public.sign_lease(uuid, text, text)',
    'public.cancel_deal(uuid)', 'public.add_inspection_photo(uuid, text, text)', 'public.set_room_note(uuid, text, text)',
    'public.sign_inspection(uuid)', 'public.confirm_keys(uuid)', 'public.deal_view(uuid)', 'public.my_deals()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
