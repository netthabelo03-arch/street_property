-- Sprint 10: the rent record, rent reminders, and ratings and reviews.
--
--   * Rent record: when the renter confirms the keys, every month of the lease
--     gets a line: due date, amount, and how it was paid. Month 1 is the
--     move-in payment. The renter pays a month through Street Safe (passed
--     straight to the owner), or the owner marks it received another way.
--     Each paid line is the written receipt the lease promises.
--   * Reminders: every morning at 07:00 (South African time) the renter gets
--     an email 3 days before rent or a deposit part is due and on the day; at
--     3 days late a note goes into the conversation.
--   * Reviews: after the keys, owner and renter each rate the other once, 1 to
--     5 stars with a few words. A review shows only when both have written, or
--     14 days after the keys, so nobody writes in reply to the other.
--
-- Debit orders are left for later.
--
-- Run this once in the Supabase dashboard (SQL Editor) after 012_deposit_plans.sql.
-- Safe to run again.

-- The rent record -------------------------------------------------------------------

create table if not exists public.rent_payments (
  deal_id uuid not null references public.deals (id) on delete cascade,
  month_no smallint not null check (month_no between 1 and 36),
  due_date date not null,
  amount_rands integer not null check (amount_rands > 0),
  state text not null default 'due' check (state in ('due', 'waiting', 'paid')),
  method text check (method is null or method in ('street_safe', 'owner')),
  note text check (note is null or char_length(note) <= 200),
  paid_at timestamptz,
  safe_tx text unique,
  reminded_before boolean not null default false,
  reminded_due boolean not null default false,
  late_noted boolean not null default false,
  primary key (deal_id, month_no)
);
create index if not exists rent_payments_due_idx on public.rent_payments (due_date) where state <> 'paid';
alter table public.rent_payments enable row level security;
drop policy if exists "The two people read the rent record" on public.rent_payments;
create policy "The two people read the rent record" on public.rent_payments for select to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id and ((select auth.uid()) in (d.owner_id, d.renter_id) or (select public.is_admin()))));
revoke all on public.rent_payments from anon, authenticated;
grant select (deal_id, month_no, due_date, amount_rands, state, method, note, paid_at) on public.rent_payments to authenticated;

alter table public.deposit_payments add column if not exists reminded_before boolean not null default false;
alter table public.deposit_payments add column if not exists reminded_due boolean not null default false;

-- "January 2027"
create or replace function public.month_words(p date)
returns text
language sql
immutable
set search_path = ''
as $$ select to_char(p, 'FMMonth YYYY'); $$;

-- The keys start the rent record.
create or replace function public.start_rent_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'moved_in' and old.status is distinct from 'moved_in' then
    insert into public.rent_payments (deal_id, month_no, due_date, amount_rands, state, method, paid_at)
    select new.id, n, (new.start_date + make_interval(months => n - 1))::date, new.rent_rands,
      case when n = 1 and new.safe_state in ('paid', 'released') then 'paid' else 'due' end,
      case when n = 1 and new.safe_state in ('paid', 'released') then 'street_safe' end,
      case when n = 1 and new.safe_state in ('paid', 'released') then coalesce(new.safe_paid_at, now()) end
    from generate_series(1, new.lease_months) n
    on conflict (deal_id, month_no) do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists start_rent_record on public.deals;
create trigger start_rent_record after update of status on public.deals
  for each row execute function public.start_rent_record();

