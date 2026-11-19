-- Dry run for 006_saved.sql. Paste 006_saved.sql followed by this file into
-- the SQL Editor and run both together. Nothing is kept.
-- Success looks like:  ERROR: DRYRUN OK: all 7 checks passed

do $$
declare
  owner_id uuid := gen_random_uuid();
  renter_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  live_id uuid;
  draft_id uuid;
  n int;
  is_live boolean;
  failed boolean;
  checks int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (owner_id, 'dry-save-owner@example.test', '{"role":"owner"}', 'authenticated', 'authenticated'),
         (renter_id, 'dry-save-renter@example.test', '{"role":"renter"}', 'authenticated', 'authenticated'),
         (other_id, 'dry-save-other@example.test', '{"role":"renter"}', 'authenticated', 'authenticated');
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, bedrooms)
  values (owner_id, 'owner', 'rent', 'flat', '24 Ngakane Street', 'Orlando West', 'Soweto', 4500, 2) returning id into live_id;
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, bedrooms)
  values (owner_id, 'owner', 'rent', 'flat', '1 Draft Road', 'Dube', 'Soweto', 3000, 1) returning id into draft_id;
  update public.listings set status = 'live', reviewed_at = now() where id = live_id;
  insert into public.listing_photos (listing_id, path, position) values (live_id, owner_id || '/' || live_id || '/photos/1.jpg', 0);

  -- 1. Visitors who are not signed in cannot save.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  failed := false;
  begin insert into public.saved_listings (listing_id) values (live_id); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 1 failed'; end if;
  checks := checks + 1;

  -- 2. A renter saves a live listing; saving it twice is refused.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.saved_listings (listing_id) values (live_id);
  failed := false;
  begin insert into public.saved_listings (listing_id) values (live_id); exception when unique_violation then failed := true; end;
  if not failed then raise exception 'check 2 failed'; end if;
  checks := checks + 1;

  -- 3. A listing that is not live cannot be saved.
  failed := false;
  begin insert into public.saved_listings (listing_id) values (draft_id); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 3 failed'; end if;
  checks := checks + 1;

  -- 4. Nobody can save for someone else.
  failed := false;
  begin insert into public.saved_listings (user_id, listing_id) values (other_id, live_id); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 4 failed'; end if;
  checks := checks + 1;

  -- 5. The saved list has the place with its cover.
  select count(*) into n from public.my_saved() where id = live_id and live and cover_path like '%/photos/1.jpg';
  if n <> 1 then raise exception 'check 5 failed'; end if;
  checks := checks + 1;

  -- 6. Others cannot see it.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.saved_listings;
  if n <> 0 then raise exception 'check 6 failed: %', n; end if;
  select count(*) into n from public.my_saved();
  if n <> 0 then raise exception 'check 6 failed: list %', n; end if;
  checks := checks + 1;

  -- 7. When the listing is taken down, it stays in the list as no longer live, with nothing else.
  execute 'reset role';
  update public.listings set status = 'taken_down' where id = live_id;
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select live into is_live from public.my_saved() where id = live_id;
  if is_live is not null and is_live then raise exception 'check 7 failed: still live'; end if;
  select count(*) into n from public.my_saved() where id = live_id and price_rands is null and cover_path is null;
  if n <> 1 then raise exception 'check 7 failed: details leaked'; end if;
  delete from public.saved_listings where listing_id = live_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check 7 failed: could not remove'; end if;
  checks := checks + 1;

  raise exception 'DRYRUN OK: all % checks passed', checks;
end;
$$;
