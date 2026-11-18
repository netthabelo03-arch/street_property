-- Dry run for 002_listings.sql. Paste 002_listings.sql followed by this file
-- into the SQL Editor and run both together. Everything happens inside one
-- transaction that ends with an error on purpose, so nothing is kept.
-- Success looks like:  ERROR: DRYRUN OK: all 24 checks passed

do $$
declare
  owner_id uuid := gen_random_uuid();
  renter_id uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  lid uuid;
  st text;
  lister_found text;
  code1 text;
  code2 text;
  old_path text;
  n int;
  checks int := 0;
  failed boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (owner_id, 'dry-owner@example.test', '{"role":"owner"}', 'authenticated', 'authenticated'),
         (renter_id, 'dry-renter@example.test', '{"role":"renter"}', 'authenticated', 'authenticated'),
         (admin_id, 'dry-admin@example.test', '{"role":"renter"}', 'authenticated', 'authenticated');
  insert into public.admins (user_id) values (admin_id);

  -- 1. An owner starts a listing: it is a draft, listed by the owner.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.listings (mode, kind, street, area, city, price_rands, bedrooms, bathrooms)
    values ('rent', 'flat', '12 Vilakazi Street', 'Orlando West', 'Soweto', 4500, 2, 1)
    returning id, status, lister into lid, st, lister_found;
  if st <> 'draft' or lister_found <> 'owner' then raise exception 'check 1 failed: % %', st, lister_found; end if;
  checks := checks + 1;

  -- 2. The owner cannot set the state directly.
  failed := false;
  begin
    update public.listings set status = 'live' where id = lid;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'check 2 failed: owner changed the status'; end if;
  checks := checks + 1;

  -- 3. A rent outside R300 to R500 000 is refused.
  failed := false;
  begin
    update public.listings set price_rands = 100 where id = lid;
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'check 3 failed: R100 rent accepted'; end if;
  checks := checks + 1;

  -- 4. Today's code is four characters and stays the same all day.
  code1 := public.tour_code(lid);
  code2 := public.tour_code(lid);
  if code1 !~ '^[A-Z2-9]{4}$' or code1 <> code2 then raise exception 'check 4 failed: % %', code1, code2; end if;
  checks := checks + 1;

  -- 5. A clip saved outside the owner's folder is refused.
  failed := false;
  begin
    perform public.add_tour_clip(lid, 'outside', 'someone-else/' || lid || '/tour/a.webm', 20, -26.2385, 27.9086, 10);
  exception when others then failed := sqlerrm like 'Clip saved in the wrong place%';
  end;
  if not failed then raise exception 'check 5 failed'; end if;
  checks := checks + 1;

  -- 6. A clip without a location is refused.
  failed := false;
  begin
    perform public.add_tour_clip(lid, 'outside', owner_id || '/' || lid || '/tour/a.webm', 20, null, 27.9, 10);
  exception when others then failed := sqlerrm like 'Location is needed%';
  end;
  if not failed then raise exception 'check 6 failed'; end if;
  checks := checks + 1;

  -- 7. Four clips of 30 seconds fill the 2 minutes; the code is written by the database.
  perform public.add_tour_clip(lid, 'outside', owner_id || '/' || lid || '/tour/o1.webm', 30, -26.2385, 27.9086, 10);
  perform public.add_tour_clip(lid, 'lounge', owner_id || '/' || lid || '/tour/l1.webm', 30, -26.2385, 27.9087, 10);
  perform public.add_tour_clip(lid, 'kitchen', owner_id || '/' || lid || '/tour/k1.webm', 30, -26.2386, 27.9086, 10);
  perform public.add_tour_clip(lid, 'bedroom_1', owner_id || '/' || lid || '/tour/b1.webm', 30, -26.2385, 27.9085, 10);
  select count(*) into n from public.tour_clips where listing_id = lid and code = code1;
  if n <> 4 then raise exception 'check 7 failed: % clips with the code', n; end if;
  checks := checks + 1;

  -- 8. A fifth clip would pass 2 minutes.
  failed := false;
  begin
    perform public.add_tour_clip(lid, 'meters', owner_id || '/' || lid || '/tour/m1.webm', 5, -26.2385, 27.9086, 10);
  exception when others then failed := sqlerrm like 'The whole tour must be 2 minutes%';
  end;
  if not failed then raise exception 'check 8 failed'; end if;
  checks := checks + 1;

  -- 9. Filming a room again replaces its clip and hands back the old file.
  old_path := public.add_tour_clip(lid, 'outside', owner_id || '/' || lid || '/tour/o2.webm', 20, -26.2385, 27.9086, 12);
  select count(*) into n from public.tour_clips where listing_id = lid;
  if old_path <> owner_id || '/' || lid || '/tour/o1.webm' or n <> 4 then raise exception 'check 9 failed: % %', old_path, n; end if;
  checks := checks + 1;

  -- 10. Clips cannot be added directly, only through add_tour_clip().
  failed := false;
  begin
    insert into public.tour_clips (listing_id, room, path, seconds, lat, lng, code)
      values (lid, 'meters', owner_id || '/' || lid || '/tour/x.webm', 5, 0, 0, 'AAAA');
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'check 10 failed'; end if;
  checks := checks + 1;

  -- 11. Sending with no photos is refused.
  failed := false;
  begin
    perform public.submit_listing(lid);
  exception when others then failed := sqlerrm like 'Add at least 5 photos%';
  end;
  if not failed then raise exception 'check 11 failed'; end if;
  checks := checks + 1;

  -- 12. A photo saved outside the listing's folder is refused.
  failed := false;
  begin
    insert into public.listing_photos (listing_id, path) values (lid, 'elsewhere/p.jpg');
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'check 12 failed'; end if;
  checks := checks + 1;

  -- 13. Five photos, then sending works and records where the outside was filmed.
  for i in 1..5 loop
    insert into public.listing_photos (listing_id, path, position) values (lid, owner_id || '/' || lid || '/photos/p' || i || '.jpg', i - 1);
  end loop;
  perform public.submit_listing(lid);
  select status into st from public.listings where id = lid;
  if st <> 'in_review' then raise exception 'check 13 failed: %', st; end if;
  checks := checks + 1;

  -- 14. While it is being checked the owner cannot change it.
  update public.listings set price_rands = 3000 where id = lid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'check 14 failed: edited while in review'; end if;
  checks := checks + 1;

  -- 15. A renter cannot list a place.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin
    insert into public.listings (mode, kind, street, area, city, price_rands) values ('rent', 'flat', '1 Main Road', 'Tembisa', 'Ekurhuleni', 3000);
  exception when others then failed := sqlerrm like 'Only owners and agents%';
  end;
  if not failed then raise exception 'check 15 failed'; end if;
  checks := checks + 1;

  -- 16. Nobody else sees a listing that is not live yet, nor its photos and clips.
  select count(*) into n from public.listings where id = lid;
  if n <> 0 then raise exception 'check 16 failed: renter sees a listing under review'; end if;
  select count(*) into n from public.listing_photos where listing_id = lid;
  if n <> 0 then raise exception 'check 16 failed: renter sees its photos'; end if;
  checks := checks + 1;

  -- 17. A renter cannot approve listings.
  failed := false;
  begin
    perform public.review_listing(lid, true, null);
  exception when others then failed := sqlerrm like 'Only admins%';
  end;
  if not failed then raise exception 'check 17 failed'; end if;
  checks := checks + 1;

  -- 18. The admin sees it in the queue.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.listings where id = lid and status = 'in_review';
  if n <> 1 then raise exception 'check 18 failed'; end if;
  select count(*) into n from public.tour_clips where listing_id = lid;
  if n <> 4 then raise exception 'check 18 failed: admin sees % clips', n; end if;
  checks := checks + 1;

  -- 19. Asking for changes needs a note; with one, the owner can edit again.
  failed := false;
  begin
    perform public.review_listing(lid, false, '  ');
  exception when others then failed := sqlerrm like 'Say what needs to change%';
  end;
  if not failed then raise exception 'check 19 failed'; end if;
  st := public.review_listing(lid, false, 'Film the bathroom too, please.');
  if st <> 'changes_needed' then raise exception 'check 19 failed: %', st; end if;
  checks := checks + 1;

  -- 20. The owner sends it again; the admin approves it.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.listings set description = 'Bathroom filmed.' where id = lid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check 20 failed: owner could not edit after changes were asked'; end if;
  perform public.submit_listing(lid);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  st := public.review_listing(lid, true, null);
  if st <> 'live' then raise exception 'check 20 failed: %', st; end if;
  checks := checks + 1;

  -- 21. A visitor who is not signed in sees the live listing, its photos and clips.
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  select count(*) into n from public.listings where id = lid;
  if n <> 1 then raise exception 'check 21 failed: listing'; end if;
  select count(*) into n from public.listing_photos where listing_id = lid;
  if n <> 5 then raise exception 'check 21 failed: % photos', n; end if;
  select count(*) into n from public.tour_clips where listing_id = lid;
  if n <> 4 then raise exception 'check 21 failed: % clips', n; end if;
  checks := checks + 1;

  -- 22. Visitors cannot read the daily codes or call the owner's functions.
  failed := false;
  begin
    select count(*) into n from public.tour_codes;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'check 22 failed: codes readable'; end if;
  failed := false;
  begin
    perform public.submit_listing(lid);
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'check 22 failed: anon called submit_listing'; end if;
  checks := checks + 1;

  -- 23. The owner takes it down; it is hidden and editable again.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  st := public.withdraw_listing(lid);
  if st <> 'taken_down' then raise exception 'check 23 failed: %', st; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  select count(*) into n from public.listings where id = lid;
  if n <> 0 then raise exception 'check 23 failed: still visible'; end if;
  checks := checks + 1;

  -- 24. The storage buckets exist, private, with their size limits.
  execute 'reset role';
  select count(*) into n from storage.buckets
    where (id = 'listing-photos' and not public and file_size_limit = 2097152)
       or (id = 'listing-tours' and not public and file_size_limit = 12582912);
  if n <> 2 then raise exception 'check 24 failed: % buckets', n; end if;
  checks := checks + 1;

  raise exception 'DRYRUN OK: all % checks passed', checks;
end;
$$;
