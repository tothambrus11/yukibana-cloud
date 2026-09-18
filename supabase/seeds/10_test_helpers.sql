-- Helpers the pgTAP suite calls. Seeds run only on `supabase db reset`, so
-- these exist in a local database and never in a deployed one: `db push`
-- applies migrations alone.
--
-- Ids are derived from names rather than stored, so a test can say
-- `tests.uid('ada@example.com')` in any role without a variable: psql does
-- not substitute variables inside dollar-quoted strings, and pgTAP's
-- assertions take their SQL as strings.

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
-- A test switches role mid-transaction and keeps calling these.
-- Tests use example.com addresses; the local fixtures use yukibana.local, so
-- a test's derived ids never collide with a seeded account.
grant usage on schema tests to anon, authenticated, yukibana_publisher;

-- The account id that `tests.create_user(addr)` gives that address.
create or replace function tests.uid(addr text)
returns uuid
language sql
immutable
as $$
  select md5('tests.user:' || lower(addr))::uuid
$$;

-- An account as Auth would create it after a GitHub login: confirmed address,
-- the provider's metadata, and therefore a profile and any pending
-- enrolments, via the trigger on auth.users. Security definer so a test can
-- add a person while running as someone else.
create or replace function tests.create_user(
  addr text,
  name text default null,
  login text default null,
  confirmed boolean default true
)
returns uuid
language plpgsql
security definer
as $$
declare
  uid uuid := tests.uid(addr);
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    lower(addr), '', case when confirmed then now() end,
    '{"provider":"github","providers":["github"]}',
    jsonb_strip_nulls(jsonb_build_object('full_name', name, 'user_name', login)),
    now(), now(), '', '', '', ''
  );
  return uid;
end
$$;

create or replace function tests.confirm_user(addr text)
returns void
language sql
security definer
as $$
  update auth.users set email_confirmed_at = now() where id = tests.uid(addr);
$$;

-- Lookups that see through RLS, for a test to name what it made. Positional
-- parameters on purpose: in a SQL function an unqualified `code` is the
-- column, and `c.code = code` was true of every row.
create or replace function tests.edition(code text, label text)
returns uuid
language sql
stable
security definer
as $$
  select e.edition_id from public.course_edition e
  join public.course c on c.course_id = e.course_id
  where c.code = $1 and e.label = $2
$$;

create or replace function tests.project(slug text)
returns uuid
language sql
stable
security definer
as $$
  select project_id from public.project p where p.slug = $1
$$;

-- Run the rest of the transaction as this account, the way the Worker does
-- for a request: the `authenticated` role, and the claims a JWT would carry.
-- Not security definer: Postgres forbids changing `role` inside one.
create or replace function tests.authenticate(uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end
$$;

-- Back to the test's own role, for setup between two people's turns.
create or replace function tests.clear_auth()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end
$$;

-- Run the rest of the transaction as the publisher, the way a token request does.
create or replace function tests.as_publisher()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'yukibana_publisher', true);
end
$$;
