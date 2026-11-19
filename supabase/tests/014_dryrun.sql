-- Dry run for 014_promote.sql. Paste 014_promote.sql followed by this file into
-- the SQL Editor and run both together. Nothing is kept.
-- Success looks like:  ERROR: DRYRUN OK: all 8 checks passed

do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  a uuid;
  b uuid;
  draft uuid;
  boost1 public.listing_boosts;
  boost2 public.listing_boosts;
  boost3 public.listing_boosts;
  until1 timestamptz;
  st text;
  n int;
  ok boolean;
  failed boolean;
  first_id uuid;
  checks int := 0;
begin
  -- 1. The price list.
  select array_agg(p.amount_rands || '/' || p.days) = array['49/7'] into ok from public.boost_price('week') p;
  if not ok then raise exception 'check 1 failed: week'; end if;
  select p.amount_rands = 179 and p.days = 30 into ok from public.boost_price('month') p;
  if not ok then raise exception 'check 1 failed: month'; end if;
  select count(*) into n from public.boost_price('year');
  if n <> 0 then raise exception 'check 1 failed: unknown'; end if;
  checks := checks + 1;

  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (owner_id, 'dry-boost-owner@example.test', '{"role":"owner","full_name":"Thabo Mokoena"}', 'authenticated', 'authenticated'),
         (other_id, 'dry-boost-other@example.test', '{"role":"owner","full_name":"Sipho Nkosi"}', 'authenticated', 'authenticated');
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, deposit_rands, bedrooms)
  values (owner_id, 'owner', 'rent', 'flat', '1 Dry Street', 'Dryrun Park', 'Dryrunville', 6500, 6500, 2) returning id into a;
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, deposit_rands, bedrooms)
  values (other_id, 'owner', 'rent', 'flat', '2 Dry Street', 'Dryrun Park', 'Dryrunville', 5500, 5500, 1) returning id into b;
  insert into public.listings (owner_id, lister, mode, kind, street, area, city, price_rands, deposit_rands, bedrooms)
  values (owner_id, 'owner', 'rent', 'flat', '3 Dry Street', 'Dryrun Park', 'Dryrunville', 4500, 4500, 1) returning id into draft;
  update public.listings set status = 'live', reviewed_at = now() - interval '2 days' where id = a;
  update public.listings set status = 'live', reviewed_at = now() where id = b;

  -- 2. Signed-in people cannot open or pay boosts themselves.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.boost_create(owner_id, a, 'week'); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 2 failed: create'; end if;
  failed := false;
  begin perform public.boost_paid(gen_random_uuid(), 4900); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'check 2 failed: paid'; end if;
  execute 'reset role';
  checks := checks + 1;

  -- 3. Only the owner's live listings, and only a known boost.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  failed := false;
  begin perform public.boost_create(other_id, a, 'week'); exception when others then failed := sqlerrm like 'Listing not found%'; end;
  if not failed then raise exception 'check 3 failed: not owner'; end if;
  failed := false;
  begin perform public.boost_create(owner_id, draft, 'week'); exception when others then failed := sqlerrm like 'Only a live listing can be promoted%'; end;
  if not failed then raise exception 'check 3 failed: draft'; end if;
  failed := false;
  begin perform public.boost_create(owner_id, a, 'year'); exception when others then failed := sqlerrm like 'Choose a boost%'; end;
  if not failed then raise exception 'check 3 failed: tier'; end if;
  checks := checks + 1;

  -- 4. Paid with the right amount, once.
  boost1 := public.boost_create(owner_id, a, 'week');
  failed := false;
  begin perform public.boost_paid(boost1.id, 100); exception when others then failed := sqlerrm like 'Paid amount does not match%'; end;
  if not failed then raise exception 'check 4 failed: amount'; end if;
  st := public.boost_paid(boost1.id, 4900);
  if st <> 'paid' then raise exception 'check 4 failed: %', st; end if;
  st := public.boost_paid(boost1.id, 4900);
  if st <> 'same' then raise exception 'check 4 failed: twice'; end if;
  select l.boost_until, l.boost_until between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute' and l.boost_tier = 'week'
    into until1, ok from public.listings l where l.id = a;
  if not ok then raise exception 'check 4 failed: listing'; end if;
  checks := checks + 1;

  -- 5. A second boost starts when the first ends, and the higher tier counts.
  boost2 := public.boost_create(owner_id, a, 'month');
  st := public.boost_paid(boost2.id, 17900);
  select x.starts_at = until1 and x.ends_at = until1 + interval '30 days' into ok from public.listing_boosts x where x.id = boost2.id;
  if not ok then raise exception 'check 5 failed: stacking'; end if;
  select l.boost_tier = 'month' and l.boost_until = until1 + interval '30 days' into ok from public.listings l where l.id = a;
  if not ok then raise exception 'check 5 failed: listing'; end if;
  checks := checks + 1;

  -- 6. Unpaid boosts can fail; paid ones stay paid.
  boost3 := public.boost_create(owner_id, a, 'fortnight');
  perform public.boost_failed(boost3.id);
  perform public.boost_failed(boost1.id);
  select count(*) into n from public.listing_boosts x where x.id in (boost1.id, boost3.id) and x.state = (case when x.id = boost1.id then 'paid' else 'failed' end);
  if n <> 2 then raise exception 'check 6 failed'; end if;
  execute 'reset role';
  checks := checks + 1;

  -- 7. Search shows the boosted listing first, featured, even though the other is newer.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  select s.id into first_id from public.search_listings('rent', 'dryrunville') s limit 1;
  if first_id <> a then raise exception 'check 7 failed: order'; end if;
  select bool_and(case when s.id = a then s.boosted and s.featured else not s.boosted and not s.featured end) into ok
    from public.search_listings('rent', 'dryrunville') s;
  if not ok then raise exception 'check 7 failed: flags'; end if;
  select count(*) into n from public.listings l where l.id = a and l.boost_tier = 'month';
  if n <> 1 then raise exception 'check 7 failed: public column'; end if;
  execute 'reset role';
  checks := checks + 1;

  -- 8. Owners see their own boosts only.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.listing_boosts;
  if n <> 3 then raise exception 'check 8 failed: owner %', n; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.listing_boosts;
  if n <> 0 then raise exception 'check 8 failed: other'; end if;
  execute 'reset role';
  checks := checks + 1;

  raise exception 'DRYRUN OK: all % checks passed', checks;
end;
$$;
