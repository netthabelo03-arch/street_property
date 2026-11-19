-- Sprint 3: keep the exact address private, and search by map area.
-- Run this once in the Supabase dashboard (SQL Editor) after 003_search.sql.
-- Safe to run again.
--
-- Until now anyone could read a live listing's full street address and the
-- exact spot where its tour was filmed. From here on:
--   * everyone sees street_public ("Ngakane Street", no house number) and
--     approx_lat / approx_lng (rounded to about 100 m), which the map uses;
--   * the full street and exact spot are only for the owner and admins,
--     through listing_private() and clip_places().

-- "24 Ngakane Street" -> "Ngakane Street". Same rule as publicStreet() in the app.
create or replace function public.public_street(p_street text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(
    btrim(coalesce(p_street, '')),
    '^(no\.?\s*)?\d+[a-z]?(\s*[-/]\s*\d+[a-z]?)?(?=[\s,]|$)\s*,?\s*',
    '',
    'i'
  )), '');
$$;

alter table public.listings
  add column if not exists street_public text generated always as (public.public_street(street)) stored;
alter table public.listings
  add column if not exists approx_lat double precision generated always as (round(filmed_lat::numeric, 3)::double precision) stored;
alter table public.listings
  add column if not exists approx_lng double precision generated always as (round(filmed_lng::numeric, 3)::double precision) stored;

create index if not exists listings_live_place_idx
  on public.listings (approx_lat, approx_lng)
  where status = 'live';

-- Everyone may read every column except the exact address and spot.
revoke select on public.listings from anon, authenticated;
grant select (
  id, owner_id, lister, mode, kind, street_public, area, city, price_rands, deposit_rands,
  bedrooms, bathrooms, parking, features, description, available_from, status, review_note,
  approx_lat, approx_lng, created_at, updated_at, submitted_at, reviewed_at
) on public.listings to anon, authenticated;

-- The same for clips: where each clip was filmed is for the owner and admins.
revoke select on public.tour_clips from anon, authenticated;
grant select (id, listing_id, room, path, seconds, code, recorded_at) on public.tour_clips to anon, authenticated;

-- The full address and exact spot of listings the caller owns, or of any
-- listing for an admin. Others get no rows.
create or replace function public.listing_private(p_ids uuid[])
returns table (id uuid, street text, filmed_lat double precision, filmed_lng double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.street, l.filmed_lat, l.filmed_lng
  from public.listings l
  where l.id = any (p_ids)
    and (l.owner_id = auth.uid() or public.is_admin());
$$;
revoke all on function public.listing_private(uuid[]) from public, anon;
grant execute on function public.listing_private(uuid[]) to authenticated;

-- Where each clip of a listing was filmed, for its owner and admins.
create or replace function public.clip_places(p_listing uuid)
returns table (id uuid, lat double precision, lng double precision, accuracy_m double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.lat, c.lng, c.accuracy_m
  from public.tour_clips c
  join public.listings l on l.id = c.listing_id
  where c.listing_id = p_listing
    and (l.owner_id = auth.uid() or public.is_admin());
$$;
revoke all on function public.clip_places(uuid) from public, anon;
grant execute on function public.clip_places(uuid) to authenticated;

-- Search, now with an optional map area (south, west, north, east), and the
-- public street and rounded spot in place of the address.
drop function if exists public.search_listings(text, text, integer, integer, integer, text[], text[], boolean, integer, integer);
drop function if exists public.search_listings(text, text, integer, integer, integer, text[], text[], boolean, integer, integer, double precision, double precision, double precision, double precision);

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
  p_east double precision default null
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
           l.bedrooms, l.bathrooms, l.parking, l.features, l.available_from, l.reviewed_at, l.approx_lat, l.approx_lng
    from public.listings l, words
    where l.status = 'live'
      and l.mode = p_mode
      and (p_min_price is null or l.price_rands >= p_min_price)
      and (p_max_price is null or l.price_rands <= p_max_price)
      and (p_min_beds is null or l.bedrooms >= p_min_beds)
      and (p_kinds is null or cardinality(p_kinds) = 0 or l.kind = any (p_kinds))
      and (p_features is null or l.features @> p_features)
      and (not coalesce(p_parking, false) or l.parking >= 1)
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
    m.bedrooms, m.bathrooms, m.parking, m.features, m.available_from, m.reviewed_at, m.approx_lat, m.approx_lng,
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

revoke all on function public.search_listings(text, text, integer, integer, integer, text[], text[], boolean, integer, integer, double precision, double precision, double precision, double precision) from public;
grant execute on function public.search_listings(text, text, integer, integer, integer, text[], text[], boolean, integer, integer, double precision, double precision, double precision, double precision) to anon, authenticated;
