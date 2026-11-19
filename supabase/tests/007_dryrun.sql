-- Dry run for 007_verified.sql. Paste 007_verified.sql followed by this file
-- into the SQL Editor and run both together. Nothing is kept.
-- Success looks like:  ERROR: DRYRUN OK: all 14 checks passed

do $$
declare
  owner_id uuid := gen_random_uuid();
  renter_id uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  place uuid;
  files text[];
  n int;
  st text;
  failed boolean;
  checks int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (owner_id, 'dry-ver-owner@example.test', '{"role":"owner","full_name":"Lerato Dlamini"}', 'authenticated', 'authenticated'),
         (renter_id, 'dry-ver-renter@example.test', '{"role":"renter"}', 'authenticated', 'authenticated'),
         (admin_id, 'dry-ver-admin@example.test', '{"role":"renter"}', 'authenticated', 'authenticated');
  insert into public.admins (user_id) values (admin_id);
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, bedrooms)
  values (owner_id, 'owner', 'rent', 'flat', '24 Ngakane Street', 'Orlando West', 'Soweto', 4500, 2) returning id into place;
  update public.listings set status = 'live', reviewed_at = now() where id = place;

  -- 1. Visitors who are not signed in cannot send checks or read them.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  failed := false;
  begin perform public.submit_identity('a', 'b'); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 1 failed: submit'; end if;
  failed := false;
  begin select count(*) into n from public.identity_checks; exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 1 failed: read'; end if;
  checks := checks + 1;

  -- 2. The owner's ID photos must be in their own folder.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.submit_identity(renter_id || '/identity/id.jpg', owner_id || '/identity/selfie.jpg');
  exception when others then failed := sqlerrm like 'Add a photo of your ID%'; end;
  if not failed then raise exception 'check 2 failed'; end if;
  checks := checks + 1;

  -- 3. Sending the ID; sending again while it waits is refused.
  perform public.submit_identity(owner_id || '/identity/id.jpg', owner_id || '/identity/selfie.jpg');
  failed := false;
  begin perform public.submit_identity(owner_id || '/identity/id2.jpg', owner_id || '/identity/selfie2.jpg');
  exception when others then failed := sqlerrm like 'Your ID is already being checked%'; end;
  if not failed then raise exception 'check 3 failed'; end if;
  checks := checks + 1;

  -- 4. Even the owner cannot read where the documents are kept; they can read the status.
  failed := false;
  begin select id_path into st from public.identity_checks where user_id = owner_id; exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 4 failed'; end if;
  select status into st from public.identity_checks where user_id = owner_id;
  if st <> 'pending' then raise exception 'check 4 failed: status %', st; end if;
  checks := checks + 1;

  -- 5. Proof of ownership: documents in the listing's folder; an owner needs one.
  failed := false;
  begin perform public.submit_ownership(place, array[owner_id || '/other/ownership/deed.pdf']);
  exception when others then failed := sqlerrm like 'Document saved in the wrong place%'; end;
  if not failed then raise exception 'check 5 failed: folder'; end if;
  failed := false;
  begin perform public.submit_ownership(place, array[]::text[]);
  exception when others then failed := sqlerrm like 'Add the documents asked for%'; end;
  if not failed then raise exception 'check 5 failed: none'; end if;
  perform public.submit_ownership(place, array[owner_id || '/' || place || '/ownership/rates.pdf']);
  checks := checks + 1;

  -- 6. My verification: ID and ownership waiting, no tour yet.
  select identity_status || ',' || ownership_status || ',' || on_site::text into st from public.my_verification(place);
  if st <> 'pending,pending,false' then raise exception 'check 6 failed: %', st; end if;
  checks := checks + 1;

  -- 7. Someone else cannot send proof for this listing or see its checks.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.submit_ownership(place, array[renter_id || '/' || place || '/ownership/x.pdf']);
  exception when others then failed := sqlerrm like 'Listing not found%'; end;
  if not failed then raise exception 'check 7 failed: submit'; end if;
  select count(*) into n from public.identity_checks;
  if n <> 0 then raise exception 'check 7 failed: sees % checks', n; end if;
  checks := checks + 1;

  -- 8. Only admins see the queue.
  failed := false;
  begin perform * from public.verification_queue(); exception when others then failed := sqlerrm like 'Only admins%'; end;
  if not failed then raise exception 'check 8 failed'; end if;
  checks := checks + 1;

  -- 9. The admin sees both checks, with the documents' paths and the full address.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.verification_queue();
  if n <> 2 then raise exception 'check 9 failed: % in queue', n; end if;
  select street into st from public.verification_queue() where kind = 'ownership';
  if st <> '24 Ngakane Street' then raise exception 'check 9 failed: %', st; end if;
  checks := checks + 1;

  -- 10. Turning an ID down needs a note; the paths come back and are cleared.
  failed := false;
  begin perform public.decide_check('identity', owner_id, false, ''); exception when others then failed := sqlerrm like 'Say what the person%'; end;
  if not failed then raise exception 'check 10 failed: note'; end if;
  files := public.decide_check('identity', owner_id, false, 'The ID photo is blurry. Take it again in daylight.');
  if cardinality(files) <> 2 or files[1] not like '%/identity/id.jpg' then raise exception 'check 10 failed: files %', files; end if;
  execute 'reset role';
  select count(*) into n from public.identity_checks where user_id = owner_id and status = 'rejected' and id_path is null and selfie_path is null;
  if n <> 1 then raise exception 'check 10 failed: paths kept'; end if;
  checks := checks + 1;

  -- 11. The owner sends the ID again and the admin approves both checks; no badge yet without a tour.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.submit_identity(owner_id || '/identity/id3.jpg', owner_id || '/identity/selfie3.jpg');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.decide_check('identity', owner_id, true);
  files := public.decide_check('ownership', place, true);
  if cardinality(files) <> 1 then raise exception 'check 11 failed: files'; end if;
  execute 'reset role';
  if (select verified_at from public.listings where id = place) is not null then raise exception 'check 11 failed: badge without a tour'; end if;
  checks := checks + 1;

  -- 12. The outside clip completes the badge.
  insert into public.tour_clips (listing_id, room, path, seconds, lat, lng, code)
    values (place, 'outside', owner_id || '/' || place || '/tour/o.webm', 15, -26.2, 27.9, 'AAAA');
  if (select verified_at from public.listings where id = place) is null then raise exception 'check 12 failed'; end if;
  checks := checks + 1;

  -- 13. Visitors see the badge and can search for verified places only.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  select count(*) into n from public.search_listings('rent', p_verified => true);
  if n <> 1 then raise exception 'check 13 failed: %', n; end if;
  select count(*) into n from public.listings where id = place and verified_at is not null;
  if n <> 1 then raise exception 'check 13 failed: badge hidden'; end if;
  checks := checks + 1;

  -- 14. A new address loses the badge and needs new proof of ownership.
  execute 'reset role';
  update public.listings set status = 'changes_needed' where id = place;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.listings set street = '26 Ngakane Street' where id = place;
  execute 'reset role';
  if (select verified_at from public.listings where id = place) is not null then raise exception 'check 14 failed: badge kept'; end if;
  if exists (select 1 from public.ownership_checks where listing_id = place) then raise exception 'check 14 failed: old proof kept'; end if;
  checks := checks + 1;

  raise exception 'DRYRUN OK: all % checks passed', checks;
end;
$$;
