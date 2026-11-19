-- Dry run for 009_reports_email.sql. Paste 009_reports_email.sql followed by
-- this file into the SQL Editor and run both together. Nothing is kept (no
-- emails are sent: the wake-up call is cancelled with everything else).
-- Success looks like:  ERROR: DRYRUN OK: all 9 checks passed

do $$
declare
  owner_id uuid := gen_random_uuid();
  renter_id uuid := gen_random_uuid();
  quiet_id uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  place uuid;
  talk uuid;
  talk2 uuid;
  rep uuid;
  n int;
  st text;
  failed boolean;
  checks int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (owner_id, 'dry-em-owner@example.test', '{"role":"owner","full_name":"Thabo Mokoena"}', 'authenticated', 'authenticated'),
         (renter_id, 'dry-em-renter@example.test', '{"role":"renter","full_name":"Lerato Dlamini"}', 'authenticated', 'authenticated'),
         (quiet_id, 'dry-em-quiet@example.test', '{"role":"renter","full_name":"Quiet Person"}', 'authenticated', 'authenticated'),
         (admin_id, 'dry-em-admin@example.test', '{"role":"renter"}', 'authenticated', 'authenticated');
  insert into public.admins (user_id) values (admin_id);
  update public.profiles set email_notifications = false where id = quiet_id;
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, bedrooms)
  values (owner_id, 'owner', 'rent', 'flat', '24 Ngakane Street', 'Orlando West', 'Soweto', 4500, 2) returning id into place;
  update public.listings set status = 'live', reviewed_at = now() where id = place;

  -- 1. A renter's message emails the owner, once per 15 minutes per conversation.
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  talk := public.start_enquiry(place, 'Hi, is it still available?');
  perform public.send_message(talk, 'Also, are pets allowed?');
  execute 'reset role';
  select count(*) into n from public.email_outbox where to_user = owner_id and topic = 'message';
  if n <> 1 then raise exception 'check 1 failed: % emails', n; end if;
  select subject into st from public.email_outbox where to_user = owner_id and topic = 'message';
  if st <> 'Lerato wrote about Ngakane Street, Orlando West' then raise exception 'check 1 failed: %', st; end if;
  checks := checks + 1;

  -- 2. A viewing suggested by the renter emails the owner, not the renter.
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.propose_viewing(talk, (date_trunc('day', now() at time zone 'Africa/Johannesburg') + interval '1 day 10 hours') at time zone 'Africa/Johannesburg');
  execute 'reset role';
  select count(*) into n from public.email_outbox where to_user = owner_id and topic = 'note';
  if n <> 1 then raise exception 'check 2 failed: owner got %', n; end if;
  select count(*) into n from public.email_outbox where to_user = renter_id;
  if n <> 0 then raise exception 'check 2 failed: renter got %', n; end if;
  checks := checks + 1;

  -- 3. Someone who turned emails off gets none.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', quiet_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  talk2 := public.start_enquiry(place, 'Hello');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.send_message(talk2, 'Hi, yes it is.');
  execute 'reset role';
  select count(*) into n from public.email_outbox where to_user = quiet_id;
  if n <> 0 then raise exception 'check 3 failed'; end if;
  checks := checks + 1;

  -- 4. Nobody using the app can read the outbox.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin select count(*) into n from public.email_outbox; exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 4 failed'; end if;
  checks := checks + 1;

  -- 5. Only admins see reports.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.report_enquiry(talk, 'Asked me to pay a deposit before the viewing');
  failed := false;
  begin perform * from public.report_list(); exception when others then failed := sqlerrm like 'Only admins%'; end;
  if not failed then raise exception 'check 5 failed'; end if;
  checks := checks + 1;

  -- 6. The admin sees the open report and the conversation's messages.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select r.id, r.reporter_side into rep, st from public.report_list() r;
  if rep is null or st <> 'renter' then raise exception 'check 6 failed: %', st; end if;
  select count(*) into n from public.report_messages(rep);
  if n < 3 then raise exception 'check 6 failed: % messages', n; end if;
  checks := checks + 1;

  -- 7. Closing a report needs a note; it can take the listing down, which emails the owner.
  failed := false;
  begin perform public.resolve_report(rep, ''); exception when others then failed := sqlerrm like 'Write down what was done%'; end;
  if not failed then raise exception 'check 7 failed: note'; end if;
  perform public.resolve_report(rep, 'Owner asked for money before a viewing.', true);
  execute 'reset role';
  select status into st from public.listings where id = place;
  if st <> 'taken_down' then raise exception 'check 7 failed: %', st; end if;
  select count(*) into n from public.email_outbox where to_user = owner_id and subject = 'Your listing was taken down';
  if n <> 1 then raise exception 'check 7 failed: email'; end if;
  checks := checks + 1;

  -- 8. A closed report leaves the list, and its messages are no longer shown.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.report_list();
  if n <> 0 then raise exception 'check 8 failed: still listed'; end if;
  select count(*) into n from public.report_messages(rep);
  if n <> 0 then raise exception 'check 8 failed: messages'; end if;
  checks := checks + 1;

  -- 9. A decided check emails the person.
  execute 'reset role';
  insert into public.identity_checks (user_id, status, id_path, selfie_path) values (renter_id, 'pending', renter_id || '/identity/a.jpg', renter_id || '/identity/b.jpg');
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.decide_check('identity', renter_id, true);
  execute 'reset role';
  select count(*) into n from public.email_outbox where to_user = renter_id and subject = 'Your ID check is done';
  if n <> 1 then raise exception 'check 9 failed'; end if;
  checks := checks + 1;

  raise exception 'DRYRUN OK: all % checks passed', checks;
end;
$$;
