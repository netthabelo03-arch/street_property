-- Sprint 1: listings, their photos, the video tour, and the review queue.
-- Run this once in the Supabase dashboard (SQL Editor) after 001_profiles.sql.
-- Safe to run again; it does not delete data.
--
-- A listing moves through these states:
--   draft          the owner is still filling it in
--   in_review      sent; an admin checks the photos and the video tour
--   changes_needed the admin asked for changes (review_note says what)
--   live           approved; anyone can see it
--   taken_down     the owner took it down
-- Only the functions below change the state, never the app directly.

-- Places to rent or buy -------------------------------------------------------

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lister text not null check (lister in ('owner', 'agent')),
  mode text not null check (mode in ('rent', 'sell')),
  kind text not null check (kind in ('flat', 'house', 'townhouse', 'backyard_room', 'cottage', 'shared_room')),
  street text not null check (char_length(street) between 3 and 120),
  area text not null check (char_length(area) between 2 and 80),
  city text not null check (char_length(city) between 2 and 80),
  -- Whole rands. Rent is per month.
  price_rands integer not null,
  deposit_rands integer check (deposit_rands is null or deposit_rands between 0 and 10000000),
  bedrooms smallint not null default 1 check (bedrooms between 0 and 20),
  bathrooms smallint not null default 1 check (bathrooms between 0 and 20),
  parking smallint not null default 0 check (parking between 0 and 20),
  features text[] not null default '{}'
    check (features <@ array['power_backup', 'water_backup', 'prepaid', 'pets', 'wifi', 'furnished', 'security']::text[]),
  description text not null default '' check (char_length(description) <= 1000),
  available_from date,
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'changes_needed', 'live', 'taken_down')),
  review_note text check (review_note is null or char_length(review_note) <= 500),
  -- Where the "outside" clip of the video tour was filmed.
  filmed_lat double precision,
  filmed_lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  constraint listings_price_fits_mode check (
    (mode = 'rent' and price_rands between 300 and 500000)
    or (mode = 'sell' and price_rands between 10000 and 1000000000)
  ),
  constraint listings_deposit_only_for_rent check (mode = 'rent' or deposit_rands is null)
);

create index if not exists listings_owner_idx on public.listings (owner_id, created_at desc);
create index if not exists listings_status_idx on public.listings (status, submitted_at);

-- Which states the owner may still edit.
create or replace function public.listing_editable(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_status in ('draft', 'changes_needed', 'taken_down'); $$;

-- New listings: the lister comes from the person's role, and the state always
-- starts as a draft, whatever the app sends.
create or replace function public.listings_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  person_role text;
begin
  if tg_op = 'INSERT' then
    select p.role into person_role from public.profiles p where p.id = new.owner_id;
    if person_role is null or person_role not in ('owner', 'agent') then
      raise exception 'Only owners and agents can list a place' using errcode = 'P0001', hint = 'not_a_lister';
    end if;
    new.lister := person_role;
    new.status := 'draft';
    new.review_note := null;
    new.filmed_lat := null;
    new.filmed_lng := null;
    new.submitted_at := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.created_at := now();
  end if;
  if new.mode = 'sell' then new.deposit_rands := null; end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.listings_before_write() from public, anon, authenticated;

drop trigger if exists listings_before_write on public.listings;
create trigger listings_before_write
  before insert or update on public.listings
  for each row execute function public.listings_before_write();

alter table public.listings enable row level security;

drop policy if exists "Anyone can see live listings" on public.listings;
create policy "Anyone can see live listings"
  on public.listings for select to anon, authenticated
  using (status = 'live');

drop policy if exists "Owners see their own listings" on public.listings;
create policy "Owners see their own listings"
  on public.listings for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Admins see every listing" on public.listings;
create policy "Admins see every listing"
  on public.listings for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "Owners and agents add listings" on public.listings;
create policy "Owners and agents add listings"
  on public.listings for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Owners edit listings that are not under review or live" on public.listings;
create policy "Owners edit listings that are not under review or live"
  on public.listings for update to authenticated
  using ((select auth.uid()) = owner_id and public.listing_editable(status))
  with check ((select auth.uid()) = owner_id and public.listing_editable(status));

drop policy if exists "Owners delete drafts" on public.listings;
create policy "Owners delete drafts"
  on public.listings for delete to authenticated
  using ((select auth.uid()) = owner_id and status = 'draft');

-- The app may write only the details; state, review and location are set by
-- the trigger above and the functions below.
revoke all on public.listings from anon, authenticated;
grant select on public.listings to anon, authenticated;
grant insert (mode, kind, street, area, city, price_rands, deposit_rands, bedrooms, bathrooms, parking, features, description, available_from)
  on public.listings to authenticated;
grant update (mode, kind, street, area, city, price_rands, deposit_rands, bedrooms, bathrooms, parking, features, description, available_from)
  on public.listings to authenticated;
grant delete on public.listings to authenticated;

-- Photos ----------------------------------------------------------------------
-- The files live in the "listing-photos" storage bucket under
-- <owner id>/<listing id>/photos/<file>. This table keeps their order.

create table if not exists public.listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  path text not null unique check (char_length(path) <= 300),
  position smallint not null default 0 check (position between 0 and 99),
  created_at timestamptz not null default now()
);
create index if not exists listing_photos_listing_idx on public.listing_photos (listing_id, position);

