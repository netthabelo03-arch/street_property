-- Sprint 9 (rest): deposit plans. The owner can let the renter pay the deposit
-- in 2 or 3 parts: the first part with the first month's rent before moving in
-- (held by Street Safe until the keys), the rest with the rent in the next
-- months, each paid through Street Safe and passed straight to the owner.
-- The plan is written into the lease.
--
-- Run this once in the Supabase dashboard (SQL Editor) after 011_street_safe.sql.
-- Safe to run again.

alter table public.deals add column if not exists deposit_parts smallint not null default 1;
alter table public.deals drop constraint if exists deals_deposit_parts_check;
alter table public.deals add constraint deals_deposit_parts_check check (deposit_parts between 1 and 3);

-- The parts after the first. The first part rides on the move-in payment.
create table if not exists public.deposit_payments (
  deal_id uuid not null references public.deals (id) on delete cascade,
  part smallint not null check (part between 2 and 3),
  amount_rands integer not null check (amount_rands > 0),
  due_date date not null,
  safe_tx text unique,
  safe_state text not null default 'none' check (safe_state in ('none', 'waiting', 'paid', 'released', 'refunded')),
  paid_at timestamptz,
  primary key (deal_id, part)
);
alter table public.deposit_payments enable row level security;
drop policy if exists "The two people read the deposit plan" on public.deposit_payments;
create policy "The two people read the deposit plan" on public.deposit_payments for select to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id and ((select auth.uid()) in (d.owner_id, d.renter_id) or (select public.is_admin()))));
revoke all on public.deposit_payments from anon, authenticated;
grant select (deal_id, part, amount_rands, due_date, safe_state, paid_at) on public.deposit_payments to authenticated;

-- The plan: equal parts in whole rands, the first part takes what is left over.
-- Part 1 is due before moving in (the start date); part n with the rent n-1 months later.
create or replace function public.deposit_plan(p_deposit integer, p_parts integer, p_start date)
returns table (part integer, amount_rands integer, due_date date)
language sql
immutable
set search_path = ''
as $$
  select n,
    case when n = 1 then coalesce(p_deposit, 0) - (coalesce(p_deposit, 0) / greatest(p_parts, 1)) * (greatest(p_parts, 1) - 1)
         else coalesce(p_deposit, 0) / greatest(p_parts, 1) end,
    (p_start + make_interval(months => n - 1))::date
  from generate_series(1, greatest(coalesce(p_parts, 1), 1)) n;
$$;

