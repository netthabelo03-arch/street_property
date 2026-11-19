-- Dry run for 013_rent_reviews.sql. Paste 013_rent_reviews.sql followed by this
-- file into the SQL Editor and run both together. Nothing is kept (the daily
-- reminder job set up by the script is rolled back too).
-- Success looks like:  ERROR: DRYRUN OK: all 10 checks passed

do $$
declare
  owner_id uuid := gen_random_uuid();
  renter_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  place uuid;
  talk uuid;
  deal uuid;
  start date := current_date - 40;
  due5 date;
  n int;
  st text;
  ok boolean;
  failed boolean;
  checks int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (owner_id, 'dry-rent-owner@example.test', '{"role":"owner","full_name":"Thabo Mokoena"}', 'authenticated', 'authenticated'),
         (renter_id, 'dry-rent-renter@example.test', '{"role":"renter","full_name":"Lerato Dlamini"}', 'authenticated', 'authenticated'),
         (stranger_id, 'dry-rent-stranger@example.test', '{"role":"renter"}', 'authenticated', 'authenticated');
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, deposit_rands, bedrooms)
  values (owner_id, 'owner', 'rent', 'flat', '24 Ngakane Street', 'Orlando West', 'Soweto', 6500, 6500, 2) returning id into place;
  update public.listings set status = 'live', reviewed_at = now() where id = place;
  insert into public.enquiries (listing_id, renter_id, owner_id) values (place, renter_id, owner_id) returning id into talk;
  update public.enquiries set shared_at = now(), owner_decision = 'accepted', decided_at = now() where id = talk;
  select d.id into deal from public.deals d where d.enquiry_id = talk;
  update public.deals set status = 'signed', start_date = start, lease_months = 12, rent_rands = 6500,
    safe_state = 'paid', safe_paid_at = now() where id = deal;
  update public.deals set status = 'moved_in', keys_at = now() where id = deal;
  due5 := (start + interval '4 months')::date;

  -- 1. The keys start a rent record for every month; month 1 was the Street Safe payment.
  select count(*) into n from public.rent_payments r where r.deal_id = deal;
  if n <> 12 then raise exception 'check 1 failed: % months', n; end if;
  select r.state = 'paid' and r.method = 'street_safe' into ok from public.rent_payments r where r.deal_id = deal and r.month_no = 1;
  if not ok then raise exception 'check 1 failed: month 1'; end if;
  select r.due_date = due5 and r.state = 'due' into ok from public.rent_payments r where r.deal_id = deal and r.month_no = 5;
  if not ok then raise exception 'check 1 failed: month 5'; end if;
  checks := checks + 1;

  -- 2. Only the owner marks rent received; someone else sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.mark_rent_received(deal, 2, null); exception when others then failed := sqlerrm like 'Only the owner confirms rent received%'; end;
  if not failed then raise exception 'check 2 failed: renter'; end if;
  failed := false;
  begin select r.safe_tx into st from public.rent_payments r limit 1; exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 2 failed: tx column'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.rent_payments;
  if n <> 0 then raise exception 'check 2 failed: stranger'; end if;
  checks := checks + 1;

  -- 3. The owner confirms rent received another way, once, with a note in the conversation.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.mark_rent_received(deal, 2, 'EFT to my account');
  select r.state = 'paid' and r.method = 'owner' and r.note = 'EFT to my account' into ok from public.rent_payments r where r.deal_id = deal and r.month_no = 2;
  if not ok then raise exception 'check 3 failed'; end if;
  failed := false;
  begin perform public.mark_rent_received(deal, 2, null); exception when others then failed := sqlerrm like 'This month is already paid%'; end;
  if not failed then raise exception 'check 3 failed: twice'; end if;
  execute 'reset role';
  select count(*) into n from public.messages m where m.enquiry_id = talk and m.body like 'Thabo confirmed receiving the rent for % (R6 500).';
  if n <> 1 then raise exception 'check 3 failed: note %', n; end if;
  checks := checks + 1;

  -- 4. Rent paid through Street Safe; a payment on its way cannot be marked by hand.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  st := public.safe_record_rent(deal, 3, 'waiting', 'TXR3');
  st := public.safe_record_rent(deal, 3, 'released');
  if st <> 'paid' then raise exception 'check 4 failed: %', st; end if;
  st := public.safe_record_rent(deal, 3, 'released');
  if st <> 'same' then raise exception 'check 4 failed: twice'; end if;
  st := public.safe_record_rent(deal, 4, 'waiting', 'TXR4');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.mark_rent_received(deal, 4, null); exception when others then failed := sqlerrm like 'A Street Safe payment for this month is on its way%'; end;
  if not failed then raise exception 'check 4 failed: waiting'; end if;
  execute 'reset role';
  select count(*) into n from public.messages m where m.enquiry_id = talk and m.body like 'Lerato paid the rent for % (R6 500) through Street Safe. It was passed to Thabo.';
  if n <> 1 then raise exception 'check 4 failed: note %', n; end if;
  checks := checks + 1;

  -- 5. Reminders: 3 days before, on the day, and a note at 3 days late; each once.
  n := public.send_rent_reminders(due5 - 3);
  n := public.send_rent_reminders(due5 - 3);
  select count(*) into n from public.email_outbox o where o.to_user = renter_id and o.topic_key = 'rent:' || deal || ':5:before';
  if n <> 1 then raise exception 'check 5 failed: before %', n; end if;
  n := public.send_rent_reminders(due5);
  select count(*) into n from public.email_outbox o where o.to_user = renter_id and o.topic_key = 'rent:' || deal || ':5:due';
  if n <> 1 then raise exception 'check 5 failed: due %', n; end if;
  n := public.send_rent_reminders(due5 + 3);
  n := public.send_rent_reminders(due5 + 3);
  select count(*) into n from public.messages m where m.enquiry_id = talk and m.body like 'The rent for % is 3 days late.';
  if n <> 1 then raise exception 'check 5 failed: late %', n; end if;
  checks := checks + 1;

  -- 6. Reviews: stars 1 to 5, once each.
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.review_deal(deal, 6, null); exception when others then failed := sqlerrm like 'Choose 1 to 5 stars%'; end;
  if not failed then raise exception 'check 6 failed: stars'; end if;
  st := public.review_deal(deal, 5, '  Quick to fix things, fair deposit.  ');
  if st <> 'waiting' then raise exception 'check 6 failed: %', st; end if;
  failed := false;
  begin perform public.review_deal(deal, 4, null); exception when others then failed := sqlerrm like 'You already rated this deal%'; end;
  if not failed then raise exception 'check 6 failed: twice'; end if;
  checks := checks + 1;

  -- 7. Blind until both have written: the owner cannot see it yet, nor anyone else.
  select count(*) into n from public.deal_reviews_for(deal) r where r.mine;
  if n <> 1 then raise exception 'check 7 failed: mine'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.deal_reviews_for(deal);
  if n <> 0 then raise exception 'check 7 failed: owner sees it'; end if;
  select s.reviews into n from public.rating_summary(owner_id, 'owner') s;
  if n <> 0 then raise exception 'check 7 failed: summary'; end if;
  failed := false;
  begin select count(*) into n from public.deal_reviews; exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 7 failed: table'; end if;
  checks := checks + 1;

  -- 8. Once both have written, both show, with a note.
  st := public.review_deal(deal, 4, 'Paid on time.');
  if st <> 'both' then raise exception 'check 8 failed: %', st; end if;
  select count(*) into n from public.deal_reviews_for(deal);
  if n <> 2 then raise exception 'check 8 failed: rows %', n; end if;
  select s.average = 5.0 and s.reviews = 1 into ok from public.rating_summary(owner_id, 'owner') s;
  if not ok then raise exception 'check 8 failed: owner summary'; end if;
  select s.average = 4.0 and s.reviews = 1 into ok from public.rating_summary(renter_id, 'renter') s;
  if not ok then raise exception 'check 8 failed: renter summary'; end if;
  select count(*) into n from public.reviews_about(owner_id, 'owner') r where r.author = 'Lerato' and r.words = 'Quick to fix things, fair deposit.';
  if n <> 1 then raise exception 'check 8 failed: about'; end if;
  checks := checks + 1;

  -- 9. Visitors see the summary on listings, but not the words.
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  select s.reviews into n from public.rating_summary(owner_id, 'owner') s;
  if n <> 1 then raise exception 'check 9 failed: summary'; end if;
  failed := false;
  begin perform public.reviews_about(owner_id, 'owner'); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 9 failed: words'; end if;
  checks := checks + 1;

  -- 10. The reminders run every morning.
  execute 'reset role';
  select count(*) into n from cron.job j where j.jobname = 'street-property-rent-reminders' and j.schedule = '0 5 * * *';
  if n <> 1 then raise exception 'check 10 failed'; end if;
  checks := checks + 1;

  raise exception 'DRYRUN OK: all % checks passed', checks;
end;
$$;
