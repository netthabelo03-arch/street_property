-- Dry run for 012_deposit_plans.sql. Paste 012_deposit_plans.sql followed by
-- this file into the SQL Editor and run both together. Nothing is kept.
-- Success looks like:  ERROR: DRYRUN OK: all 8 checks passed

do $$
declare
  owner_id uuid := gen_random_uuid();
  renter_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  place uuid;
  talk uuid;
  deal uuid;
  start date := current_date + 10;
  v_text text;
  n int;
  total int;
  st text;
  ok boolean;
  failed boolean;
  checks int := 0;
begin
  -- 1. The plan: equal parts, the first takes what is left over, a month apart.
  select array_agg(p.amount_rands order by p.part) = array[2168, 2166, 2166]
     and array_agg(p.due_date order by p.part) = array[date '2027-01-01', date '2027-02-01', date '2027-03-01']
    into ok from public.deposit_plan(6500, 3, date '2027-01-01') p;
  if not ok then raise exception 'check 1 failed: three parts'; end if;
  select count(*) = 1 and sum(p.amount_rands) = 6500 into ok from public.deposit_plan(6500, 1, date '2027-01-01') p;
  if not ok then raise exception 'check 1 failed: one part'; end if;
  checks := checks + 1;

  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (owner_id, 'dry-plan-owner@example.test', '{"role":"owner","full_name":"Thabo Mokoena"}', 'authenticated', 'authenticated'),
         (renter_id, 'dry-plan-renter@example.test', '{"role":"renter","full_name":"Lerato Dlamini"}', 'authenticated', 'authenticated'),
         (stranger_id, 'dry-plan-stranger@example.test', '{"role":"renter"}', 'authenticated', 'authenticated');
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, deposit_rands, bedrooms)
  values (owner_id, 'owner', 'rent', 'flat', '24 Ngakane Street', 'Orlando West', 'Soweto', 6500, 6500, 2) returning id into place;
  update public.listings set status = 'live', reviewed_at = now() where id = place;
  insert into public.enquiries (listing_id, renter_id, owner_id) values (place, renter_id, owner_id) returning id into talk;
  update public.enquiries set shared_at = now(), owner_decision = 'accepted', decided_at = now() where id = talk;
  select d.id into deal from public.deals d where d.enquiry_id = talk;

  -- 2. Bad plans are refused.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.send_lease(deal, 6500, 6500, start, 12, null, 4); exception when others then failed := sqlerrm like 'Choose 1, 2 or 3 deposit parts%'; end;
  if not failed then raise exception 'check 2 failed: four'; end if;
  failed := false;
  begin perform public.send_lease(deal, 6500, 500, start, 12, null, 2); exception when others then failed := sqlerrm like 'A deposit paid in parts must be at least R300 a part%'; end;
  if not failed then raise exception 'check 2 failed: small'; end if;
  checks := checks + 1;

  -- 3. The lease carries the plan.
  perform public.send_lease(deal, 6500, 6500, start, 12, null, 3);
  select v.lease_text into v_text from public.deal_view(deal) v;
  if v_text not like '%The deposit is R6 500. It is paid in 3 parts: R2 168 before moving in, R2 166 with the rent on '
       || public.long_date((start + interval '1 month')::date) || ' and R2 166 with the rent on '
       || public.long_date((start + interval '2 months')::date) || '. It is kept in an interest-bearing account%' then
    raise exception 'check 3 failed: %', substring(v_text from 'The deposit[^\n]*');
  end if;
  checks := checks + 1;

  -- 4. The later parts are listed, and the move-in payment carries only the first part.
  select count(*), sum(x.amount_rands) into n, total from public.deposit_payments x where x.deal_id = deal;
  if n <> 2 or total <> 4332 then raise exception 'check 4 failed: % %', n, total; end if;
  select v.deposit_parts = 3 and v.first_deposit_rands = 2168 into ok from public.deal_view(deal) v;
  if not ok then raise exception 'check 4 failed: view'; end if;
  checks := checks + 1;

  -- 5. Only the Edge Function records payments.
  failed := false;
  begin perform public.safe_record_part(deal, 2, 'released'); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 5 failed'; end if;
  checks := checks + 1;

  -- 6. A paid part is noted once.
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  st := public.safe_record_part(deal, 2, 'waiting', 'TXP2');
  st := public.safe_record_part(deal, 2, 'released');
  if st <> 'released' then raise exception 'check 6 failed: %', st; end if;
  st := public.safe_record_part(deal, 2, 'released');
  if st <> 'same' then raise exception 'check 6 failed: twice'; end if;
  execute 'reset role';
  select count(*) into n from public.messages m where m.enquiry_id = talk and m.body = 'Lerato paid deposit part 2 of 3 (R2 166) through Street Safe. It was passed to Thabo.';
  if n <> 1 then raise exception 'check 6 failed: notes %', n; end if;
  checks := checks + 1;

  -- 7. The renter sees the plan but not TradeSafe's reference.
  perform set_config('request.jwt.claims', json_build_object('sub', renter_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.deposit_payments x where x.safe_state = 'released' and x.paid_at is not null;
  if n <> 1 then raise exception 'check 7 failed: rows'; end if;
  failed := false;
  begin select x.safe_tx into st from public.deposit_payments x limit 1; exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 7 failed: tx'; end if;
  checks := checks + 1;

  -- 8. Someone else sees nothing.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.deposit_payments;
  if n <> 0 then raise exception 'check 8 failed'; end if;
  checks := checks + 1;

  execute 'reset role';
  raise exception 'DRYRUN OK: all % checks passed', checks;
end;
$$;
