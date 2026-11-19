-- Dry run for 004_map.sql. Paste 004_map.sql followed by this file into the
-- SQL Editor and run both together. Nothing is kept.
-- Success looks like:  ERROR: DRYRUN OK: all 12 checks passed

do $$
declare
  owner_id uuid := gen_random_uuid();
  renter_id uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  a uuid;
  far uuid;
  n bigint;
  txt text;
  got_lat double precision;
  failed boolean;
  checks int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (owner_id, 'dry-map-owner@example.test', '{"role":"owner"}', 'authenticated', 'authenticated'),
         (renter_id, 'dry-map-renter@example.test', '{"role":"renter"}', 'authenticated', 'authenticated'),
         (admin_id, 'dry-map-admin@example.test', '{"role":"renter"}', 'authenticated', 'authenticated');
  insert into public.admins (user_id) values (admin_id);

  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, bedrooms)
  values (owner_id, 'owner', 'rent', 'flat', '24 Ngakane Street', 'Orlando West', 'Soweto', 4500, 2) returning id into a;
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, bedrooms)
  values (owner_id, 'owner', 'rent', 'flat', '8 Leeuwkop Road', 'Sunninghill', 'Sandton', 12900, 3) returning id into far;
  update public.listings set status = 'live', reviewed_at = now(), filmed_lat = -26.238512, filmed_lng = 27.908634 where id = a;
  update public.listings set status = 'live', reviewed_at = now() - interval '1 day', filmed_lat = -26.0326, filmed_lng = 28.0601 where id = far;
  insert into public.tour_clips (listing_id, room, path, seconds, lat, lng, accuracy_m, code)
  values (a, 'outside', owner_id || '/' || a || '/tour/o.webm', 15, -26.238512, 27.908634, 8, 'AAAA');

  -- 1. The public street and rounded spot are worked out by the database.
  select street_public, approx_lat into txt, got_lat from public.listings where id = a;
  if txt <> 'Ngakane Street' or got_lat <> -26.239 then raise exception 'check 1 failed: % %', txt, got_lat; end if;
  if public.public_street('4th Avenue') <> '4th Avenue' or public.public_street('No. 7 Mthimkhulu Street') <> 'Mthimkhulu Street'
     or public.public_street('15-17 Main Road') <> 'Main Road' or public.public_street('42') is not null then
    raise exception 'check 1 failed: public_street rules';
  end if;
  checks := checks + 1;

  -- As a visitor who is not signed in:
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';

  -- 2. The full street cannot be read.
  failed := false;
  begin
    select street into txt from public.listings where id = a;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'check 2 failed: street readable'; end if;
  checks := checks + 1;

  -- 3. Nor the exact spot.
  failed := false;
  begin
    select filmed_lat into got_lat from public.listings where id = a;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'check 3 failed: filmed_lat readable'; end if;
  checks := checks + 1;

  -- 4. Nor where the clips were filmed; the clips themselves still play.
  failed := false;
  begin
    select lat into got_lat from public.tour_clips where listing_id = a limit 1;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'check 4 failed: clip lat readable'; end if;
  select count(*) into n from (select id, room, path, seconds, code from public.tour_clips where listing_id = a) x;
  if n <> 1 then raise exception 'check 4 failed: clips hidden'; end if;
  checks := checks + 1;

  -- 5. The public columns can be read.
  select street_public into txt from public.listings where id = a;
  if txt <> 'Ngakane Street' then raise exception 'check 5 failed: %', txt; end if;
  checks := checks + 1;

  -- 6. Search returns the public street and rounded spot, and searches by street name.
  select street_public, approx_lat into txt, got_lat from public.search_listings('rent', 'ngakane');
  if txt <> 'Ngakane Street' or got_lat <> -26.239 then raise exception 'check 6 failed: % %', txt, got_lat; end if;
  checks := checks + 1;

  -- 7. A house number cannot be used to find a house.
  select count(*) into n from public.search_listings('rent', '24 ngakane');
  if n <> 0 then raise exception 'check 7 failed: found by house number'; end if;
  checks := checks + 1;

  -- 8. Search by map area: only places inside the box.
  select count(*) into n from public.search_listings('rent', null, null, null, null, null, null, false, 50, 0, -26.30, 27.85, -26.20, 27.95);
  if n <> 1 then raise exception 'check 8 failed: % in Soweto box', n; end if;
  select count(*) into n from public.search_listings('rent', null, null, null, null, null, null, false, 50, 0, -26.40, 27.80, -25.90, 28.20);
  if n <> 2 then raise exception 'check 8 failed: % in Joburg box', n; end if;
  checks := checks + 1;

  -- 9. Visitors cannot call the private functions.
  failed := false;
  begin
    perform * from public.listing_private(array[a]);
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'check 9 failed'; end if;
  checks := checks + 1;

  -- 10. A renter gets nothing from them.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.listing_private(array[a, far]);
  if n <> 0 then raise exception 'check 10 failed: renter got % addresses', n; end if;
  select count(*) into n from public.clip_places(a);
  if n <> 0 then raise exception 'check 10 failed: renter got % clip places', n; end if;
  checks := checks + 1;

  -- 11. The owner gets the full address and where each clip was filmed.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select street into txt from public.listing_private(array[a]);
  if txt <> '24 Ngakane Street' then raise exception 'check 11 failed: %', txt; end if;
  select count(*) into n from public.clip_places(a);
  if n <> 1 then raise exception 'check 11 failed: % clip places', n; end if;
  -- ... and can still start a listing and read back its public columns.
  insert into public.listings (mode, kind, street, area, city, price_rands)
    values ('rent', 'flat', '5 New Street', 'Dube', 'Soweto', 3000) returning street_public into txt;
  if txt <> 'New Street' then raise exception 'check 11 failed: new listing %', txt; end if;
  checks := checks + 1;

  -- 12. An admin gets every address.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.listing_private(array[a, far]);
  if n <> 2 then raise exception 'check 12 failed: admin got %', n; end if;
  checks := checks + 1;

  raise exception 'DRYRUN OK: all % checks passed', checks;
end;
$$;
