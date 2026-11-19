-- Dry run for 003_search.sql. Paste 003_search.sql followed by this file into
-- the SQL Editor and run both together. Nothing is kept.
-- Success looks like:  ERROR: DRYRUN OK: all 12 checks passed

do $$
declare
  owner_id uuid := gen_random_uuid();
  a uuid; b uuid; c uuid; d uuid; e uuid;
  n bigint;
  first_id uuid;
  cover text;
  tour text;
  secs numeric;
  checks int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (owner_id, 'dry-search@example.test', '{"role":"owner"}', 'authenticated', 'authenticated');

  -- Five listings, inserted directly (as the database owner) in known states.
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, bedrooms, bathrooms, parking, features, status, reviewed_at)
  values (owner_id, 'owner', 'rent', 'flat', '24 Ngakane Street', 'Orlando West', 'Soweto', 4500, 2, 1, 1, '{prepaid,power_backup}', 'live', now() - interval '1 day')
  returning id into a;
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, bedrooms, bathrooms, parking, features, status, reviewed_at)
  values (owner_id, 'owner', 'rent', 'backyard_room', '7 Mthimkhulu Street', 'Tembisa', 'Ekurhuleni', 2200, 1, 1, 0, '{prepaid}', 'live', now() - interval '2 days')
  returning id into b;
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, bedrooms, bathrooms, parking, features, status, reviewed_at)
  values (owner_id, 'owner', 'sell', 'house', '12 Mphahlele Street', 'Pimville', 'Soweto', 1450000, 3, 2, 2, '{water_backup}', 'live', now())
  returning id into c;
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, bedrooms, status)
  values (owner_id, 'owner', 'rent', 'flat', '1 Draft Road', 'Orlando East', 'Soweto', 3000, 2, 'draft')
  returning id into d;
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, bedrooms, status, submitted_at)
  values (owner_id, 'owner', 'rent', 'flat', '2 Review Road', 'Orlando East', 'Soweto', 3100, 2, 'in_review', now())
  returning id into e;
  -- The listing trigger forces new rows to draft; set the states afterwards.
  update public.listings set status = 'live', reviewed_at = now() - interval '1 day' where id = a;
  update public.listings set status = 'live', reviewed_at = now() - interval '2 days' where id = b;
  update public.listings set status = 'live', reviewed_at = now() where id = c;
  update public.listings set status = 'in_review' where id = e;

  insert into public.listing_photos (listing_id, path, position) values
    (a, owner_id || '/' || a || '/photos/2.jpg', 1),
    (a, owner_id || '/' || a || '/photos/1.jpg', 0);
  insert into public.tour_clips (listing_id, room, path, seconds, lat, lng, code) values
    (a, 'lounge', owner_id || '/' || a || '/tour/lounge.webm', 20, -26.2, 27.9, 'AAAA'),
    (a, 'outside', owner_id || '/' || a || '/tour/outside.webm', 15, -26.2, 27.9, 'AAAA');

  -- Search as a visitor who is not signed in.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';

  -- 1. Only live listings of the chosen mode: drafts and listings under review never show.
  select count(*) into n from public.search_listings('rent');
  if n <> 2 then raise exception 'check 1 failed: % rent results', n; end if;
  checks := checks + 1;

  -- 2. The total comes with every row.
  select total into n from public.search_listings('rent') limit 1;
  if n <> 2 then raise exception 'check 2 failed: total %', n; end if;
  checks := checks + 1;

  -- 3. Newest approved first.
  select id into first_id from public.search_listings('rent') limit 1;
  if first_id <> a then raise exception 'check 3 failed'; end if;
  checks := checks + 1;

  -- 4. Cover photo is the first by position; the tour starts with the outside clip; seconds add up.
  select cover_path, tour_path, tour_seconds into cover, tour, secs from public.search_listings('rent') where id = a;
  if cover not like '%/photos/1.jpg' or tour not like '%/outside.webm' or secs <> 35 then
    raise exception 'check 4 failed: % % %', cover, tour, secs;
  end if;
  checks := checks + 1;

  -- 5. Every word must match the street, area or city, in any order and case.
  select count(*) into n from public.search_listings('rent', 'soweto ORLANDO');
  if n <> 1 then raise exception 'check 5 failed: %', n; end if;
  select count(*) into n from public.search_listings('rent', 'soweto tembisa');
  if n <> 0 then raise exception 'check 5 failed: % for two places', n; end if;
  checks := checks + 1;

  -- 6. % and _ are plain characters, not wildcards.
  select count(*) into n from public.search_listings('rent', '%');
  if n <> 0 then raise exception 'check 6 failed: %% matched %', n; end if;
  select count(*) into n from public.search_listings('rent', '_');
  if n <> 0 then raise exception 'check 6 failed: _ matched %', n; end if;
  checks := checks + 1;

  -- 7. Price range.
  select count(*) into n from public.search_listings('rent', null, 3000, 5000);
  if n <> 1 then raise exception 'check 7 failed: %', n; end if;
  checks := checks + 1;

  -- 8. Bedrooms at least.
  select count(*) into n from public.search_listings('rent', null, null, null, 2);
  if n <> 1 then raise exception 'check 8 failed: %', n; end if;
  checks := checks + 1;

  -- 9. Type of place (any of those chosen).
  select count(*) into n from public.search_listings('rent', null, null, null, null, array['backyard_room', 'cottage']);
  if n <> 1 then raise exception 'check 9 failed: %', n; end if;
  checks := checks + 1;

  -- 10. Must-haves: every one chosen; parking separately.
  select count(*) into n from public.search_listings('rent', null, null, null, null, null, array['prepaid']);
  if n <> 2 then raise exception 'check 10 failed: prepaid %', n; end if;
  select count(*) into n from public.search_listings('rent', null, null, null, null, null, array['prepaid', 'power_backup']);
  if n <> 1 then raise exception 'check 10 failed: both %', n; end if;
  select count(*) into n from public.search_listings('rent', null, null, null, null, null, null, true);
  if n <> 1 then raise exception 'check 10 failed: parking %', n; end if;
  checks := checks + 1;

  -- 11. Pages: at most 50 a page; offset moves on.
  select count(*) into n from public.search_listings('rent', null, null, null, null, null, null, false, 1, 1);
  if n <> 1 then raise exception 'check 11 failed: %', n; end if;
  select count(*) into n from public.search_listings('rent', null, null, null, null, null, null, false, 1000, 0);
  if n <> 2 then raise exception 'check 11 failed: %', n; end if;
  checks := checks + 1;

  -- 12. Buy mode shows the house for sale only.
  select count(*) into n from public.search_listings('sell', 'pimville');
  if n <> 1 then raise exception 'check 12 failed: %', n; end if;
  checks := checks + 1;

  raise exception 'DRYRUN OK: all % checks passed', checks;
end;
$$;
