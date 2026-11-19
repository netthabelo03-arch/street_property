-- Sprint 11: Promote. Owners and agents can pay to boost a live listing, so it
-- shows first in Explore, on the map list and in the Tours feed:
--   week       R49   7 days
--   fortnight  R99   14 days, ranked above week boosts
--   month      R179  30 days, ranked first, with a "Featured" badge
-- Payment is by card, EFT or other methods on Paystack's own page. The
-- "promote" Edge Function asks Paystack whether a payment went through; only it
-- can mark a boost paid.
--
-- The free tools (ad page, social post, To Let board) and the true monthly
-- cost need nothing in the database.
--
-- Run this once in the Supabase dashboard (SQL Editor) after 013_rent_reviews.sql.
-- Safe to run again.

create or replace function public.boost_rank(p_tier text)
returns integer
language sql
immutable
set search_path = ''
as $$ select case p_tier when 'month' then 3 when 'fortnight' then 2 when 'week' then 1 else 0 end; $$;

-- The price list. Change prices here only.
create or replace function public.boost_price(p_tier text)
returns table (amount_rands integer, days integer)
language sql
immutable
set search_path = ''
as $$
  select * from (values ('week', 49, 7), ('fortnight', 99, 14), ('month', 179, 30)) as t(tier, amount_rands, days)
  where t.tier = p_tier;
$$;

alter table public.listings add column if not exists boost_until timestamptz;
alter table public.listings add column if not exists boost_tier text;
alter table public.listings drop constraint if exists listings_boost_tier_check;
alter table public.listings add constraint listings_boost_tier_check check (boost_tier is null or boost_tier in ('week', 'fortnight', 'month'));
grant select (boost_until, boost_tier) on public.listings to anon, authenticated;

create table if not exists public.listing_boosts (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  tier text not null check (tier in ('week', 'fortnight', 'month')),
  amount_rands integer not null,
  days integer not null,
  state text not null default 'pending' check (state in ('pending', 'paid', 'failed')),
  starts_at timestamptz,
  ends_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists listing_boosts_listing_idx on public.listing_boosts (listing_id, created_at desc);
alter table public.listing_boosts enable row level security;
drop policy if exists "Owners read their boosts" on public.listing_boosts;
create policy "Owners read their boosts" on public.listing_boosts for select to authenticated
  using ((select auth.uid()) = owner_id or (select public.is_admin()));
revoke all on public.listing_boosts from anon, authenticated;
grant select on public.listing_boosts to authenticated;

-- The Edge Function opens an order for the owner of a live listing.
create or replace function public.boost_create(p_owner uuid, p_listing uuid, p_tier text)
returns public.listing_boosts
language plpgsql
security definer
set search_path = ''
as $$
declare
  place public.listings;
  price record;
  row_out public.listing_boosts;
begin
  select * into place from public.listings l where l.id = p_listing;
  if place.id is null or place.owner_id <> p_owner then
    raise exception 'Listing not found' using errcode = 'P0001', hint = 'listing_not_found';
  end if;
  if place.status <> 'live' then
    raise exception 'Only a live listing can be promoted' using errcode = 'P0001', hint = 'boost_not_live';
  end if;
  select * into price from public.boost_price(p_tier);
  if price.amount_rands is null then
    raise exception 'Choose a boost' using errcode = 'P0001', hint = 'boost_tier';
  end if;
  if (select count(*) from public.listing_boosts b where b.owner_id = p_owner and b.state = 'pending' and b.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many unpaid boosts. Try again later.' using errcode = 'P0001', hint = 'boost_too_many';
  end if;
  insert into public.listing_boosts (listing_id, owner_id, tier, amount_rands, days)
  values (place.id, p_owner, p_tier, price.amount_rands, price.days)
  returning * into row_out;
  return row_out;
end;
$$;
revoke all on function public.boost_create(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.boost_create(uuid, uuid, text) to service_role;

-- Paystack confirmed the payment: the boost starts now, or when the current one ends.
create or replace function public.boost_paid(p_boost uuid, p_amount_cents integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.listing_boosts;
  place public.listings;
  starts timestamptz;
begin
  select * into b from public.listing_boosts x where x.id = p_boost for update;
  if b.id is null then
    raise exception 'Boost not found' using errcode = 'P0001', hint = 'boost_not_found';
  end if;
  if b.state = 'paid' then return 'same'; end if;
  if p_amount_cents is distinct from b.amount_rands * 100 then
    raise exception 'Paid amount does not match' using errcode = 'P0001', hint = 'boost_amount';
  end if;
  select * into place from public.listings l where l.id = b.listing_id for update;
  starts := greatest(now(), coalesce(place.boost_until, now()));
  update public.listing_boosts set state = 'paid', paid_at = now(), starts_at = starts, ends_at = starts + make_interval(days => b.days)
  where id = b.id;
  update public.listings set boost_until = starts + make_interval(days => b.days),
    boost_tier = case when place.boost_until > now() and public.boost_rank(place.boost_tier) > public.boost_rank(b.tier) then place.boost_tier else b.tier end
  where id = place.id;
  return 'paid';
end;
$$;
revoke all on function public.boost_paid(uuid, integer) from public, anon, authenticated;
grant execute on function public.boost_paid(uuid, integer) to service_role;

create or replace function public.boost_failed(p_boost uuid)
returns void
language sql
security definer
set search_path = ''
as $$ update public.listing_boosts set state = 'failed' where id = p_boost and state = 'pending'; $$;
revoke all on function public.boost_failed(uuid) from public, anon, authenticated;
grant execute on function public.boost_failed(uuid) to service_role;

-- Search: boosted listings first (month, then fortnight, then week), with a
-- Featured flag for month boosts. Otherwise as before.
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
  total bigint,
  boosted boolean,
  featured boolean
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
           l.bedrooms, l.bathrooms, l.parking, l.features, l.available_from, l.reviewed_at, l.approx_lat, l.approx_lng, l.verified_at,
           case when l.boost_until > now() then public.boost_rank(l.boost_tier) else 0 end as boost_rank
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
    count(*) over (),
    m.boost_rank > 0,
    m.boost_rank = 3
  from matches m
  order by m.boost_rank desc, m.reviewed_at desc nulls last, m.id
  limit least(greatest(coalesce(p_limit, 20), 0), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.search_listings(text, text, integer, integer, integer, text[], text[], boolean, integer, integer, double precision, double precision, double precision, double precision, boolean) from public;
grant execute on function public.search_listings(text, text, integer, integer, integer, text[], text[], boolean, integer, integer, double precision, double precision, double precision, double precision, boolean) to anon, authenticated;
