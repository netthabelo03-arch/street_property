-- Dry run for 010_deals.sql. Paste 010_deals.sql followed by this file into the
-- SQL Editor and run both together. Nothing is kept.
-- Success looks like:  ERROR: DRYRUN OK: all 13 checks passed

do $$
declare
  owner_id uuid := gen_random_uuid();
  renter_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  place uuid;
  talk uuid;
  visit uuid;
  deal uuid;
  v_rooms text[];
  v_hash text;
  v_text text;
  room text;
  st text;
  n int;
  failed boolean;
  checks int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (owner_id, 'dry-deal-owner@example.test', '{"role":"owner","full_name":"Thabo Mokoena"}', 'authenticated', 'authenticated'),
         (renter_id, 'dry-deal-renter@example.test', '{"role":"renter","full_name":"Lerato Dlamini"}', 'authenticated', 'authenticated'),
         (stranger_id, 'dry-deal-stranger@example.test', '{"role":"renter"}', 'authenticated', 'authenticated');
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, deposit_rands, bedrooms, bathrooms)
  values (owner_id, 'owner', 'rent', 'flat', '24 Ngakane Street', 'Orlando West', 'Soweto', 6500, 6500, 2, 1) returning id into place;
  update public.listings set status = 'live', reviewed_at = now(), filmed_lat = -26.2340, filmed_lng = 27.9080 where id = place;
  insert into public.enquiries (listing_id, renter_id, owner_id, move_in, lease_months)
  values (place, renter_id, owner_id, current_date + 10, 12) returning id into talk;
  insert into public.viewings (enquiry_id, starts_at, status, proposed_by) values (talk, now(), 'confirmed', renter_id) returning id into visit;

  -- 1. Visitors who are not signed in cannot use deals.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  failed := false;
  begin perform public.my_deals(); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 1 failed'; end if;
  checks := checks + 1;

  -- 2. "We met" needs both people at the address.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.mark_met(visit, -26.1000, 28.0500, 20); exception when others then failed := sqlerrm like 'You need to be at the address%'; end;
  if not failed then raise exception 'check 2 failed: far away'; end if;
  st := public.mark_met(visit, -26.2342, 27.9083, 20);
  if st <> 'waiting' then raise exception 'check 2 failed: renter %', st; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  st := public.mark_met(visit, -26.2339, 27.9079, 10);
  if st <> 'both' then raise exception 'check 2 failed: owner %', st; end if;
  checks := checks + 1;

  -- 3. The owner's yes starts a deal with the rooms of the place.
  execute 'reset role';
  update public.enquiries set shared_at = now(), owner_decision = 'accepted', decided_at = now() where id = talk;
  select d.id, d.rooms into deal, v_rooms from public.deals d where d.enquiry_id = talk;
  if deal is null or v_rooms <> array['outside', 'lounge', 'kitchen', 'bedroom_1', 'bedroom_2', 'bathroom_1', 'meters'] then
    raise exception 'check 3 failed: %', v_rooms;
  end if;
  if public.deal_rooms('backyard_room', 0, 0) <> array['outside', 'bedroom_1', 'bathroom_1', 'kitchen', 'meters'] then
    raise exception 'check 3 failed: backyard room';
  end if;
  checks := checks + 1;

  -- 4. Someone else cannot see the deal.
  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.deals;
  if n <> 0 then raise exception 'check 4 failed: table'; end if;
  select count(*) into n from public.deal_view(deal);
  if n <> 0 then raise exception 'check 4 failed: view'; end if;
  failed := false;
  begin perform public.cancel_deal(deal); exception when others then failed := sqlerrm like 'Deal not found%'; end;
  if not failed then raise exception 'check 4 failed: cancel'; end if;
  checks := checks + 1;

  -- 5. Only the owner sends the lease, with sensible terms.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.deal_view(deal) v where v.my_side = 'renter' and v.met_both and v.other_name = 'Thabo';
  if n <> 1 then raise exception 'check 5 failed: renter view'; end if;
  failed := false;
  begin perform public.send_lease(deal, 6500, 6500, current_date + 10, 12, null); exception when others then failed := sqlerrm like 'Only the owner sends the lease%'; end;
  if not failed then raise exception 'check 5 failed: renter'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.send_lease(deal, 6500, 6500, current_date - 1, 12, null); exception when others then failed := sqlerrm like 'Choose a start date%'; end;
  if not failed then raise exception 'check 5 failed: start'; end if;
  failed := false;
  begin perform public.send_lease(deal, 6500, 6500, current_date + 10, 9, null); exception when others then failed := sqlerrm like 'Choose 6, 12, 24 or 36 months%'; end;
  if not failed then raise exception 'check 5 failed: months'; end if;
  checks := checks + 1;

  -- 6. The lease is written from the template with the terms.
  perform public.send_lease(deal, 6500, 6500, current_date + 10, 12, '  No smoking inside.  ');
  select v.lease_text, v.lease_hash, v.status into v_text, v_hash, st from public.deal_view(deal) v;
  if st <> 'signing' or v_text not like '%R6 500 a month%' or v_text not like '%24 Ngakane Street, Orlando West, Soweto%'
     or v_text not like '%Landlord: Thabo Mokoena.%' or v_text not like '%No smoking inside.%'
     or v_hash <> encode(sha256(convert_to(v_text, 'UTF8')), 'hex') then
    raise exception 'check 6 failed';
  end if;
  failed := false;
  begin perform public.send_lease(deal, 7000, 7000, current_date + 10, 12, null); exception when others then failed := sqlerrm like 'The lease was already sent%'; end;
  if not failed then raise exception 'check 6 failed: twice'; end if;
  checks := checks + 1;

  -- 7. Signing needs the same text and a full name.
  failed := false;
  begin perform public.sign_lease(deal, 'Thabo Mokoena', 'abc'); exception when others then failed := sqlerrm like 'The lease changed%'; end;
  if not failed then raise exception 'check 7 failed: hash'; end if;
  failed := false;
  begin perform public.sign_lease(deal, 'Thabo', v_hash); exception when others then failed := sqlerrm like 'Type your full name%'; end;
  if not failed then raise exception 'check 7 failed: name'; end if;
  st := public.sign_lease(deal, 'Thabo Mokoena', v_hash);
  if st <> 'waiting' then raise exception 'check 7 failed: owner %', st; end if;
  checks := checks + 1;

  -- 8. The move-in check waits for both signatures; then the lease is signed.
  failed := false;
  begin perform public.set_room_note(deal, 'lounge', 'x'); exception when others then failed := sqlerrm like 'The move-in check starts%'; end;
  if not failed then raise exception 'check 8 failed: early'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  st := public.sign_lease(deal, 'Lerato Dlamini', v_hash);
  if st <> 'signed' then raise exception 'check 8 failed: renter %', st; end if;
  checks := checks + 1;

  -- 9. Photos must be in the deal's room folder, and every room needs one to sign.
  failed := false;
  begin perform public.add_inspection_photo(deal, 'lounge', deal || '/kitchen/a.jpg'); exception when others then failed := sqlerrm like 'Photo saved in the wrong place%'; end;
  if not failed then raise exception 'check 9 failed: path'; end if;
  failed := false;
  begin perform public.add_inspection_photo(deal, 'attic', deal || '/attic/a.jpg'); exception when others then failed := sqlerrm like 'Unknown room%'; end;
  if not failed then raise exception 'check 9 failed: room'; end if;
  perform public.add_inspection_photo(deal, 'lounge', deal || '/lounge/a.jpg');
  failed := false;
  begin perform public.sign_inspection(deal); exception when others then failed := sqlerrm like 'Add at least one photo of every room%'; end;
  if not failed then raise exception 'check 9 failed: missing'; end if;
  checks := checks + 1;

  -- 10. A change after one signature means both sign again.
  foreach room in array v_rooms loop
    if room <> 'lounge' then perform public.add_inspection_photo(deal, room, deal || '/' || room || '/a.jpg'); end if;
  end loop;
  perform public.set_room_note(deal, 'kitchen', 'Small chip on the counter.');
  st := public.sign_inspection(deal);
  if st <> 'waiting' then raise exception 'check 10 failed: renter %', st; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_room_note(deal, 'kitchen', 'Small chip on the counter, left side.');
  select count(*) into n from public.deals d where d.id = deal and d.renter_checked_at is null;
  if n <> 1 then raise exception 'check 10 failed: not reset'; end if;
  perform public.sign_inspection(deal);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  st := public.sign_inspection(deal);
  if st <> 'both' then raise exception 'check 10 failed: both %', st; end if;
  checks := checks + 1;

  -- 11. Only the renter confirms the keys; the listing then comes down.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.confirm_keys(deal); exception when others then failed := sqlerrm like 'Only the renter confirms the keys%'; end;
  if not failed then raise exception 'check 11 failed: owner'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.confirm_keys(deal);
  execute 'reset role';
  select count(*) into n from public.listings l where l.id = place and l.status = 'taken_down';
  if n <> 1 then raise exception 'check 11 failed: listing'; end if;
  select count(*) into n from public.deals d where d.id = deal and d.status = 'moved_in' and d.keys_at is not null;
  if n <> 1 then raise exception 'check 11 failed: deal'; end if;
  checks := checks + 1;

  -- 12. A finished deal cannot be called off, and the conversation shows the steps.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.cancel_deal(deal); exception when others then failed := sqlerrm like 'The renter has already moved in%'; end;
  if not failed then raise exception 'check 12 failed: cancel'; end if;
  execute 'reset role';
  select count(*) into n from public.messages m where m.enquiry_id = talk and m.kind = 'system'
    and m.body in ('You both confirmed you met at the viewing.', 'The lease is ready to sign.', 'Keys handed over. Welcome home!');
  if n <> 3 then raise exception 'check 12 failed: notes %', n; end if;
  checks := checks + 1;

  -- 13. Each person sees only their own deals in the list.
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.my_deals() x where x.my_side = 'renter' and x.status = 'moved_in';
  if n <> 1 then raise exception 'check 13 failed: renter'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.my_deals();
  if n <> 0 then raise exception 'check 13 failed: stranger'; end if;
  checks := checks + 1;

  execute 'reset role';
  raise exception 'DRYRUN OK: all % checks passed', checks;
end;
$$;
