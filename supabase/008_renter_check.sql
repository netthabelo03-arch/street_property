-- Sprint 7: the renter check.
-- A renter proves who they are (the same ID check as Street Verified) and what
-- they earn (payslips or bank statements), once. Admins check the documents by
-- hand for now, write down the monthly take-home pay, and the documents are
-- deleted. (Stitch's bank link can replace the hand check later.)
-- The renter then chooses to share the result with an owner in a conversation.
-- The owner sees: ID checked, how many times the pay covers the rent, who is
-- moving in and when. Never the documents, never the amount itself.
--
-- Run this once in the Supabase dashboard (SQL Editor) after 007_verified.sql.
-- Safe to run again.

create table if not exists public.income_checks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  doc_paths text[] not null default '{}',
  monthly_income_rands integer check (monthly_income_rands is null or monthly_income_rands between 0 and 10000000),
  note text check (note is null or char_length(note) <= 500),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  -- A result is good for three months.
  valid_until date
);
alter table public.income_checks enable row level security;
drop policy if exists "People see their own income check" on public.income_checks;
create policy "People see their own income check"
  on public.income_checks for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));
revoke all on public.income_checks from anon, authenticated;
grant select (user_id, status, monthly_income_rands, note, submitted_at, decided_at, valid_until) on public.income_checks to authenticated;

-- What the renter shares with the owner in one conversation.
alter table public.enquiries add column if not exists shared_at timestamptz;
alter table public.enquiries add column if not exists move_in date;
alter table public.enquiries add column if not exists lease_months smallint check (lease_months is null or lease_months in (6, 12, 24, 36));
alter table public.enquiries add column if not exists household text check (household is null or char_length(household) <= 120);
alter table public.enquiries add column if not exists has_pets boolean;
alter table public.enquiries add column if not exists owner_decision text check (owner_decision is null or owner_decision in ('accepted', 'declined'));
alter table public.enquiries add column if not exists decided_at timestamptz;

-- "Lerato" (first name) for notes.
create or replace function public.first_name_of(p_user uuid, p_fallback text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select nullif(split_part(btrim(p.full_name), ' ', 1), '') from public.profiles p where p.id = p_user), p_fallback);
$$;
revoke all on function public.first_name_of(uuid, text) from public, anon, authenticated;