create or replace function public.listing_photos_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.listing_photos p where p.listing_id = new.listing_id) >= 12 then
    raise exception 'A listing can have up to 12 photos' using errcode = 'P0001', hint = 'too_many_photos';
  end if;
  return new;
end;
$$;

drop trigger if exists listing_photos_limit on public.listing_photos;
create trigger listing_photos_limit
  before insert on public.listing_photos
  for each row execute function public.listing_photos_limit();

alter table public.listing_photos enable row level security;

-- Whoever can see the listing can see its photos (the listing's own rules apply).
drop policy if exists "Photos follow their listing" on public.listing_photos;
create policy "Photos follow their listing"
  on public.listing_photos for select to anon, authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id));

drop policy if exists "Owners add photos while editing" on public.listing_photos;
create policy "Owners add photos while editing"
  on public.listing_photos for insert to authenticated
  with check (
    exists (select 1 from public.listings l
            where l.id = listing_id and l.owner_id = (select auth.uid()) and public.listing_editable(l.status))
    and path like (select auth.uid())::text || '/' || listing_id::text || '/photos/%'
  );

drop policy if exists "Owners reorder photos while editing" on public.listing_photos;
create policy "Owners reorder photos while editing"
  on public.listing_photos for update to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.owner_id = (select auth.uid()) and public.listing_editable(l.status)));

drop policy if exists "Owners remove photos while editing" on public.listing_photos;
create policy "Owners remove photos while editing"
  on public.listing_photos for delete to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.owner_id = (select auth.uid()) and public.listing_editable(l.status)));

revoke all on public.listing_photos from anon, authenticated;
grant select on public.listing_photos to anon, authenticated;
grant insert (listing_id, path, position) on public.listing_photos to authenticated;
grant update (position) on public.listing_photos to authenticated;
grant delete on public.listing_photos to authenticated;

-- The video tour ----------------------------------------------------------------
-- One short clip per room, filmed in the app at the address. Each clip shows
-- the day's code for that listing in its corner, and the app records where it
-- was filmed. Clips are added only through add_tour_clip(), which writes the
-- code and the time itself, so they cannot be made up.

create table if not exists public.tour_codes (
  listing_id uuid not null references public.listings (id) on delete cascade,
  day date not null,
  code text not null check (code ~ '^[A-Z2-9]{4}$'),
  primary key (listing_id, day)
);
alter table public.tour_codes enable row level security;
revoke all on public.tour_codes from anon, authenticated;

create table if not exists public.tour_clips (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  room text not null check (room ~ '^(outside|lounge|kitchen|dining|garden|meters|bedroom_[1-9]|bathroom_[1-9])$'),
  path text not null unique check (char_length(path) <= 300),
  seconds numeric(4, 1) not null check (seconds between 1 and 30),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m double precision check (accuracy_m is null or accuracy_m >= 0),
  code text not null,
  recorded_at timestamptz not null default now(),
  unique (listing_id, room)
);
create index if not exists tour_clips_listing_idx on public.tour_clips (listing_id);

alter table public.tour_clips enable row level security;

drop policy if exists "Clips follow their listing" on public.tour_clips;
create policy "Clips follow their listing"
  on public.tour_clips for select to anon, authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id));

