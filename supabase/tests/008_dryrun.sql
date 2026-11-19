-- Dry run for 008_renter_check.sql. Paste 008_renter_check.sql followed by
-- this file into the SQL Editor and run both together. Nothing is kept.
-- Success looks like:  ERROR: DRYRUN OK: all 11 checks passed

do $$
declare
  owner_id uuid := gen_random_uuid();
  renter_id uuid := gen_random_uuid();
  renter2_id uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  place uuid;
  talk uuid;
  talk2 uuid;
  files text[];
  n int;
  st text;
  ratio numeric;
  ok_id boolean;
  ok_income boolean;
  failed boolean;
  checks int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (owner_id, 'dry-rc-owner@example.test', '{"role":"owner","full_name":"Thabo Mokoena"}', 'authenticated', 'authenticated'),
         (renter_id, 'dry-rc-renter@example.test', '{"role":"renter","full_name":"Lerato Dlamini"}', 'authenticated', 'authenticated'),
         (renter2_id, 'dry-rc-renter2@example.test', '{"role":"renter","full_name":"Sipho Nkosi"}', 'authenticated', 'authenticated'),
         (admin_id, 'dry-rc-admin@example.test', '{"role":"renter"}', 'authenticated', 'authenticated'),
         (stranger_id, 'dry-rc-stranger@example.test', '{"role":"renter"}', 'authenticated', 'authenticated');
  insert into public.admins (user_id) values (admin_id);
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, bedrooms)
  values (owner_id, 'owner', 'rent', 'flat', '24 Ngakane Street', 'Orlando West', 'Soweto', 4500, 2) returning id into place;
  update public.listings set status = 'live', reviewed_at = now() where id = place;

  -- 1. Visitors who are not signed in cannot send income documents.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  failed := false;
  begin perform public.submit_income(array['x']); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 1 failed'; end if;
  checks := checks + 1;

  -- 2. The renter sends payslips from their own folder, once at a time.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.submit_income(array[stranger_id || '/income/p.pdf']); exception when others then failed := sqlerrm like 'Document saved in the wrong place%'; end;
  if not failed then raise exception 'check 2 failed: folder'; end if;
  perform public.submit_income(array[renter_id || '/income/payslip.pdf', renter_id || '/income/bank.pdf']);
  failed := false;
  begin perform public.submit_income(array[renter_id || '/income/again.pdf']); exception when others then failed := sqlerrm like 'Your income is already being checked%'; end;
  if not failed then raise exception 'check 2 failed: twice'; end if;
  checks := checks + 1;

  -- 3. The renter cannot read where the documents are kept.
  failed := false;
  begin select doc_paths[1] into st from public.income_checks; exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 3 failed'; end if;
  checks := checks + 1;

  -- 4. The admin sees the income check; approving needs the amount; the paths come back.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.verification_queue() where kind = 'income' and subject_id = renter_id;
  if n <> 1 then raise exception 'check 4 failed: queue'; end if;
  failed := false;
  begin perform public.decide_income(renter_id, true); exception when others then failed := sqlerrm like 'Enter the monthly take-home pay%'; end;
  if not failed then raise exception 'check 4 failed: amount'; end if;
  files := public.decide_income(renter_id, true, 14000);
  if cardinality(files) <> 2 then raise exception 'check 4 failed: files'; end if;
  checks := checks + 1;

  -- 5. The renter sees the result, good for three months.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select income_status into st from public.my_renter_check();
  if st <> 'approved' then raise exception 'check 5 failed: %', st; end if;
  if (select valid_until from public.my_renter_check()) <> current_date + 90 then raise exception 'check 5 failed: valid until'; end if;
  checks := checks + 1;

  -- 6. The renter asks about the place; the owner sees nothing of the check yet.
  talk := public.start_enquiry(place, 'Hi, is it available?');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.renter_check_for(talk);
  if n <> 0 then raise exception 'check 6 failed'; end if;
  checks := checks + 1;

  -- 7. Sharing: the move-in date must be ahead; then a note is added.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.share_renter_check(talk, current_date - 3, 12, 'Me and my daughter', false);
  exception when others then failed := sqlerrm like 'Choose a move-in date%'; end;
  if not failed then raise exception 'check 7 failed: date'; end if;
  perform public.share_renter_check(talk, current_date + 12, 12, 'Me and my daughter', false);
  select count(*) into n from public.messages where enquiry_id = talk and body = 'Lerato shared their renter check.';
  if n <> 1 then raise exception 'check 7 failed: note'; end if;
  checks := checks + 1;

  -- 8. The owner sees: ID not checked yet, income covers the rent 3.1 times, the household. Not the amount.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select renter_name, id_checked, income_checked, cover_ratio into st, ok_id, ok_income, ratio from public.renter_check_for(talk);
  if st <> 'Lerato D.' or ok_id or not ok_income or ratio <> 3.1 then raise exception 'check 8 failed: % % % %', st, ok_id, ok_income, ratio; end if;
  failed := false;
  begin select monthly_income_rands into n from public.income_checks where user_id = renter_id; exception when insufficient_privilege then failed := true; end;
  if not failed and n is not null then raise exception 'check 8 failed: owner reads the amount'; end if;
  checks := checks + 1;

  -- 9. Someone else sees nothing.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.renter_check_for(talk);
  if n <> 0 then raise exception 'check 9 failed'; end if;
  checks := checks + 1;

  -- 10. Only the owner decides, once.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.decide_renter(talk, true); exception when others then failed := sqlerrm like 'Only the owner can decide%'; end;
  if not failed then raise exception 'check 10 failed: renter decided'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  st := public.decide_renter(talk, true);
  failed := false;
  begin perform public.decide_renter(talk, false); exception when others then failed := sqlerrm like 'You have already answered%'; end;
  if st <> 'accepted' or not failed then raise exception 'check 10 failed'; end if;
  checks := checks + 1;

  -- 11. Not this time removes the second renter's details from the owner's view.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter2_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  talk2 := public.start_enquiry(place, 'Hello');
  perform public.share_renter_check(talk2, null, 6, 'Just me', true);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.decide_renter(talk2, false);
  select household into st from public.renter_check_for(talk2);
  if st is not null then raise exception 'check 11 failed: % still shown', st; end if;
  checks := checks + 1;

  raise exception 'DRYRUN OK: all % checks passed', checks;
end;
$$;
