-- Dry run for 011_street_safe.sql. Paste 011_street_safe.sql followed by this
-- file into the SQL Editor and run both together. Nothing is kept.
-- Success looks like:  ERROR: DRYRUN OK: all 8 checks passed

do $$
declare
  owner_id uuid := gen_random_uuid();
  renter_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  place uuid;
  talk uuid;
  deal uuid;
  n int;
  st text;
  ok boolean;
  failed boolean;
  checks int := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (owner_id, 'dry-safe-owner@example.test', '{"role":"owner","full_name":"Thabo Mokoena"}', 'authenticated', 'authenticated'),
         (renter_id, 'dry-safe-renter@example.test', '{"role":"renter","full_name":"Lerato Dlamini"}', 'authenticated', 'authenticated'),
         (stranger_id, 'dry-safe-stranger@example.test', '{"role":"renter"}', 'authenticated', 'authenticated');
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, deposit_rands, bedrooms)
  values (owner_id, 'owner', 'rent', 'flat', '24 Ngakane Street', 'Orlando West', 'Soweto', 6500, 6500, 2) returning id into place;
  update public.listings set status = 'live', reviewed_at = now() where id = place;
  insert into public.enquiries (listing_id, renter_id, owner_id) values (place, renter_id, owner_id) returning id into talk;
  update public.enquiries set shared_at = now(), owner_decision = 'accepted', decided_at = now() where id = talk;
  select d.id into deal from public.deals d where d.enquiry_id = talk;
  insert into public.safe_accounts (user_id, token, bank, account_last4, account_type, can_receive)
  values (owner_id, 'tok-owner-secret', 'CAPITEC', '4417', 'SAVINGS', true),
         (renter_id, 'tok-renter-secret', null, null, null, false);

  -- 1. Signed-in people cannot record payments.
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.safe_record(deal, 'paid'); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 1 failed'; end if;
  checks := checks + 1;

  -- 2. Nobody reads a TradeSafe token, or writes their own account.
  failed := false;
  begin select a.token into st from public.safe_accounts a; exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 2 failed: token'; end if;
  failed := false;
  begin update public.safe_accounts set can_receive = true where user_id = renter_id; exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 2 failed: write'; end if;
  checks := checks + 1;

  -- 3. People see only their own account (bank and last 4 digits).
  select count(*) into n from public.safe_accounts;
  if n <> 1 then raise exception 'check 3 failed: % rows', n; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.safe_accounts a where a.account_last4 = '4417' and a.can_receive;
  if n <> 1 then raise exception 'check 3 failed: owner'; end if;
  checks := checks + 1;

  -- 4. The deal shows that the owner can be paid, and nothing paid yet.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select v.owner_can_receive and v.safe_state = 'none' into ok from public.deal_view(deal) v;
  if not ok then raise exception 'check 4 failed'; end if;
  checks := checks + 1;

  -- 5. The Edge Function records the payment, with a note once.
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  st := public.safe_record(deal, 'waiting', 'TX123', 6500, 6500, array['A1', 'A2']);
  st := public.safe_record(deal, 'paid');
  if st <> 'paid' then raise exception 'check 5 failed: %', st; end if;
  st := public.safe_record(deal, 'paid');
  if st <> 'same' then raise exception 'check 5 failed: twice %', st; end if;
  execute 'reset role';
  select count(*) into n from public.messages m where m.enquiry_id = talk and m.body = 'Lerato paid R13 000 into Street Safe. It is held until the keys are handed over.';
  if n <> 1 then raise exception 'check 5 failed: notes %', n; end if;
  checks := checks + 1;

  -- 6. Unknown states are refused.
  execute 'set local role service_role';
  failed := false;
  begin perform public.safe_record(deal, 'lost'); exception when others then failed := sqlerrm like 'Unknown payment state%'; end;
  if not failed then raise exception 'check 6 failed'; end if;
  checks := checks + 1;

  -- 7. Released: the date is kept, and both see it.
  st := public.safe_record(deal, 'released');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select v.safe_state = 'released' and v.safe_paid_at is not null and v.safe_released_at is not null and v.safe_rent_rands = 6500 into ok from public.deal_view(deal) v;
  if not ok then raise exception 'check 7 failed'; end if;
  checks := checks + 1;

  -- 8. Someone else sees nothing.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.deal_view(deal);
  if n <> 0 then raise exception 'check 8 failed'; end if;
  checks := checks + 1;

  execute 'reset role';
  raise exception 'DRYRUN OK: all % checks passed', checks;
end;
$$;