-- Sending payslips or bank statements, already uploaded to <user id>/income/.
create or replace function public.submit_income(p_paths text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  path text;
begin
  if me is null then
    raise exception 'Log in first' using errcode = 'P0001', hint = 'not_signed_in';
  end if;
  if coalesce(cardinality(p_paths), 0) < 1 or cardinality(p_paths) > 6 then
    raise exception 'Add your latest payslip or 3 months of bank statements' using errcode = 'P0001', hint = 'need_income_docs';
  end if;
  foreach path in array p_paths loop
    if path not like me::text || '/income/%' then
      raise exception 'Document saved in the wrong place' using errcode = 'P0001', hint = 'bad_doc_path';
    end if;
  end loop;
  if exists (select 1 from public.income_checks i where i.user_id = me and i.status = 'pending') then
    raise exception 'Your income is already being checked' using errcode = 'P0001', hint = 'check_exists';
  end if;
  insert into public.income_checks (user_id, status, doc_paths, monthly_income_rands, note, submitted_at, decided_at, decided_by, valid_until)
  values (me, 'pending', p_paths, null, null, now(), null, null, null)
  on conflict (user_id) do update set
    status = 'pending', doc_paths = excluded.doc_paths, monthly_income_rands = null, note = null,
    submitted_at = now(), decided_at = null, decided_by = null, valid_until = null;
end;
$$;

-- Where the caller's renter check stands.
create or replace function public.my_renter_check()
returns table (
  identity_status text,
  identity_note text,
  income_status text,
  income_note text,
  monthly_income_rands integer,
  valid_until date
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.status, i.note,
         case when n.status = 'approved' and n.valid_until < current_date then 'expired' else n.status end,
         n.note, n.monthly_income_rands, n.valid_until
  from (select auth.uid() as me) x
  left join public.identity_checks i on i.user_id = x.me
  left join public.income_checks n on n.user_id = x.me
  where x.me is not null;
$$;

-- Share the renter check with the owner in this conversation.
create or replace function public.share_renter_check(
  p_enquiry uuid,
  p_move_in date,
  p_lease_months integer,
  p_household text,
  p_pets boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  talk public.enquiries := public.my_enquiry(p_enquiry);
  v_household text := nullif(btrim(coalesce(p_household, '')), '');
begin
  if talk.renter_id <> me then
    raise exception 'Only the renter can share their check' using errcode = 'P0001', hint = 'not_the_renter';
  end if;
  if (select l.status from public.listings l where l.id = talk.listing_id) <> 'live' then
    raise exception 'This place is no longer listed' using errcode = 'P0001', hint = 'listing_not_live';
  end if;
  if talk.owner_decision is not null then
    raise exception 'The owner has already answered' using errcode = 'P0001', hint = 'already_decided';
  end if;
  if p_move_in is not null and (p_move_in < current_date or p_move_in > current_date + 365) then
    raise exception 'Choose a move-in date in the next 12 months' using errcode = 'P0001', hint = 'move_in_date';
  end if;
  if p_lease_months is not null and p_lease_months not in (6, 12, 24, 36) then
    raise exception 'Choose 6, 12, 24 or 36 months' using errcode = 'P0001', hint = 'lease_months';
  end if;
  if char_length(coalesce(v_household, '')) > 120 then
    raise exception 'Keep this under 120 characters' using errcode = 'P0001', hint = 'household_too_long';
  end if;
  update public.enquiries set shared_at = now(), move_in = p_move_in, lease_months = p_lease_months,
    household = v_household, has_pets = p_pets
  where id = talk.id;
  perform public.add_note(talk.id, public.first_name_of(me, 'The renter') || ' shared their renter check.');
end;
$$;

create or replace function public.stop_sharing(p_enquiry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  talk public.enquiries := public.my_enquiry(p_enquiry);
begin
  if talk.renter_id <> me then
    raise exception 'Only the renter can stop sharing' using errcode = 'P0001', hint = 'not_the_renter';
  end if;
  update public.enquiries set shared_at = null, move_in = null, lease_months = null, household = null, has_pets = null
  where id = talk.id;
  perform public.add_note(talk.id, public.first_name_of(me, 'The renter') || ' stopped sharing their renter check.');
end;
$$;

-- What the owner sees (and the renter, to know what is shown). Nothing until
-- the renter shares. Never the documents or the amount: only whether the ID
-- is checked, and how many times the take-home pay covers this rent.
create or replace function public.renter_check_for(p_enquiry uuid)
returns table (
  renter_name text,
  shared_at timestamptz,
  move_in date,
  lease_months smallint,
  household text,
  has_pets boolean,
  id_checked boolean,
  income_checked boolean,
  cover_ratio numeric,
  owner_decision text,
  my_side text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    trim(split_part(btrim(coalesce(p.full_name, '')), ' ', 1) || ' ' ||
      coalesce(left(nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 2), ''), 1) || '.', '')),
    e.shared_at, e.move_in, e.lease_months, e.household, e.has_pets,
    coalesce(i.status = 'approved', false),
    coalesce(n.status = 'approved' and n.valid_until >= current_date, false),
    case when n.status = 'approved' and n.valid_until >= current_date and l.mode = 'rent' and l.price_rands > 0
         then round(n.monthly_income_rands::numeric / l.price_rands, 1) end,
    e.owner_decision,
    case when e.renter_id = auth.uid() then 'renter' else 'owner' end
  from public.enquiries e
  join public.listings l on l.id = e.listing_id
  left join public.profiles p on p.id = e.renter_id
  left join public.identity_checks i on i.user_id = e.renter_id
  left join public.income_checks n on n.user_id = e.renter_id
  where e.id = p_enquiry
    and auth.uid() in (e.renter_id, e.owner_id)
    and (e.shared_at is not null or e.renter_id = auth.uid() or e.owner_decision is not null);
$$;

-- The owner says yes, or not this time. Not this time removes the renter's
-- shared details from the owner's view.
create or replace function public.decide_renter(p_enquiry uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  talk public.enquiries := public.my_enquiry(p_enquiry);
  renter text;
begin
  if talk.owner_id <> me then
    raise exception 'Only the owner can decide' using errcode = 'P0001', hint = 'not_the_owner';
  end if;
  if talk.shared_at is null then
    raise exception 'The renter has not shared their check' using errcode = 'P0001', hint = 'not_shared';
  end if;
  if talk.owner_decision is not null then
    raise exception 'You have already answered' using errcode = 'P0001', hint = 'already_decided';
  end if;
  renter := public.first_name_of(talk.renter_id, 'there');
  if p_accept then
    update public.enquiries set owner_decision = 'accepted', decided_at = now() where id = talk.id;
    perform public.add_note(talk.id, 'Good news, ' || renter || ': the owner would like to rent to you. Agree on the details here. Signing the lease in the app is coming soon.');
  else
    update public.enquiries set owner_decision = 'declined', decided_at = now(),
      shared_at = null, move_in = null, lease_months = null, household = null, has_pets = null
    where id = talk.id;
    perform public.add_note(talk.id, 'Thank you for your interest, ' || renter || '. The owner has chosen another renter this time. Your check is no longer shared with them.');
  end if;
  return case when p_accept then 'accepted' else 'declined' end;
end;
$$;

-- Admins: decide an income check, writing down the monthly take-home pay.
-- Returns the document paths for the app to delete.
create or replace function public.decide_income(p_user uuid, p_approve boolean, p_monthly integer default null, p_note text default null)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  files text[];
begin
  if not public.is_admin() then
    raise exception 'Only admins review checks' using errcode = 'P0001', hint = 'not_admin';
  end if;
  if p_approve and (p_monthly is null or p_monthly < 1 or p_monthly > 10000000) then
    raise exception 'Enter the monthly take-home pay' using errcode = 'P0001', hint = 'income_amount';
  end if;
  if not p_approve and (v_note is null or char_length(v_note) < 5) then
    raise exception 'Say what the person needs to send instead' using errcode = 'P0001', hint = 'note_needed';
  end if;
  select n.doc_paths into files from public.income_checks n where n.user_id = p_user and n.status = 'pending' for update;
  if files is null then
    raise exception 'This check is no longer waiting' using errcode = 'P0001', hint = 'check_not_waiting';
  end if;
  update public.income_checks set
    status = case when p_approve then 'approved' else 'rejected' end,
    monthly_income_rands = case when p_approve then p_monthly end,
    note = case when p_approve then null else v_note end,
    valid_until = case when p_approve then current_date + 90 end,
    decided_at = now(), decided_by = auth.uid(), doc_paths = '{}'
  where user_id = p_user;
  return files;
end;
$$;

-- The admin queue, now with income checks too.
create or replace function public.verification_queue()
returns table (
  kind text,
  subject_id uuid,
  person_name text,
  listing_id uuid,
  street text,
  area text,
  city text,
  lister text,
  paths text[],
  submitted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins review checks' using errcode = 'P0001', hint = 'not_admin';
  end if;
  return query
    select 'identity'::text, i.user_id, coalesce(nullif(btrim(p.full_name), ''), 'No name given'),
           null::uuid, null::text, null::text, null::text, null::text,
           array[i.id_path, i.selfie_path], i.submitted_at
    from public.identity_checks i
    left join public.profiles p on p.id = i.user_id
    where i.status = 'pending'
    union all
    select 'ownership'::text, o.listing_id, coalesce(nullif(btrim(p.full_name), ''), 'No name given'),
           l.id, l.street, l.area, l.city, l.lister, o.doc_paths, o.submitted_at
    from public.ownership_checks o
    join public.listings l on l.id = o.listing_id
    left join public.profiles p on p.id = l.owner_id
    where o.status = 'pending'
    union all
    select 'income'::text, n.user_id, coalesce(nullif(btrim(p.full_name), ''), 'No name given'),
           null::uuid, null::text, null::text, null::text, null::text,
           n.doc_paths, n.submitted_at
    from public.income_checks n
    left join public.profiles p on p.id = n.user_id
    where n.status = 'pending'
    order by 10;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.submit_income(text[])', 'public.my_renter_check()', 'public.share_renter_check(uuid, date, integer, text, boolean)',
    'public.stop_sharing(uuid)', 'public.renter_check_for(uuid)', 'public.decide_renter(uuid, boolean)',
    'public.decide_income(uuid, boolean, integer, text)', 'public.verification_queue()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
