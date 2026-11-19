-- Sprint 2: search live listings for Explore.
-- Run this once in the Supabase dashboard (SQL Editor) after 002_listings.sql.
-- Safe to run again.
--
-- search_listings() runs with the caller's own rights (security invoker), so
-- the listing rules from 002 still apply: visitors only ever get live
-- listings. Each row comes with its cover photo, its outside clip and the
-- length of its tour, and the total number of matches for the count line.

create index if not exists listings_live_search_idx
  on public.listings (mode, price_rands)
  where status = 'live';

drop function if exists public.search_listings(text, text, integer, integer, integer, text[], text[], boolean, integer, integer);

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
  p_offset integer default 0
)
returns table (
  id uuid,
  mode text,
  kind text,
  lister text,
  street text,
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
    -- Each word typed must appear in the street, the area or the city.
    -- % and _ are matched as plain characters.
    select array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%') as patterns
    from unnest(regexp_split_to_array(lower(btrim(coalesce(p_text, ''))), '\s+')) as w
    where w <> ''
  ),
  matches as (
    select l.*
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
        words.patterns is null
        or (select bool_and(lower(l.street || ' ' || l.area || ' ' || l.city) like p escape '\')
            from unnest(words.patterns) as p)
      )
  )
  select
    m.id, m.mode, m.kind, m.lister, m.street, m.area, m.city, m.price_rands, m.deposit_rands,
    m.bedrooms, m.bathrooms, m.parking, m.features, m.available_from, m.reviewed_at,
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

revoke all on function public.search_listings(text, text, integer, integer, integer, text[], text[], boolean, integer, integer) from public;
grant execute on function public.search_listings(text, text, integer, integer, integer, text[], text[], boolean, integer, integer) to anon, authenticated;