-- " It is paid in 3 parts: R2 168 before moving in, R2 166 on 1 January 2027 and R2 166 on 1 February 2027."
create or replace function public.deposit_plan_words(p_deal uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.deals;
  words text[];
begin
  select * into d from public.deals x where x.id = p_deal;
  if coalesce(d.deposit_parts, 1) < 2 or coalesce(d.deposit_rands, 0) = 0 then return ''; end if;
  select array_agg(case when p.part = 1 then public.rands(p.amount_rands) || ' before moving in'
                        else public.rands(p.amount_rands) || ' with the rent on ' || public.long_date(p.due_date) end order by p.part)
    into words from public.deposit_plan(d.deposit_rands, d.deposit_parts, d.start_date) p;
  return ' It is paid in ' || d.deposit_parts || ' parts: ' ||
    array_to_string(words[1:array_length(words, 1) - 1], ', ') || ' and ' || words[array_length(words, 1)] || '.';
end;
$$;
revoke all on function public.deposit_plan_words(uuid) from public, anon, authenticated;

-- The lease now carries the plan (clause 5).
create or replace function public.lease_text_for(p_deal uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.deals;
  place public.listings;
  owner_name text;
  renter_name text;
  end_date date;
begin
  select * into d from public.deals x where x.id = p_deal;
  select * into place from public.listings l where l.id = d.listing_id;
  select coalesce(nullif(btrim(p.full_name), ''), 'The Landlord') into owner_name from public.profiles p where p.id = d.owner_id;
  select coalesce(nullif(btrim(p.full_name), ''), 'The Tenant') into renter_name from public.profiles p where p.id = d.renter_id;
  end_date := (d.start_date + make_interval(months => d.lease_months))::date - 1;
  return concat_ws(chr(10),
    'RESIDENTIAL LEASE AGREEMENT',
    '(Street Property draft template, to be reviewed by a lawyer before use.)',
    '',
    '1. The parties',
    'Landlord: ' || owner_name || (case when place.lister = 'agent' then ', acting as agent for the owner under a written mandate' else '' end) || '.',
    'Tenant: ' || renter_name || '.',
    '',
    '2. The property',
    place.street || ', ' || place.area || ', ' || place.city || '.',
    '',
    '3. The lease period',
    'From ' || public.long_date(d.start_date) || ' to ' || public.long_date(end_date) || ' (' || d.lease_months || ' months).',
    '',
    '4. Rent',
    'The rent is ' || public.rands(d.rent_rands) || ' a month, paid in advance on or before the 1st day of each month. The landlord gives the tenant a written receipt for every payment.',
    '',
    '5. Deposit',
    (case when coalesce(d.deposit_rands, 0) > 0
      then 'The deposit is ' || public.rands(d.deposit_rands) || '.' || public.deposit_plan_words(p_deal) || ' It is kept in an interest-bearing account, and the interest belongs to the tenant. At the end of the lease, the landlord may use the deposit only for unpaid rent and for damage found at the joint move-out inspection, beyond fair wear and tear, and refunds the rest with interest within 14 days of the tenant moving out (21 days if repairs are needed).'
      else 'No deposit is payable.' end),
    '',
    '6. Inspections',
    'Landlord and tenant inspect the property together before the tenant moves in, and again in the 3 days before the tenant moves out. Both inspections are recorded room by room with photos in the Street Property app and signed by both.',
    '',
    '7. Looking after the property',
    'The tenant keeps the property clean and in the condition it was in at the start, apart from fair wear and tear, and reports damage quickly. The landlord keeps the property fit to live in and repairs what is not caused by the tenant.',
    '',
    '8. Electricity and water',
    (case when 'prepaid' = any (place.features) then 'Electricity is prepaid and bought by the tenant. ' else '' end) || 'Water and other services are paid as the parties agree in writing.',
    '',
    '9. Pets',
    (case when 'pets' = any (place.features) then 'Pets are allowed, with the landlord''s agreement on how many and which.' else 'No pets without the landlord''s written agreement.' end),
    '',
    '10. Ending the lease',
    'The tenant may end the lease early by giving 20 business days'' written notice, as the Consumer Protection Act allows; the landlord may charge a reasonable cancellation penalty. A party in breach must be given 20 business days'' written notice to put it right before the lease can be cancelled.',
    '',
    '11. Special terms',
    coalesce(nullif(btrim(d.special_terms), ''), 'None.'),
    '',
    '12. Signing',
    'The parties sign this lease electronically in the Street Property app. Each signature records the full name typed, the date and time, and a fingerprint of this exact text, so both parties have signed the same lease.'
  );
end;
$$;
revoke all on function public.lease_text_for(uuid) from public, anon, authenticated;

-- send_lease takes the number of deposit parts.
drop function if exists public.send_lease(uuid, integer, integer, date, integer, text);
create or replace function public.send_lease(p_deal uuid, p_rent integer, p_deposit integer, p_start date, p_months integer, p_special text, p_parts integer default 1)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deals := public.my_deal(p_deal);
  body text;
begin
  if d.owner_id <> auth.uid() then
    raise exception 'Only the owner sends the lease' using errcode = 'P0001', hint = 'not_the_owner';
  end if;
  if d.status <> 'agreeing' then
    raise exception 'The lease was already sent' using errcode = 'P0001', hint = 'lease_sent';
  end if;
  if p_rent is null or p_rent < 300 or p_rent > 500000 then
    raise exception 'Enter the monthly rent' using errcode = 'P0001', hint = 'lease_rent';
  end if;
  if p_deposit is not null and (p_deposit < 0 or p_deposit > 10000000) then
    raise exception 'Check the deposit' using errcode = 'P0001', hint = 'lease_deposit';
  end if;
  if p_start is null or p_start < current_date or p_start > current_date + 365 then
    raise exception 'Choose a start date in the next 12 months' using errcode = 'P0001', hint = 'lease_start';
  end if;
  if p_months is null or p_months not in (6, 12, 24, 36) then
    raise exception 'Choose 6, 12, 24 or 36 months' using errcode = 'P0001', hint = 'lease_months';
  end if;
  if p_parts is null or p_parts not in (1, 2, 3) then
    raise exception 'Choose 1, 2 or 3 deposit parts' using errcode = 'P0001', hint = 'deposit_parts';
  end if;
  if p_parts > 1 and coalesce(p_deposit, 0) < 300 * p_parts then
    raise exception 'A deposit paid in parts must be at least R300 a part' using errcode = 'P0001', hint = 'deposit_parts_small';
  end if;
  if p_parts > p_months then
    raise exception 'The lease is shorter than the deposit plan' using errcode = 'P0001', hint = 'deposit_parts';
  end if;
  if char_length(coalesce(p_special, '')) > 1000 then
    raise exception 'Keep special terms under 1000 characters' using errcode = 'P0001', hint = 'lease_special';
  end if;
  update public.deals set rent_rands = p_rent, deposit_rands = p_deposit, start_date = p_start,
    lease_months = p_months, special_terms = nullif(btrim(coalesce(p_special, '')), ''), deposit_parts = p_parts
  where id = d.id;
  delete from public.deposit_payments x where x.deal_id = d.id;
  insert into public.deposit_payments (deal_id, part, amount_rands, due_date)
  select d.id, p.part, p.amount_rands, p.due_date from public.deposit_plan(p_deposit, p_parts, p_start) p where p.part > 1;
  body := public.lease_text_for(d.id);
  update public.deals set lease_text = body, lease_hash = encode(sha256(convert_to(body, 'UTF8')), 'hex'),
    sent_at = now(), status = 'signing'
  where id = d.id;
  perform public.add_note(d.enquiry_id, 'The lease is ready to sign.');
end;
$$;
revoke all on function public.send_lease(uuid, integer, integer, date, integer, text, integer) from public, anon;
grant execute on function public.send_lease(uuid, integer, integer, date, integer, text, integer) to authenticated;

-- The Edge Function records each later part. Paid parts go straight to the owner.
create or replace function public.safe_record_part(p_deal uuid, p_part integer, p_state text, p_tx text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deals;
  row_before public.deposit_payments;
begin
  if p_state not in ('none', 'waiting', 'paid', 'released', 'refunded') then
    raise exception 'Unknown payment state %', p_state using errcode = 'P0001', hint = 'bad_safe_state';
  end if;
  select * into d from public.deals x where x.id = p_deal;
  select * into row_before from public.deposit_payments x where x.deal_id = p_deal and x.part = p_part for update;
  if row_before.deal_id is null then
    raise exception 'No such deposit part' using errcode = 'P0001', hint = 'deposit_part_missing';
  end if;
  update public.deposit_payments set safe_tx = coalesce(p_tx, safe_tx), safe_state = p_state,
    paid_at = case when p_state in ('paid', 'released') then coalesce(paid_at, now()) else paid_at end
  where deal_id = p_deal and part = p_part;
  if p_state = row_before.safe_state then return 'same'; end if;
  if p_state = 'released' then
    perform public.add_note(d.enquiry_id, public.first_name_of(d.renter_id, 'The renter') || ' paid deposit part ' || p_part || ' of ' || d.deposit_parts
      || ' (' || public.rands(row_before.amount_rands) || ') through Street Safe. It was passed to ' || public.first_name_of(d.owner_id, 'the owner') || '.');
  end if;
  return p_state;
end;
$$;
revoke all on function public.safe_record_part(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.safe_record_part(uuid, integer, text, text) to service_role;

-- deal_view, now with the deposit plan.
drop function if exists public.deal_view(uuid);
create function public.deal_view(p_deal uuid)
returns table (
  id uuid, enquiry_id uuid, listing_id uuid, my_side text, status text, rooms text[],
  rent_rands integer, deposit_rands integer, start_date date, lease_months smallint, special_terms text,
  lease_text text, lease_hash text, sent_at timestamptz,
  owner_signed_at timestamptz, owner_signed_name text, renter_signed_at timestamptz, renter_signed_name text,
  owner_checked_at timestamptz, renter_checked_at timestamptz, keys_at timestamptz,
  listing_kind text, listing_bedrooms smallint, listing_bathrooms smallint, street text, area text, city text,
  listing_verified boolean, met_both boolean, other_name text,
  safe_state text, safe_rent_rands integer, safe_deposit_rands integer,
  safe_paid_at timestamptz, safe_released_at timestamptz, safe_refunded_at timestamptz,
  owner_can_receive boolean, deposit_parts smallint, first_deposit_rands integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.enquiry_id, d.listing_id, case when d.owner_id = auth.uid() then 'owner' else 'renter' end, d.status, d.rooms,
    d.rent_rands, d.deposit_rands, d.start_date, d.lease_months, d.special_terms,
    d.lease_text, d.lease_hash, d.sent_at,
    d.owner_signed_at, d.owner_signed_name, d.renter_signed_at, d.renter_signed_name,
    d.owner_checked_at, d.renter_checked_at, d.keys_at,
    l.kind, l.bedrooms, l.bathrooms, l.street, l.area, l.city,
    l.verified_at is not null,
    exists (select 1 from public.viewings v where v.enquiry_id = d.enquiry_id and v.met_renter_at is not null and v.met_owner_at is not null),
    public.first_name_of(case when d.owner_id = auth.uid() then d.renter_id else d.owner_id end, case when d.owner_id = auth.uid() then 'The renter' else 'The owner' end),
    d.safe_state, d.safe_rent_rands, d.safe_deposit_rands, d.safe_paid_at, d.safe_released_at, d.safe_refunded_at,
    coalesce((select a.can_receive from public.safe_accounts a where a.user_id = d.owner_id), false),
    d.deposit_parts,
    (select p.amount_rands from public.deposit_plan(d.deposit_rands, d.deposit_parts, d.start_date) p where p.part = 1)
  from public.deals d
  join public.listings l on l.id = d.listing_id
  where d.id = p_deal and auth.uid() in (d.owner_id, d.renter_id);
$$;
revoke all on function public.deal_view(uuid) from public, anon;
grant execute on function public.deal_view(uuid) to authenticated;