drop policy if exists "Owners remove clips while editing" on public.tour_clips;
create policy "Owners remove clips while editing"
  on public.tour_clips for delete to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.owner_id = (select auth.uid()) and public.listing_editable(l.status)));

revoke all on public.tour_clips from anon, authenticated;
grant select on public.tour_clips to anon, authenticated;
grant delete on public.tour_clips to authenticated;

-- The owner's listing, locked for the rest of the calling transaction, if it
-- may still be edited. Raises a clear error otherwise.
create or replace function public.own_editable_listing(p_listing uuid)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $$
declare
  found public.listings;
begin
  select * into found from public.listings l where l.id = p_listing for update;
  if found.id is null or found.owner_id is distinct from auth.uid() then
    raise exception 'Listing not found' using errcode = 'P0001', hint = 'listing_not_found';
  end if;
  if not public.listing_editable(found.status) then
    raise exception 'This listing cannot be changed right now' using errcode = 'P0001', hint = 'listing_locked';
  end if;
  return found;
end;
$$;
revoke all on function public.own_editable_listing(uuid) from public, anon, authenticated;

-- Today's code for filming this listing (South African date). The same code
-- all day, a new one tomorrow.
create or replace function public.tour_code(p_listing uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Africa/Johannesburg')::date;
  letters constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  made text := '';
  result text;
begin
  perform public.own_editable_listing(p_listing);
  select c.code into result from public.tour_codes c where c.listing_id = p_listing and c.day = today;
  if result is not null then return result; end if;
  for i in 1..4 loop
    made := made || substr(letters, 1 + floor(random() * length(letters))::int, 1);
  end loop;
  insert into public.tour_codes (listing_id, day, code) values (p_listing, today, made)
  on conflict (listing_id, day) do nothing;
  select c.code into result from public.tour_codes c where c.listing_id = p_listing and c.day = today;
  return result;
end;
$$;
revoke all on function public.tour_code(uuid) from public, anon;
grant execute on function public.tour_code(uuid) to authenticated;

-- Save a clip the app has just uploaded. A room filmed again replaces the old
-- clip; the old file's path is returned so the app can delete it.
create or replace function public.add_tour_clip(
  p_listing uuid,
  p_room text,
  p_path text,
  p_seconds numeric,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_path text;
  other_seconds numeric;
begin
  perform public.own_editable_listing(p_listing);
  if p_path is null or p_path not like auth.uid()::text || '/' || p_listing::text || '/tour/%' then
    raise exception 'Clip saved in the wrong place' using errcode = 'P0001', hint = 'bad_clip_path';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'Location is needed for every clip' using errcode = 'P0001', hint = 'location_needed';
  end if;
  if p_seconds is null or p_seconds < 1 or p_seconds > 30 then
    raise exception 'Each clip must be 1 to 30 seconds long' using errcode = 'P0001', hint = 'clip_length';
  end if;
  select coalesce(sum(c.seconds), 0) into other_seconds
    from public.tour_clips c where c.listing_id = p_listing and c.room <> p_room;
  if other_seconds + p_seconds > 120 then
    raise exception 'The whole tour must be 2 minutes or less' using errcode = 'P0001', hint = 'tour_too_long';
  end if;

  delete from public.tour_clips c where c.listing_id = p_listing and c.room = p_room
    returning c.path into old_path;
  insert into public.tour_clips (listing_id, room, path, seconds, lat, lng, accuracy_m, code)
    values (p_listing, p_room, p_path, round(p_seconds, 1), p_lat, p_lng, p_accuracy, public.tour_code(p_listing));
  return old_path;
end;
$$;
revoke all on function public.add_tour_clip(uuid, text, text, numeric, double precision, double precision, double precision) from public, anon;
grant execute on function public.add_tour_clip(uuid, text, text, numeric, double precision, double precision, double precision) to authenticated;

-- Send for review, stop a review, approve, ask for changes ----------------------

create or replace function public.submit_listing(p_listing uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  photo_count int;
  clip_count int;
  outside_clip public.tour_clips;
begin
  perform public.own_editable_listing(p_listing);
  select count(*) into photo_count from public.listing_photos p where p.listing_id = p_listing;
  if photo_count < 5 then
    raise exception 'Add at least 5 photos' using errcode = 'P0001', hint = 'need_photos';
  end if;
  select count(*) into clip_count from public.tour_clips c where c.listing_id = p_listing;
  select * into outside_clip from public.tour_clips c where c.listing_id = p_listing and c.room = 'outside';
  if outside_clip.id is null or clip_count < 4 then
    raise exception 'Film the outside and at least 3 rooms' using errcode = 'P0001', hint = 'need_tour';
  end if;
  update public.listings set
    status = 'in_review',
    submitted_at = now(),
    review_note = null,
    filmed_lat = outside_clip.lat,
    filmed_lng = outside_clip.lng
  where id = p_listing;
end;
$$;
revoke all on function public.submit_listing(uuid) from public, anon;
grant execute on function public.submit_listing(uuid) to authenticated;

-- The owner stops a review to make changes (back to draft), or takes a live
-- listing down.
create or replace function public.withdraw_listing(p_listing uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  found public.listings;
  next_status text;
begin
  select * into found from public.listings l where l.id = p_listing for update;
  if found.id is null or found.owner_id is distinct from auth.uid() then
    raise exception 'Listing not found' using errcode = 'P0001', hint = 'listing_not_found';
  end if;
  next_status := case found.status when 'in_review' then 'draft' when 'live' then 'taken_down' end;
  if next_status is null then
    raise exception 'This listing is not under review or live' using errcode = 'P0001', hint = 'listing_locked';
  end if;
  update public.listings set status = next_status where id = p_listing;
  return next_status;
end;
$$;
revoke all on function public.withdraw_listing(uuid) from public, anon;
grant execute on function public.withdraw_listing(uuid) to authenticated;

create or replace function public.review_listing(p_listing uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  found public.listings;
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins review listings' using errcode = 'P0001', hint = 'not_admin';
  end if;
  select * into found from public.listings l where l.id = p_listing for update;
  if found.id is null then
    raise exception 'Listing not found' using errcode = 'P0001', hint = 'listing_not_found';
  end if;
  if found.status <> 'in_review' then
    raise exception 'This listing is no longer waiting for review' using errcode = 'P0001', hint = 'not_in_review';
  end if;
  if not p_approve and (note is null or char_length(note) < 5) then
    raise exception 'Say what needs to change' using errcode = 'P0001', hint = 'note_needed';
  end if;
  if char_length(coalesce(note, '')) > 500 then
    raise exception 'Keep the note under 500 characters' using errcode = 'P0001', hint = 'note_too_long';
  end if;
  update public.listings set
    status = case when p_approve then 'live' else 'changes_needed' end,
    review_note = case when p_approve then null else note end,
    reviewed_at = now(),
    reviewed_by = auth.uid()
  where id = p_listing;
  return case when p_approve then 'live' else 'changes_needed' end;
end;
$$;
revoke all on function public.review_listing(uuid, boolean, text) from public, anon;
grant execute on function public.review_listing(uuid, boolean, text) to authenticated;

-- Storage: photos and clips -----------------------------------------------------
-- Private buckets; files are reached through short-lived links. Who may read a
-- file follows who may see its listing (the folder's second part).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('listing-photos', 'listing-photos', false, 2097152, array['image/jpeg', 'image/webp']),
  ('listing-tours', 'listing-tours', false, 12582912, array['video/webm', 'video/mp4'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Listing files follow their listing" on storage.objects;
create policy "Listing files follow their listing"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id in ('listing-photos', 'listing-tours')
    and exists (select 1 from public.listings l where l.id::text = (storage.foldername(name))[2])
  );

drop policy if exists "Owners upload listing files while editing" on storage.objects;
create policy "Owners upload listing files while editing"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('listing-photos', 'listing-tours')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[3] = case bucket_id when 'listing-photos' then 'photos' else 'tour' end
    and exists (select 1 from public.listings l
                where l.id::text = (storage.foldername(name))[2]
                  and l.owner_id = (select auth.uid())
                  and public.listing_editable(l.status))
  );

drop policy if exists "Owners delete listing files while editing" on storage.objects;
create policy "Owners delete listing files while editing"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('listing-photos', 'listing-tours')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.listings l
                where l.id::text = (storage.foldername(name))[2]
                  and l.owner_id = (select auth.uid())
                  and (public.listing_editable(l.status)))
  );
