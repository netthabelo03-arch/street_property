-- Sprint 0: one profile row per account (name and role), and admins.
-- Run this once in the Supabase dashboard: SQL Editor, paste, Run.
-- Safe to run again; it does not delete data.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  -- Only the roles a person may choose for themselves. Admins are kept in
  -- their own table below, so nobody can make themselves one.
  role text not null default 'renter' check (role in ('renter', 'owner', 'agent')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "People can read their own profile" on public.profiles;
create policy "People can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "People can update their own profile" on public.profiles;
create policy "People can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- People may read their row and change only their name and role. Rows are
-- created by the trigger below, never from the app.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, role) on public.profiles to authenticated;

-- A new account gets its profile from the sign-up details. An unknown role
-- falls back to "renter".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted_role text := new.raw_user_meta_data ->> 'role';
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 80),
    case when wanted_role in ('renter', 'owner', 'agent') then wanted_role else 'renter' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Admins review listings (from Sprint 1). Added only in the dashboard:
--   insert into public.admins (user_id) values ('<the person''s user id>');
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
