-- Who a person is. Supabase Auth owns `auth.users`; this is the profile the
-- app keeps beside it, one row per account, created by a trigger the moment
-- Auth creates the account. The app never inserts here.

-- Supabase runs each migration in one transaction; these bound how long it
-- may wait for a lock or run, so a deploy that would block the site fails
-- instead, and is retried when the table is quiet.
set local lock_timeout = '10s';
set local statement_timeout = '5min';

create table public.app_user (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  -- What the identity provider said. GitHub gives a display name that may be
  -- empty, so this can be null; a screen shows the login instead.
  full_name    text,
  -- Lowercased: GitHub logins are case-insensitive, and comparing text is not.
  github_login text check (github_login = lower(github_login)),
  role         app.platform_role not null default 'user',
  created_at   timestamptz not null default now()
);

-- RLS is enabled, not forced: the `security definer` functions in these
-- migrations run as the table owner and are meant to see every row. The
-- Worker never connects as the owner (see the connection roles migration),
-- so there is no path from a request to an unfiltered table.
alter table public.app_user enable row level security;
revoke all on public.app_user from public, anon, authenticated;

-- The caller's platform role, or null before their profile exists.
create or replace function app.platform_role()
returns app.platform_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.app_user where user_id = (select auth.uid())
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(app.platform_role() = 'admin', false)
$$;

create or replace function app.is_teacher()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(app.platform_role() in ('teacher', 'admin'), false)
$$;

create policy audit_log_read on public.audit_log for select to authenticated using (app.is_admin());
grant select on public.audit_log to authenticated;

-- The one way a platform role changes. `role` has no update grant, so a
-- client cannot write it even through a policy; this function checks the
-- caller, writes the row, and leaves the audit entry in one transaction.
create or replace function app.set_platform_role(target uuid, new_role app.platform_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'only an admin may change a platform role' using errcode = '42501';
  end if;
  update public.app_user set role = new_role where user_id = target;
  if not found then
    raise exception 'no such user' using errcode = 'P0002';
  end if;
  perform app.audit('set_platform_role', jsonb_build_object('target', target, 'role', new_role));
end
$$;

-- The same, by address: what the admin screen has, since a profile carries
-- no address and an admin should not need to list everyone to find one.
create or replace function app.set_platform_role_by_email(addr text, new_role app.platform_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if not app.is_admin() then
    raise exception 'only an admin may change a platform role' using errcode = '42501';
  end if;
  select u.id into target from auth.users u where lower(u.email) = lower(addr);
  if target is null then
    raise exception 'no account with address %; they log in first', addr using errcode = 'P0002';
  end if;
  perform app.set_platform_role(target, new_role);
end
$$;

-- The first admin. Run by an operator against the database, never from the
-- app: it is not executable by any API role. Promotes the account behind
-- `addr` only while no admin exists, so running it twice, or on the wrong
-- address after the first, changes nothing. An address that has not logged
-- in yet is a notice and false, not an error: the deploy that creates an
-- environment runs this before anyone could have logged in, and the next
-- deploy promotes them.
create or replace function app.bootstrap_admin(addr text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if exists (select 1 from public.app_user where role = 'admin') then
    return false;
  end if;
  select u.id into target from auth.users u where lower(u.email) = lower(addr);
  if target is null then
    raise notice 'no account with address % yet; log in once, then run this again', addr;
    return false;
  end if;
  update public.app_user set role = 'admin' where user_id = target;
  insert into public.audit_log (actor, action, subject)
  values (null, 'bootstrap_admin', jsonb_build_object('target', target));
  return true;
end
$$;
revoke execute on function app.bootstrap_admin(text) from public, anon, authenticated;

-- Reads are granted in the courses migration, once `enrollment` exists to say
-- who shares an edition with whom.

-- Writes: your own display name. `role` is deliberately not in the grant.
create policy app_user_update_self on public.app_user for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select on public.app_user to authenticated;
grant update (full_name) on public.app_user to authenticated;
