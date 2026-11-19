-- Sprint 6: Street Verified. Three checks earn a listing the badge:
--   1. the person's ID and a selfie (once per person),
--   2. proof they may let or sell this place (per listing): a title deed or
--      rates account in their name; agents add their Fidelity Fund
--      Certificate and the owner's mandate,
--   3. a check-in at the property: the video tour, filmed at the address in
--      the app, already proves this.
-- Checks 1 and 2 are made by Street Property admins by hand for now (an ID
-- provider and Lexis WinDeed can take over later without changing the app).
--
-- Privacy: the photos and documents are kept in a private bucket that only
-- admins can read, and are deleted as soon as the check is decided. Only the
-- result is kept. Renters see the badge, never the documents.
--
-- Run this once in the Supabase dashboard (SQL Editor) after 006_saved.sql.
-- Safe to run again.

-- The badge on the listing ---------------------------------------------------

alter table public.listings add column if not exists verified_at timestamptz;
grant select (verified_at) on public.listings to anon, authenticated;

-- The checks -------------------------------------------------------------------

create table if not exists public.identity_checks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  id_path text,
  selfie_path text,
  note text check (note is null or char_length(note) <= 500),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null
);

create table if not exists public.ownership_checks (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  doc_paths text[] not null default '{}',
  note text check (note is null or char_length(note) <= 500),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null
);

alter table public.identity_checks enable row level security;
alter table public.ownership_checks enable row level security;

drop policy if exists "People see their own ID check" on public.identity_checks;
create policy "People see their own ID check"
  on public.identity_checks for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));

drop policy if exists "Owners see their listing's ownership check" on public.ownership_checks;
create policy "Owners see their listing's ownership check"
  on public.ownership_checks for select to authenticated
  using (
    exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = (select auth.uid()))
    or (select public.is_admin())
  );

revoke all on public.identity_checks, public.ownership_checks from anon, authenticated;
grant select (user_id, status, note, submitted_at, decided_at) on public.identity_checks to authenticated;
grant select (listing_id, status, note, submitted_at, decided_at) on public.ownership_checks to authenticated;

-- Private storage for the documents. Owners can add to their own folder;
-- only admins can open files; the files are deleted after the decision.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verification-docs', 'verification-docs', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "People upload their own verification documents" on storage.objects;
create policy "People upload their own verification documents"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'verification-docs' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Only admins open verification documents" on storage.objects;
create policy "Only admins open verification documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'verification-docs' and (select public.is_admin()));

drop policy if exists "Admins and the person delete verification documents" on storage.objects;
create policy "Admins and the person delete verification documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'verification-docs'
    and ((select public.is_admin()) or (storage.foldername(name))[1] = (select auth.uid())::text)
  );

-- Working out the badge --------------------------------------------------------

create or replace function public.refresh_verified(p_listing uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.listings l set verified_at = case
    when exists (select 1 from public.identity_checks i where i.user_id = l.owner_id and i.status = 'approved')
     and exists (select 1 from public.ownership_checks o where o.listing_id = l.id and o.status = 'approved')
     and exists (select 1 from public.tour_clips c where c.listing_id = l.id and c.room = 'outside')
    then coalesce(l.verified_at, now())
  end
  where l.id = p_listing;
$$;
revoke all on function public.refresh_verified(uuid) from public, anon, authenticated;

-- A new or removed outside clip can earn or lose the badge.
create or replace function public.tour_clips_refresh_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_verified(coalesce(new.listing_id, old.listing_id));
  return null;
end;
$$;
drop trigger if exists tour_clips_refresh_verified on public.tour_clips;
create trigger tour_clips_refresh_verified
  after insert or delete on public.tour_clips
  for each row execute function public.tour_clips_refresh_verified();

-- A new address needs new proof of ownership.
create or replace function public.listings_address_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.street, new.area, new.city) is distinct from (old.street, old.area, old.city) then
    new.verified_at := null;
    delete from public.ownership_checks o where o.listing_id = new.id and o.status = 'approved';
  end if;
  return new;
