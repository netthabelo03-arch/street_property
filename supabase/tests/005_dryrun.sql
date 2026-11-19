-- Dry run for 005_enquiries.sql. Paste 005_enquiries.sql followed by this file
-- into the SQL Editor and run both together. Nothing is kept.
-- Success looks like:  ERROR: DRYRUN OK: all 18 checks passed

do $$
declare
  owner_id uuid := gen_random_uuid();
  renter_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  place uuid;
  hidden uuid;
  talk uuid;
  again uuid;
  visit uuid;
  visit2 uuid;
  n int;
  txt text;
  phone text;
  st text;
  tomorrow10 timestamptz := (date_trunc('day', now() at time zone 'Africa/Johannesburg') + interval '1 day 10 hours') at time zone 'Africa/Johannesburg';
  tomorrow3 timestamptz := (date_trunc('day', now() at time zone 'Africa/Johannesburg') + interval '1 day 3 hours') at time zone 'Africa/Johannesburg';
  failed boolean;
  checks int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (owner_id, 'dry-enq-owner@example.test', '{"role":"owner","full_name":"Lerato Dlamini"}', 'authenticated', 'authenticated'),
         (renter_id, 'dry-enq-renter@example.test', '{"role":"renter","full_name":"Sipho Nkosi"}', 'authenticated', 'authenticated'),
         (stranger_id, 'dry-enq-stranger@example.test', '{"role":"renter"}', 'authenticated', 'authenticated');
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, bedrooms)
  values (owner_id, 'owner', 'rent', 'flat', '24 Ngakane Street', 'Orlando West', 'Soweto', 4500, 2) returning id into place;
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, bedrooms)
  values (owner_id, 'owner', 'rent', 'flat', '1 Draft Road', 'Dube', 'Soweto', 3000, 1) returning id into hidden;
  update public.listings set status = 'live', reviewed_at = now(), filmed_lat = -26.2385, filmed_lng = 27.9086 where id = place;

  -- 1. A visitor who is not signed in cannot start a conversation.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  failed := false;
  begin
    perform public.start_enquiry(place, 'Hi');
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'check 1 failed'; end if;
  checks := checks + 1;

  -- 2. The renter asks; asking again continues the same conversation.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  talk := public.start_enquiry(place, '  Hi, is it still available?  ');
  again := public.start_enquiry(place, 'Also, are pets allowed?');
  select count(*) into n from public.messages where enquiry_id = talk;
  if talk <> again or n <> 2 then raise exception 'check 2 failed: % % %', talk, again, n; end if;
  select body into txt from public.messages where enquiry_id = talk order by created_at limit 1;
  if txt <> 'Hi, is it still available?' then raise exception 'check 2 failed: not trimmed'; end if;
  checks := checks + 1;

  -- 3. Empty and very long messages are refused.
  failed := false;
  begin perform public.send_message(talk, '   '); exception when others then failed := sqlerrm like 'Write a message first%'; end;
  if not failed then raise exception 'check 3 failed: empty'; end if;
  failed := false;
  begin perform public.send_message(talk, repeat('a', 1001)); exception when others then failed := sqlerrm like 'Keep messages under 1000%'; end;
  if not failed then raise exception 'check 3 failed: long'; end if;
  checks := checks + 1;

  -- 4. Messages cannot be written directly.
  failed := false;
  begin
    insert into public.messages (enquiry_id, sender_id, body) values (talk, renter_id, 'sneaky');
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'check 4 failed'; end if;
  checks := checks + 1;

  -- 5. Before a viewing, the renter sees the street without the house number, and no phone.
  select street, other_whatsapp, other_name into txt, phone, st from public.enquiry_list(talk);
  if txt <> 'Ngakane Street' or phone is not null or st <> 'Lerato' then raise exception 'check 5 failed: % % %', txt, phone, st; end if;
  checks := checks + 1;

  -- 6. Asking about a listing that is not live is refused.
  failed := false;
  begin perform public.start_enquiry(hidden, 'Hi'); exception when others then failed := sqlerrm like 'This place is no longer listed%'; end;
  if not failed then raise exception 'check 6 failed'; end if;
  checks := checks + 1;

  -- 7. Viewing times: not in the middle of the night, not in the past.
  failed := false;
  begin perform public.propose_viewing(talk, tomorrow3); exception when others then failed := sqlerrm like 'Viewings are between 07:00 and 19:00%'; end;
  if not failed then raise exception 'check 7 failed: night'; end if;
  failed := false;
  begin perform public.propose_viewing(talk, now() - interval '1 day'); exception when others then failed := sqlerrm like 'Choose a time%'; end;
  if not failed then raise exception 'check 7 failed: past'; end if;
  checks := checks + 1;

  -- 8. The renter suggests tomorrow at 10:00 but cannot confirm their own suggestion.
  visit := public.propose_viewing(talk, tomorrow10);
  failed := false;
  begin perform public.respond_viewing(visit, true); exception when others then failed := sqlerrm like 'The other person needs to answer%'; end;
  if not failed then raise exception 'check 8 failed'; end if;
  checks := checks + 1;

  -- 9. Someone else cannot read or write in the conversation.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.messages where enquiry_id = talk;
  if n <> 0 then raise exception 'check 9 failed: stranger reads % messages', n; end if;
  select count(*) into n from public.enquiry_list(talk);
  if n <> 0 then raise exception 'check 9 failed: stranger lists it'; end if;
  failed := false;
  begin perform public.send_message(talk, 'hello'); exception when others then failed := sqlerrm like 'Conversation not found%'; end;
  if not failed then raise exception 'check 9 failed: stranger wrote'; end if;
  failed := false;
  begin perform public.respond_viewing(visit, true); exception when others then failed := sqlerrm like 'Conversation not found%'; end;
  if not failed then raise exception 'check 9 failed: stranger confirmed'; end if;
  checks := checks + 1;

  -- 10. The owner has unread messages; the owner sees the full street.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  n := public.unread_total();
  if n <> 3 then raise exception 'check 10 failed: % unread (2 messages and the suggestion note)', n; end if;
  select street, other_name into txt, st from public.enquiry_list(talk);
  if txt <> '24 Ngakane Street' or st <> 'Sipho' then raise exception 'check 10 failed: % %', txt, st; end if;
  checks := checks + 1;

  -- 11. Reading the conversation clears the unread count.
  perform public.mark_read(talk);
  if public.unread_total() <> 0 then raise exception 'check 11 failed'; end if;
  checks := checks + 1;

  -- 12. A badly formed phone number is refused; a good one is kept.
  failed := false;
  begin update public.profiles set phone = '0821234567' where id = owner_id; exception when check_violation then failed := true; end;
  if not failed then raise exception 'check 12 failed'; end if;
  update public.profiles set phone = '+27821234567', share_whatsapp = true where id = owner_id;
  checks := checks + 1;

  -- 13. The owner confirms; a note is added to the conversation.
  st := public.respond_viewing(visit, true);
  select count(*) into n from public.messages where enquiry_id = talk and kind = 'system' and body like 'Viewing confirmed for %';
  if st <> 'confirmed' or n <> 1 then raise exception 'check 13 failed: % %', st, n; end if;
  checks := checks + 1;

  -- 14. Now the renter sees the full street and the owner's WhatsApp number (only when opening the conversation).
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select street, other_whatsapp into txt, phone from public.enquiry_list(talk);
  if txt <> '24 Ngakane Street' or phone <> '+27821234567' then raise exception 'check 14 failed: % %', txt, phone; end if;
  select other_whatsapp into phone from public.enquiry_list() where id = talk;
  if phone is not null then raise exception 'check 14 failed: number in the list'; end if;
  checks := checks + 1;

  -- 15. The renter did not share a number, so the owner gets none.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select other_whatsapp into phone from public.enquiry_list(talk);
  if phone is not null then raise exception 'check 15 failed'; end if;
  checks := checks + 1;

  -- 16. A new suggestion replaces the confirmed viewing; only one is active.
  visit2 := public.propose_viewing(talk, tomorrow10 + interval '1 day');
  select count(*) into n from public.viewings where enquiry_id = talk and status in ('proposed', 'confirmed');
  select status into st from public.viewings where id = visit;
  if n <> 1 or st <> 'cancelled' then raise exception 'check 16 failed: % %', n, st; end if;
  checks := checks + 1;

  -- 17. Cancelling; the renter loses the full street again.
  perform public.cancel_viewing(visit2);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select street into txt from public.enquiry_list(talk);
  if txt <> 'Ngakane Street' then raise exception 'check 17 failed: %', txt; end if;
  checks := checks + 1;

  -- 18. Reports need a reason, and only admins can read them.
  failed := false;
  begin perform public.report_enquiry(talk, 'bad'); exception when others then failed := sqlerrm like 'Say in a few words%'; end;
  if not failed then raise exception 'check 18 failed: short reason'; end if;
  perform public.report_enquiry(talk, 'Asked me to pay a deposit before the viewing');
  select count(*) into n from public.enquiry_reports;
  if n <> 0 then raise exception 'check 18 failed: renter reads reports'; end if;
  checks := checks + 1;

  raise exception 'DRYRUN OK: all % checks passed', checks;
end;
$$;
