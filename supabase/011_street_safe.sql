-- Sprint 9: Street Safe payments through TradeSafe (a South African escrow
-- service). The renter pays the first month's rent and the deposit into
-- TradeSafe after the lease is signed; TradeSafe holds the money until the
-- renter confirms the keys, then pays the owner. If the deal is called off
-- first, the renter is refunded.
--
-- The app never sees bank account numbers after they are typed: the
-- "street-safe" Edge Function passes them straight to TradeSafe and keeps only
-- the bank, the account type and the last 4 digits here.
--
-- Only the Edge Function (service role) writes payment states. People read
-- them through deal_view.
--
-- Run this once in the Supabase dashboard (SQL Editor) after 010_deals.sql.
-- After 012_deposit_plans.sql has run, do not run this file again: 012 replaces deal_view.
-- Safe to run again.

-- TradeSafe accounts (a TradeSafe "token" per person) -----------------------------

create table if not exists public.safe_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token text not null,
  bank text,
  account_last4 text check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  account_type text,
  can_receive boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.safe_accounts enable row level security;
drop policy if exists "People read their own Street Safe account" on public.safe_accounts;
create policy "People read their own Street Safe account" on public.safe_accounts for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.safe_accounts from anon, authenticated;
-- The TradeSafe token stays with the Edge Function.
grant select (user_id, bank, account_last4, account_type, can_receive, updated_at) on public.safe_accounts to authenticated;

-- Payment state on the deal -----------------------------------------------------------

alter table public.deals add column if not exists safe_tx text;
alter table public.deals add column if not exists safe_state text not null default 'none';
alter table public.deals drop constraint if exists deals_safe_state_check;
alter table public.deals add constraint deals_safe_state_check
  check (safe_state in ('none', 'waiting', 'paid', 'released', 'refunded'));
alter table public.deals add column if not exists safe_rent_rands integer;
alter table public.deals add column if not exists safe_deposit_rands integer;
alter table public.deals add column if not exists safe_allocations text[];
alter table public.deals add column if not exists safe_paid_at timestamptz;
alter table public.deals add column if not exists safe_released_at timestamptz;
alter table public.deals add column if not exists safe_refunded_at timestamptz;
create unique index if not exists deals_safe_tx_idx on public.deals (safe_tx) where safe_tx is not null;

-- The Edge Function records what TradeSafe says. Notes go into the conversation
-- once per change.
create or replace function public.safe_record(p_deal uuid, p_state text, p_tx text default null, p_rent integer default null, p_deposit integer default null, p_allocations text[] default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deals;
  total text;
  renter text;
  owner text;
begin
  if p_state not in ('none', 'waiting', 'paid', 'released', 'refunded') then
    raise exception 'Unknown payment state %', p_state using errcode = 'P0001', hint = 'bad_safe_state';
  end if;
  select * into d from public.deals x where x.id = p_deal for update;
  if d.id is null then
    raise exception 'Deal not found' using errcode = 'P0001', hint = 'deal_not_found';
  end if;
  update public.deals set
    safe_tx = coalesce(p_tx, safe_tx),
    safe_rent_rands = coalesce(p_rent, safe_rent_rands),
    safe_deposit_rands = coalesce(p_deposit, safe_deposit_rands),
    safe_allocations = coalesce(p_allocations, safe_allocations),
    safe_state = p_state,
    safe_paid_at = case when p_state in ('paid', 'released') then coalesce(safe_paid_at, now()) else safe_paid_at end,
    safe_released_at = case when p_state = 'released' then coalesce(safe_released_at, now()) else safe_released_at end,
    safe_refunded_at = case when p_state = 'refunded' then coalesce(safe_refunded_at, now()) else safe_refunded_at end
  where id = d.id;
  if p_state = d.safe_state then
    return 'same';
  end if;
  select * into d from public.deals x where x.id = p_deal;
  total := public.rands(coalesce(d.safe_rent_rands, 0) + coalesce(d.safe_deposit_rands, 0));
  renter := public.first_name_of(d.renter_id, 'The renter');
  owner := public.first_name_of(d.owner_id, 'the owner');
  if p_state = 'paid' then
    perform public.add_note(d.enquiry_id, renter || ' paid ' || total || ' into Street Safe. It is held until the keys are handed over.');
  elsif p_state = 'released' then
    perform public.add_note(d.enquiry_id, 'Street Safe paid ' || total || ' to ' || owner || '.');
  elsif p_state = 'refunded' then
    perform public.add_note(d.enquiry_id, 'Street Safe is refunding ' || total || ' to ' || renter || '.');
  end if;
  return p_state;
end;
$$;
revoke all on function public.safe_record(uuid, text, text, integer, integer, text[]) from public, anon, authenticated;
grant execute on function public.safe_record(uuid, text, text, integer, integer, text[]) to service_role;

-- Calling the deal off after paying: the money goes back (the Edge Function
-- asks TradeSafe to refund). Nothing changes in cancel_deal itself.

-- deal_view, now with the payment -------------------------------------------------------

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
  owner_can_receive boolean
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
    coalesce((select a.can_receive from public.safe_accounts a where a.user_id = d.owner_id), false)
  from public.deals d
  join public.listings l on l.id = d.listing_id
  where d.id = p_deal and auth.uid() in (d.owner_id, d.renter_id);
$$;
revoke all on function public.deal_view(uuid) from public, anon;
grant execute on function public.deal_view(uuid) to authenticated;
