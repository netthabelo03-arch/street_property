-- Sprint 5: saved places (the heart in the tour feed and on listings).
-- Run this once in the Supabase dashboard (SQL Editor) after 005_enquiries.sql.
-- Safe to run again.

create table if not exists public.saved_listings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index if not exists saved_listings_user_idx on public.saved_listings (user_id, created_at desc);

alter table public.saved_listings enable row level security;

drop policy if exists "People see what they saved" on public.saved_listings;
create policy "People see what they saved"
  on public.saved_listings for select to authenticated
  using ((select auth.uid()) = user_id);

-- Only live listings can be saved (and only for yourself).
drop policy if exists "People save live listings" on public.saved_listings;
create policy "People save live listings"
  on public.saved_listings for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.listings l where l.id = listing_id and l.status = 'live')
  );

drop policy if exists "People remove what they saved" on public.saved_listings;
create policy "People remove what they saved"
  on public.saved_listings for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.saved_listings from anon, authenticated;
grant select, delete on public.saved_listings to authenticated;
grant insert (listing_id) on public.saved_listings to authenticated;

-- A person may save up to 200 places.
create or replace function public.saved_listings_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.saved_listings s where s.user_id = new.user_id) >= 200 then
    raise exception 'You can save up to 200 places' using errcode = 'P0001', hint = 'too_many_saved';
  end if;
  return new;
end;
$$;
drop trigger if exists saved_listings_limit on public.saved_listings;
create trigger saved_listings_limit
  before insert on public.saved_listings
  for each row execute function public.saved_listings_limit();

-- The caller's saved places, newest first, shaped like a search result.
-- A place that is no longer live comes back with only its id (live = false),
-- so the app can say so and offer to remove it.
create or replace function public.my_saved()
returns table (
  id uuid,
  live boolean,
  saved_at timestamptz,
  mode text,
  kind text,
  lister text,
  street_public text,
  area text,
  city text,
  price_rands integer,
  bedrooms smallint,
  bathrooms smallint,
  parking smallint,
  features text[],
  cover_path text,
  tour_seconds numeric,
  clip_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    s.listing_id, l.status = 'live', s.created_at,
    l.mode, l.kind, l.lister, l.street_public, l.area, l.city, l.price_rands,
    l.bedrooms, l.bathrooms, l.parking, l.features,
    case when l.status = 'live' then (select p.path from public.listing_photos p where p.listing_id = l.id order by p.position, p.created_at limit 1) end,
    case when l.status = 'live' then (select coalesce(sum(c.seconds), 0) from public.tour_clips c where c.listing_id = l.id) end,
    case when l.status = 'live' then (select count(*)::int from public.tour_clips c where c.listing_id = l.id) end
  from public.saved_listings s
  left join public.listings l on l.id = s.listing_id and l.status = 'live'
  where s.user_id = auth.uid()
  order by s.created_at desc;
$$;
revoke all on function public.my_saved() from public, anon;
grant execute on function public.my_saved() to authenticated;