end;
$$;
drop trigger if exists listings_address_changed on public.listings;
create trigger listings_address_changed
  before update of street, area, city on public.listings
  for each row execute function public.listings_address_changed();

-- Sending the checks -------------------------------------------------------------

-- Check 1: the ID photo and selfie, already uploaded to <user id>/identity/.
create or replace function public.submit_identity(p_id_path text, p_selfie_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  folder text := me::text || '/identity/';
begin
  if me is null then
    raise exception 'Log in first' using errcode = 'P0001', hint = 'not_signed_in';
  end if;
  if p_id_path is null or p_selfie_path is null or p_id_path not like folder || '%' or p_selfie_path not like folder || '%' or p_id_path = p_selfie_path then
    raise exception 'Add a photo of your ID and a selfie' using errcode = 'P0001', hint = 'need_id_photos';
  end if;
  if exists (select 1 from public.identity_checks i where i.user_id = me and i.status in ('pending', 'approved')) then
    raise exception 'Your ID is already being checked or approved' using errcode = 'P0001', hint = 'check_exists';
  end if;
  insert into public.identity_checks (user_id, status, id_path, selfie_path, note, submitted_at, decided_at, decided_by)
  values (me, 'pending', p_id_path, p_selfie_path, null, now(), null, null)
  on conflict (user_id) do update set
    status = 'pending', id_path = excluded.id_path, selfie_path = excluded.selfie_path,
    note = null, submitted_at = now(), decided_at = null, decided_by = null;
end;
$$;

-- Check 2: proof for one listing, already uploaded to <user id>/<listing id>/ownership/.
-- Owners send at least one document; agents at least two (FFC and mandate).
create or replace function public.submit_ownership(p_listing uuid, p_paths text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  place public.listings;
  folder text;
  needed int;
  path text;
begin
  select * into place from public.listings l where l.id = p_listing;
  if place.id is null or place.owner_id is distinct from me then
    raise exception 'Listing not found' using errcode = 'P0001', hint = 'listing_not_found';
  end if;
  folder := me::text || '/' || p_listing::text || '/ownership/';
  needed := case when place.lister = 'agent' then 2 else 1 end;
  if coalesce(cardinality(p_paths), 0) < needed or cardinality(p_paths) > 6 then
    raise exception 'Add the documents asked for' using errcode = 'P0001', hint = case when needed = 2 then 'need_agent_docs' else 'need_owner_docs' end;
  end if;
  foreach path in array p_paths loop
    if path not like folder || '%' then
      raise exception 'Document saved in the wrong place' using errcode = 'P0001', hint = 'bad_doc_path';
    end if;
  end loop;
  if exists (select 1 from public.ownership_checks o where o.listing_id = p_listing and o.status in ('pending', 'approved')) then
    raise exception 'This listing is already being checked or approved' using errcode = 'P0001', hint = 'check_exists';
  end if;
  insert into public.ownership_checks (listing_id, status, doc_paths, note, submitted_at, decided_at, decided_by)
  values (p_listing, 'pending', p_paths, null, now(), null, null)
  on conflict (listing_id) do update set
    status = 'pending', doc_paths = excluded.doc_paths, note = null,
    submitted_at = now(), decided_at = null, decided_by = null;
end;
$$;

-- Where a listing stands, for its owner's screen.
create or replace function public.my_verification(p_listing uuid)
returns table (
  identity_status text,
  identity_note text,
  ownership_status text,
  ownership_note text,
  on_site boolean,
  lister text,
  verified_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.status, i.note, o.status, o.note,
    exists (select 1 from public.tour_clips c where c.listing_id = l.id and c.room = 'outside'),
    l.lister, l.verified_at
  from public.listings l
  left join public.identity_checks i on i.user_id = l.owner_id
  left join public.ownership_checks o on o.listing_id = l.id
  where l.id = p_listing and l.owner_id = auth.uid();
$$;

-- For admins ---------------------------------------------------------------------

-- Checks waiting for a decision, oldest first.
create or replace function public.verification_queue()
returns table (
  kind text,
  subject_id uuid,
  person_name text,
  listing_id uuid,
  street text,
  area text,
  city text,
  lister text,
  paths text[],
  submitted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins review checks' using errcode = 'P0001', hint = 'not_admin';
  end if;
  return query
    select 'identity'::text, i.user_id, coalesce(nullif(btrim(p.full_name), ''), 'No name given'),
           null::uuid, null::text, null::text, null::text, null::text,
           array[i.id_path, i.selfie_path], i.submitted_at
    from public.identity_checks i
    left join public.profiles p on p.id = i.user_id
    where i.status = 'pending'
    union all
    select 'ownership'::text, o.listing_id, coalesce(nullif(btrim(p.full_name), ''), 'No name given'),
           l.id, l.street, l.area, l.city, l.lister, o.doc_paths, o.submitted_at
    from public.ownership_checks o
    join public.listings l on l.id = o.listing_id
    left join public.profiles p on p.id = l.owner_id
    where o.status = 'pending'
    order by 10;
end;
$$;

-- Decide a check. Returns the document paths, which the app then deletes; the
-- paths are cleared here so nothing points at them any more.
create or replace function public.decide_check(p_kind text, p_subject uuid, p_approve boolean, p_note text default null)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  note text := nullif(btrim(coalesce(p_note, '')), '');
  files text[];
  place uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins review checks' using errcode = 'P0001', hint = 'not_admin';
  end if;
  if not p_approve and (note is null or char_length(note) < 5) then
    raise exception 'Say what the person needs to send instead' using errcode = 'P0001', hint = 'note_needed';
  end if;
  if char_length(coalesce(note, '')) > 500 then
    raise exception 'Keep the note under 500 characters' using errcode = 'P0001', hint = 'note_too_long';
  end if;

  if p_kind = 'identity' then
    select array[i.id_path, i.selfie_path] into files
      from public.identity_checks i where i.user_id = p_subject and i.status = 'pending' for update;
    if files is null then
      raise exception 'This check is no longer waiting' using errcode = 'P0001', hint = 'check_not_waiting';
    end if;
    update public.identity_checks set
      status = case when p_approve then 'approved' else 'rejected' end,
      note = case when p_approve then null else note end,
      decided_at = now(), decided_by = auth.uid(), id_path = null, selfie_path = null
    where user_id = p_subject;
    -- An approved ID can complete the badge on every listing of this person.
    for place in select l.id from public.listings l where l.owner_id = p_subject loop
      perform public.refresh_verified(place);
    end loop;
  elsif p_kind = 'ownership' then
    select o.doc_paths into files
      from public.ownership_checks o where o.listing_id = p_subject and o.status = 'pending' for update;
    if files is null then
      raise exception 'This check is no longer waiting' using errcode = 'P0001', hint = 'check_not_waiting';
    end if;
    update public.ownership_checks set
      status = case when p_approve then 'approved' else 'rejected' end,
      note = case when p_approve then null else note end,
      decided_at = now(), decided_by = auth.uid(), doc_paths = '{}'
    where listing_id = p_subject;
    perform public.refresh_verified(p_subject);
  else
    raise exception 'Unknown check' using errcode = 'P0001', hint = 'check_not_found';
  end if;
  return files;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.submit_identity(text, text)', 'public.submit_ownership(uuid, text[])', 'public.my_verification(uuid)',
    'public.verification_queue()', 'public.decide_check(text, uuid, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- Search: the badge in each result, and a "Street Verified only" filter --------

drop function if exists public.search_listings(text, text, integer, integer, integer, text[], text[], boolean, integer, integer, double precision, double precision, double precision, double precision);
drop function if exists public.search_listings(text, text, integer, integer, integer, text[], text[], boolean, integer, integer, double precision, double precision, double precision, double precision, boolean);

create or replace function public.search_listings(
  p_mode text,
  p_text text default null,
  p_min_price integer default null,
  p_max_price integer default null,
  p_min_beds integer default null,
  p_kinds text[] default null,
  p_features text[] default null,
  p_parking boolean default false,
  p_limit integer default 20,
  p_offset integer default 0,
  p_south double precision default null,
  p_west double precision default null,
  p_north double precision default null,
  p_east double precision default null,
  p_verified boolean default false
)
returns table (
  id uuid,
  mode text,
  kind text,
  lister text,
  street_public text,
  area text,
  city text,
  price_rands integer,
  deposit_rands integer,
  bedrooms smallint,
  bathrooms smallint,
  parking smallint,
  features text[],
  available_from date,
  reviewed_at timestamptz,
  approx_lat double precision,
  approx_lng double precision,
  verified_at timestamptz,
  cover_path text,
  tour_path text,
  tour_seconds numeric,
  clip_count integer,
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with words as (
    select array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%') as patterns
    from unnest(regexp_split_to_array(lower(btrim(coalesce(p_text, ''))), '\s+')) as w
    where w <> ''
  ),
  matches as (
    select l.id, l.mode, l.kind, l.lister, l.street_public, l.area, l.city, l.price_rands, l.deposit_rands,
           l.bedrooms, l.bathrooms, l.parking, l.features, l.available_from, l.reviewed_at, l.approx_lat, l.approx_lng, l.verified_at
    from public.listings l, words
    where l.status = 'live'
      and l.mode = p_mode
      and (p_min_price is null or l.price_rands >= p_min_price)
      and (p_max_price is null or l.price_rands <= p_max_price)
      and (p_min_beds is null or l.bedrooms >= p_min_beds)
      and (p_kinds is null or cardinality(p_kinds) = 0 or l.kind = any (p_kinds))
      and (p_features is null or l.features @> p_features)
      and (not coalesce(p_parking, false) or l.parking >= 1)
      and (not coalesce(p_verified, false) or l.verified_at is not null)
      and (
        p_south is null or p_west is null or p_north is null or p_east is null
        or (l.approx_lat between p_south and p_north and l.approx_lng between p_west and p_east)
      )
      and (
        words.patterns is null
        or (select bool_and(lower(coalesce(l.street_public, '') || ' ' || l.area || ' ' || l.city) like p escape '\')
            from unnest(words.patterns) as p)
      )
  )
  select
    m.id, m.mode, m.kind, m.lister, m.street_public, m.area, m.city, m.price_rands, m.deposit_rands,
    m.bedrooms, m.bathrooms, m.parking, m.features, m.available_from, m.reviewed_at, m.approx_lat, m.approx_lng, m.verified_at,
    (select p.path from public.listing_photos p where p.listing_id = m.id order by p.position, p.created_at limit 1),
    (select c.path from public.tour_clips c where c.listing_id = m.id order by (c.room = 'outside') desc, c.recorded_at limit 1),
    (select coalesce(sum(c.seconds), 0) from public.tour_clips c where c.listing_id = m.id),
    (select count(*)::int from public.tour_clips c where c.listing_id = m.id),
    count(*) over ()
  from matches m
  order by m.reviewed_at desc nulls last, m.id
  limit least(greatest(coalesce(p_limit, 20), 0), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.search_listings(text, text, integer, integer, integer, text[], text[], boolean, integer, integer, double precision, double precision, double precision, double precision, boolean) from public;
grant execute on function public.search_listings(text, text, integer, integer, integer, text[], text[], boolean, integer, integer, double precision, double precision, double precision, double precision, boolean) to anon, authenticated;
