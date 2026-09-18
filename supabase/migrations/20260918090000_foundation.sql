-- The ground everything else stands on: the `app` schema for functions, the
-- enumerations, and an id generator. Tables live in `public` so Studio shows
-- them where people look; functions live in `app` so nothing in `public` is
-- callable by accident.
--
-- Every object here is created by a migration and only by a migration. The
-- dashboard is read-only; see CLAUDE.md.

-- Supabase runs each migration in one transaction; these bound how long it
-- may wait for a lock or run, so a deploy that would block the site fails
-- instead, and is retried when the table is quiet.
set local lock_timeout = '10s';
set local statement_timeout = '5min';

create schema if not exists app;

-- Time-ordered ids. Sequential integers leak volume and order even when RLS
-- hides the rows; random uuids scatter an index. UUIDv7 is both private and
-- index-friendly. Postgres 18 has this built in; Supabase runs 17, so it is
-- written here rather than waited for. The first 48 bits are the Unix time in
-- milliseconds, then the version nibble, then random bits from a v4 uuid, with
-- the variant bits set as RFC 9562 asks.
create or replace function app.uuidv7()
returns uuid
language sql
volatile
set search_path = ''
as $$
  select encode(
    set_bit(set_bit(set_bit(set_bit(set_bit(set_bit(
      overlay(
        uuid_send(gen_random_uuid())
        placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
        from 1 for 6
      ),
      55, 0), 54, 1), 53, 1), 52, 1),  -- version 0111 in the high nibble of byte 6
      71, 1), 70, 0),                   -- variant 10 in the high bits of byte 8
    'hex')::uuid
$$;

-- Who someone is to the platform, as opposed to who they are in an edition.
-- `teacher` may create courses and editions; `admin` may make teachers. An
-- admin is not implicitly staff of anything: to see an edition they enrol in
-- it, and that shows in its roster like anyone else.
create type app.platform_role as enum ('user', 'teacher', 'admin');

-- Who someone is within one course edition.
create type app.edition_role as enum ('student', 'assistant', 'owner');

-- Which system wrote an enrolment row, so a roster sync later knows which rows
-- are its own to delete and which a person added by hand.
create type app.enrol_source as enum ('manual', 'sis');

-- The build systems the starter pipeline understands. Adding one is a
-- migration here and a defaults object in app/src/lib/yukibana.ts.
create type app.project_kind as enum ('rust-cargo', 'scala-sbt');

create type app.build_status as enum ('queued', 'building', 'succeeded', 'failed');

-- Anything that changes who may do what leaves a row. Written only by the
-- security-definer functions that make those changes; read only by admins.
create table public.audit_log (
  id      uuid primary key default app.uuidv7(),
  at      timestamptz not null default now(),
  actor   uuid,                       -- null for a change made by the system
  action  text not null,              -- 'enrol', 'set_platform_role', ...
  subject jsonb not null default '{}' -- what it was done to, as the function saw it
);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon, authenticated;

create or replace function app.audit(action text, subject jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor, action, subject)
  values ((select auth.uid()), action, subject);
$$;
revoke execute on function app.audit(text, jsonb) from public, anon, authenticated;

grant usage on schema app to anon, authenticated;