-- The owner confirms rent received another way (EFT to their account, cash).
create or replace function public.mark_rent_received(p_deal uuid, p_month integer, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deals := public.my_deal(p_deal);
  line public.rent_payments;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if d.owner_id <> auth.uid() then
    raise exception 'Only the owner confirms rent received' using errcode = 'P0001', hint = 'not_the_owner';
  end if;
  select * into line from public.rent_payments r where r.deal_id = d.id and r.month_no = p_month for update;
  if line.deal_id is null then
    raise exception 'No such month' using errcode = 'P0001', hint = 'rent_month_missing';
  end if;
  if line.state = 'paid' then
    raise exception 'This month is already paid' using errcode = 'P0001', hint = 'already_paid';
  end if;
  if line.state = 'waiting' then
    raise exception 'A Street Safe payment for this month is on its way' using errcode = 'P0001', hint = 'rent_paying';
  end if;
  if char_length(coalesce(v_note, '')) > 200 then
    raise exception 'Keep the note under 200 characters' using errcode = 'P0001', hint = 'note_too_long';
  end if;
  update public.rent_payments set state = 'paid', method = 'owner', paid_at = now(), note = v_note
  where deal_id = d.id and month_no = p_month;
  perform public.add_note(d.enquiry_id, public.first_name_of(d.owner_id, 'The owner') || ' confirmed receiving the rent for '
    || public.month_words(line.due_date) || ' (' || public.rands(line.amount_rands) || ').');
end;
$$;
revoke all on function public.mark_rent_received(uuid, integer, text) from public, anon;
grant execute on function public.mark_rent_received(uuid, integer, text) to authenticated;

-- The Edge Function records rent paid through Street Safe.
create or replace function public.safe_record_rent(p_deal uuid, p_month integer, p_state text, p_tx text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deals;
  line public.rent_payments;
  v_state text := case p_state when 'released' then 'paid' when 'paid' then 'paid' when 'waiting' then 'waiting' else 'due' end;
begin
  select * into d from public.deals x where x.id = p_deal;
  select * into line from public.rent_payments r where r.deal_id = p_deal and r.month_no = p_month for update;
  if line.deal_id is null then
    raise exception 'No such month' using errcode = 'P0001', hint = 'rent_month_missing';
  end if;
  update public.rent_payments set safe_tx = coalesce(p_tx, safe_tx), state = v_state,
    method = case when v_state = 'paid' then 'street_safe' else method end,
    paid_at = case when v_state = 'paid' then coalesce(paid_at, now()) else paid_at end
  where deal_id = p_deal and month_no = p_month;
  if v_state = line.state then return 'same'; end if;
  if v_state = 'paid' then
    perform public.add_note(d.enquiry_id, public.first_name_of(d.renter_id, 'The renter') || ' paid the rent for '
      || public.month_words(line.due_date) || ' (' || public.rands(line.amount_rands) || ') through Street Safe. It was passed to '
      || public.first_name_of(d.owner_id, 'the owner') || '.');
  end if;
  return v_state;
end;
$$;
revoke all on function public.safe_record_rent(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.safe_record_rent(uuid, integer, text, text) to service_role;

-- Reminders ---------------------------------------------------------------------------

create or replace function public.send_rent_reminders(p_today date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := coalesce(p_today, (now() at time zone 'Africa/Johannesburg')::date);
  line record;
  sent integer := 0;
begin
  -- Rent.
  for line in
    select r.*, d.renter_id, d.owner_id, d.enquiry_id, d.status
    from public.rent_payments r join public.deals d on d.id = r.deal_id
    where r.state <> 'paid' and d.status = 'moved_in' and r.due_date between today - 3 and today + 3
  loop
    if line.due_date = today + 3 and not line.reminded_before then
      perform public.queue_email(line.renter_id, 'rent', 'rent:' || line.deal_id || ':' || line.month_no || ':before',
        'Rent of ' || public.rands(line.amount_rands) || ' is due on ' || public.long_date(line.due_date),
        'Your rent for ' || public.month_words(line.due_date) || ' (' || public.rands(line.amount_rands) || ') is due on '
          || public.long_date(line.due_date) || '. You can pay it through Street Safe in the app.',
        '#/deals/' || line.deal_id || '/rent');
      update public.rent_payments set reminded_before = true where deal_id = line.deal_id and month_no = line.month_no;
      sent := sent + 1;
    elsif line.due_date = today and not line.reminded_due then
      perform public.queue_email(line.renter_id, 'rent', 'rent:' || line.deal_id || ':' || line.month_no || ':due',
        'Rent of ' || public.rands(line.amount_rands) || ' is due today',
        'Your rent for ' || public.month_words(line.due_date) || ' (' || public.rands(line.amount_rands) || ') is due today.',
        '#/deals/' || line.deal_id || '/rent');
      update public.rent_payments set reminded_due = true where deal_id = line.deal_id and month_no = line.month_no;
      sent := sent + 1;
    elsif line.due_date = today - 3 and not line.late_noted then
      perform public.add_note(line.enquiry_id, 'The rent for ' || public.month_words(line.due_date) || ' ('
        || public.rands(line.amount_rands) || ') is 3 days late.');
      update public.rent_payments set late_noted = true where deal_id = line.deal_id and month_no = line.month_no;
      sent := sent + 1;
    end if;
  end loop;

  -- Deposit parts.
  for line in
    select p.*, d.renter_id, d.deposit_parts
    from public.deposit_payments p join public.deals d on d.id = p.deal_id
    where p.safe_state in ('none', 'waiting') and d.status = 'moved_in' and p.due_date in (today, today + 3)
  loop
    if line.due_date = today + 3 and not line.reminded_before then
      perform public.queue_email(line.renter_id, 'rent', 'deposit:' || line.deal_id || ':' || line.part || ':before',
        'Deposit part ' || line.part || ' is due on ' || public.long_date(line.due_date),
        'Deposit part ' || line.part || ' of ' || line.deposit_parts || ' (' || public.rands(line.amount_rands) || ') is due on '
          || public.long_date(line.due_date) || ', with the rent.',
        '#/deals/' || line.deal_id);
      update public.deposit_payments set reminded_before = true where deal_id = line.deal_id and part = line.part;
      sent := sent + 1;
    elsif line.due_date = today and not line.reminded_due then
      perform public.queue_email(line.renter_id, 'rent', 'deposit:' || line.deal_id || ':' || line.part || ':due',
        'Deposit part ' || line.part || ' is due today',
        'Deposit part ' || line.part || ' of ' || line.deposit_parts || ' (' || public.rands(line.amount_rands) || ') is due today.',
        '#/deals/' || line.deal_id);
      update public.deposit_payments set reminded_due = true where deal_id = line.deal_id and part = line.part;
      sent := sent + 1;
    end if;
  end loop;
  return sent;
end;
$$;
revoke all on function public.send_rent_reminders(date) from public, anon, authenticated;

-- Every day at 05:00 UTC (07:00 in South Africa).
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'street-property-rent-reminders';
  perform cron.schedule('street-property-rent-reminders', '0 5 * * *', 'select public.send_rent_reminders()');
end;
$$;

-- Ratings and reviews -------------------------------------------------------------------

create table if not exists public.deal_reviews (
  deal_id uuid not null references public.deals (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null references auth.users (id) on delete cascade,
  author_side text not null check (author_side in ('owner', 'renter')),
  stars smallint not null check (stars between 1 and 5),
  words text check (words is null or char_length(words) <= 500),
  created_at timestamptz not null default now(),
  primary key (deal_id, author_id)
);
create index if not exists deal_reviews_subject_idx on public.deal_reviews (subject_id, created_at desc);
alter table public.deal_reviews enable row level security;
-- Read through the functions below, which hold reviews back until they may show.
revoke all on public.deal_reviews from anon, authenticated;

-- A review shows once both have written, or 14 days after the keys.
create or replace function public.review_visible(p_deal uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from public.deal_reviews r where r.deal_id = p_deal) >= 2
      or coalesce((select d.keys_at from public.deals d where d.id = p_deal) < now() - interval '14 days', false);
$$;
revoke all on function public.review_visible(uuid) from public, anon, authenticated;

create or replace function public.review_deal(p_deal uuid, p_stars integer, p_words text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  d public.deals := public.my_deal(p_deal);
  v_words text := nullif(btrim(coalesce(p_words, '')), '');
  side text;
begin
  if d.keys_at is null then
    raise exception 'Rate the deal after the keys are handed over' using errcode = 'P0001', hint = 'review_too_early';
  end if;
  if d.keys_at < now() - interval '90 days' then
    raise exception 'Reviews close 90 days after the keys' using errcode = 'P0001', hint = 'review_closed';
  end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    raise exception 'Choose 1 to 5 stars' using errcode = 'P0001', hint = 'review_stars';
  end if;
  if char_length(coalesce(v_words, '')) > 500 then
    raise exception 'Keep the review under 500 characters' using errcode = 'P0001', hint = 'review_long';
  end if;
  if exists (select 1 from public.deal_reviews r where r.deal_id = d.id and r.author_id = me) then
    raise exception 'You already rated this deal' using errcode = 'P0001', hint = 'review_done';
  end if;
  side := case when me = d.owner_id then 'owner' else 'renter' end;
  insert into public.deal_reviews (deal_id, author_id, subject_id, author_side, stars, words)
  values (d.id, me, case when side = 'owner' then d.renter_id else d.owner_id end, side, p_stars, v_words);
  if public.review_visible(d.id) then
    perform public.add_note(d.enquiry_id, 'You have both rated the deal. The reviews are now on the deal page.');
    return 'both';
  end if;
  perform public.add_note(d.enquiry_id, public.first_name_of(me, 'Someone') || ' rated the deal. Rate yours to see what they said.');
  return 'waiting';
end;
$$;

-- The reviews on one deal, for the two people in it: theirs shows only when visible.
create or replace function public.deal_reviews_for(p_deal uuid)
returns table (mine boolean, stars smallint, words text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.author_id = auth.uid(), r.stars, r.words, r.created_at
  from public.deal_reviews r join public.deals d on d.id = r.deal_id
  where r.deal_id = p_deal and auth.uid() in (d.owner_id, d.renter_id)
    and (r.author_id = auth.uid() or public.review_visible(p_deal));
$$;

-- What others said about someone, as an owner or as a renter.
create or replace function public.reviews_about(p_user uuid, p_side text)
returns table (stars smallint, words text, author text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.stars, r.words, public.first_name_of(r.author_id, 'Someone'), r.created_at
  from public.deal_reviews r
  where r.subject_id = p_user and r.author_side = (case when p_side = 'owner' then 'renter' else 'owner' end)
    and public.review_visible(r.deal_id)
  order by r.created_at desc
  limit 20;
$$;

-- "4.8 from 5 renters". Anyone may see the summary, also on public listings.
create or replace function public.rating_summary(p_user uuid, p_side text)
returns table (average numeric, reviews integer)
language sql
stable
security definer
set search_path = ''
as $$
  select round(avg(r.stars)::numeric, 1), count(*)::integer
  from public.deal_reviews r
  where r.subject_id = p_user and r.author_side = (case when p_side = 'owner' then 'renter' else 'owner' end)
    and public.review_visible(r.deal_id);
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.review_deal(uuid, integer, text)', 'public.deal_reviews_for(uuid)', 'public.reviews_about(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
revoke all on function public.rating_summary(uuid, text) from public;
grant execute on function public.rating_summary(uuid, text) to anon, authenticated;

-- The renter's rating, for the owner looking at their shared renter check.
create or replace function public.renter_rating_for(p_enquiry uuid)
returns table (average numeric, reviews integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.average, s.reviews
  from public.enquiries e, public.rating_summary(e.renter_id, 'renter') s
  where e.id = p_enquiry and e.owner_id = auth.uid();
$$;
revoke all on function public.renter_rating_for(uuid) from public, anon;
grant execute on function public.renter_rating_for(uuid) to authenticated;
