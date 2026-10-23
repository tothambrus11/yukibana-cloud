-- Moodle (or any LTI 1.3 platform) as the source of an edition's roster.
--
-- PROTOTYPE (2026-10): written to evaluate roster sync against a local
-- Moodle 5.1; see docs/moodle-sync.md for what was tried and what is still
-- an open decision. Not to be deployed as it stands.
--
-- The registry is an LTI 1.3 tool. An admin registers a platform (one
-- Moodle site: its issuer, the client id Moodle assigned us, its endpoints).
-- A teacher launches Yukibana from their Moodle course as Instructor; the
-- launch carries the course (the LTI "context") and the Names and Role
-- Provisioning Service (NRPS) address of its member list. The Worker
-- verifies the launch and hands the teacher a link grant, and the teacher,
-- logged in to Yukibana as an owner, spends it on one of their editions.
-- From then on the Worker fetches the member list from Moodle and this
-- migration's `app.apply_lti_roster` makes the edition's `source = 'sis'`
-- enrolments match it.
--
-- Why a grant and not just "owner links edition to context": the link is
-- what decides whose names and addresses flow into an edition. Were it a
-- plain owner action, any teacher who owns any edition could name any
-- Moodle course and read its roster through their own edition. The grant
-- can only be made by the role that verified an Instructor launch from that
-- very course, so the database, not the Worker, decides that the person
-- linking was a teacher there.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- The role an LTI request gets: a launch, a roster fetch, a change hint.
-- Like the publisher, it has no table grant at all, only the functions
-- below, and is granted to the Worker's connection role so `db.ts` can
-- become it for one transaction.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'yukibana_lti') then
    create role yukibana_lti nologin nobypassrls noinherit;
  end if;
end
$$;
grant yukibana_lti to yukibana_app;
grant usage on schema app to yukibana_lti;

-- One LTI registration on one platform. For Moodle, an "External tool" an
-- administrator configured as LTI 1.3: Moodle chooses the client id and
-- the deployment id (the tool type's id) and shows both on the tool's
-- "View configuration details" page, along with the endpoints below.
create table public.lti_platform (
  platform_id   uuid primary key default app.uuidv7(),
  -- The `iss` of every token the platform signs. For Moodle, its wwwroot.
  issuer        text not null,
  client_id     text not null,
  -- A registration can have several deployments; Moodle makes one per tool
  -- type, and a site-wide tool is the only shape this prototype expects.
  deployment_id text not null,
  name          text not null,
  -- Where a launch's OIDC login is sent, where a service token is asked
  -- for, and where the keys that sign launches are published.
  auth_url      text not null,
  token_url     text not null,
  jwks_url      text not null,
  created_at    timestamptz not null default now(),
  unique (issuer, client_id)
);

-- One edition taught in one Moodle course. Both are unique: a Moodle course
-- is one term's class, and so is an edition. A course that serves two
-- editions (or the other way round) is a case nobody has asked for, and
-- the uniqueness keeps the removal rule below meaning something.
create table public.lti_link (
  link_id         uuid primary key default app.uuidv7(),
  edition_id      uuid not null unique references public.course_edition (edition_id) on delete cascade,
  platform_id     uuid not null references public.lti_platform (platform_id) on delete cascade,
  -- The LTI context id. For Moodle, the course's numeric id as a string.
  context_id      text not null,
  -- What Moodle called the course at the last launch, for staff to see
  -- which course this is without opening Moodle.
  context_title   text not null,
  -- The NRPS endpoint from the launch. For Moodle it is stable for the
  -- course and tool type, and a later launch refreshes it.
  memberships_url text not null,
  -- Null only once the account that linked it is deleted.
  linked_by       uuid references public.app_user (user_id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (platform_id, context_id)
);

-- A verified Instructor launch waiting to be spent on an edition. The
-- secret lives only in the teacher's browser; this holds its hash.
create table public.lti_link_grant (
  grant_hash      bytea primary key,
  platform_id     uuid not null references public.lti_platform (platform_id) on delete cascade,
  context_id      text not null,
  context_title   text not null,
  memberships_url text not null,
  expires_at      timestamptz not null
);

-- Every sync that reached the database, for staff to see that it ran and
-- what it changed. A fetch that failed never gets here: the Worker reports
-- it, and the roster stays as the last good sync left it.
create table public.lti_sync_run (
  run_id   uuid primary key default app.uuidv7(),
  link_id  uuid not null references public.lti_link (link_id) on delete cascade,
  at       timestamptz not null default now(),
  -- What started it: 'launch', 'hint', 'schedule' or 'manual'.
  trigger  text not null check (trigger in ('launch', 'hint', 'schedule', 'manual')),
  members  bigint not null,
  added    bigint not null,
  updated  bigint not null,
  removed  bigint not null
);
create index lti_sync_run_by_link on public.lti_sync_run (link_id, at desc);

alter table public.lti_platform   enable row level security;
alter table public.lti_link       enable row level security;
alter table public.lti_link_grant enable row level security;
alter table public.lti_sync_run   enable row level security;
revoke all on public.lti_platform, public.lti_link, public.lti_link_grant, public.lti_sync_run
  from public, anon, authenticated;

-- Admins see the platforms; staff see their edition's link and its runs.
-- Students see none of it: where their roster comes from is not theirs.
create policy lti_platform_read on public.lti_platform for select to authenticated using (app.is_admin());
create policy lti_link_read on public.lti_link for select to authenticated using (app.is_staff(edition_id));
create policy lti_sync_run_read on public.lti_sync_run for select to authenticated
  using (exists (select 1 from public.lti_link l where l.link_id = lti_sync_run.link_id and app.is_staff(l.edition_id)));
grant select on public.lti_platform, public.lti_link, public.lti_sync_run to authenticated;

-- Admin action. Registers a platform, or updates the one with the same
-- issuer and client id (Moodle's endpoints do not move, but a site can).
create or replace function app.register_lti_platform(
  issuer text, client_id text, deployment_id text, name text,
  auth_url text, token_url text, jwks_url text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid uuid;
begin
  if not app.is_admin() then
    raise exception 'only an admin may register an LTI platform' using errcode = '42501';
  end if;
  insert into public.lti_platform (issuer, client_id, deployment_id, name, auth_url, token_url, jwks_url)
  values (issuer, client_id, deployment_id, name, auth_url, token_url, jwks_url)
  on conflict on constraint lti_platform_issuer_client_id_key do update
    set deployment_id = excluded.deployment_id, name = excluded.name,
        auth_url = excluded.auth_url, token_url = excluded.token_url, jwks_url = excluded.jwks_url
  returning platform_id into pid;
  perform app.audit('register_lti_platform', jsonb_build_object('platform_id', pid, 'issuer', issuer, 'client_id', client_id));
  return pid;
end
$$;

-- LTI role. The platform a launch claims to come from, by the token's
-- `iss` and `aud`, before anything in the token is believed: its keys are
-- what the Worker verifies the token with. Holds nothing secret.
create or replace function app.lti_platform_for(issuer text, client_id text)
returns table (platform_id uuid, deployment_id text, auth_url text, token_url text, jwks_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.platform_id, p.deployment_id, p.auth_url, p.token_url, p.jwks_url
  from public.lti_platform p
  where p.issuer = lti_platform_for.issuer and p.client_id = lti_platform_for.client_id
$$;

-- What a sync needs to know about a link, and when it last ran (null:
-- never). One row per link, through either of the two functions below.
create type app.lti_sync_target as (
  link_id         uuid,
  edition_id      uuid,
  issuer          text,
  client_id       text,
  token_url       text,
  memberships_url text,
  last_run        timestamptz
);

-- LTI role. The link for one Moodle course, if any. A launch asks this to
-- send its person to the right edition, and a change hint asks it to know
-- what to sync. A launch also refreshes the title and NRPS address, which
-- are the platform's to change.
create or replace function app.lti_target_for(platform uuid, context text, title text default null, memberships text default null)
returns setof app.lti_sync_target
language plpgsql
security definer
set search_path = ''
as $$
begin
  if title is not null or memberships is not null then
    update public.lti_link
    set context_title = coalesce(title, context_title), memberships_url = coalesce(memberships, memberships_url)
    where platform_id = platform and context_id = context;
  end if;
  return query
    select l.link_id, l.edition_id, p.issuer, p.client_id, p.token_url, l.memberships_url,
           (select max(r.at) from public.lti_sync_run r where r.link_id = l.link_id)
    from public.lti_link l join public.lti_platform p using (platform_id)
    where l.platform_id = platform and l.context_id = context;
end
$$;

-- LTI role. The same for a link by its id: what the edition page's "sync
-- now" asks after the person's own policies showed them the link, which
-- only its staff can see.
create or replace function app.lti_target_by_link(link uuid)
returns setof app.lti_sync_target
language sql
stable
security definer
set search_path = ''
as $$
  select l.link_id, l.edition_id, p.issuer, p.client_id, p.token_url, l.memberships_url,
         (select max(r.at) from public.lti_sync_run r where r.link_id = l.link_id)
  from public.lti_link l join public.lti_platform p using (platform_id)
  where l.link_id = link
$$;

-- LTI role. Every link not synced for `max_age`, for the scheduled sync.
create or replace function app.lti_targets_due(max_age interval)
returns setof app.lti_sync_target
language sql
stable
security definer
set search_path = ''
as $$
  select * from (
    select l.link_id, l.edition_id, p.issuer, p.client_id, p.token_url, l.memberships_url,
           (select max(r.at) from public.lti_sync_run r where r.link_id = l.link_id) as last_run
    from public.lti_link l join public.lti_platform p using (platform_id)
  ) t
  where t.last_run is null or t.last_run < now() - max_age
$$;

-- LTI role. Records a verified Instructor launch from `context` as a grant
-- that lasts fifteen minutes. The Worker calls this only after checking the
-- launch's signature, deployment and Instructor role; the grant is what
-- carries that check into `app.link_edition_to_lti`.
create or replace function app.grant_lti_link(grant_hash bytea, platform uuid, context text, title text, memberships text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.lti_link_grant where expires_at < now();
  insert into public.lti_link_grant (grant_hash, platform_id, context_id, context_title, memberships_url, expires_at)
  values (grant_hash, platform, context, title, memberships, now() + interval '15 minutes');
$$;

-- Owner action. Spends a grant on `edition`: from now on its Moodle course
-- is the one the grant came from. A course already linked to another
-- edition is refused (unique), and so is an edition already linked to
-- another course; unlinking first is deliberate.
create or replace function app.link_edition_to_lti(edition uuid, grant_hash bytea)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  g   public.lti_link_grant%rowtype;
  lid uuid;
begin
  if app.role_in(edition) is distinct from 'owner' then
    raise exception 'only an owner may link an edition to a Moodle course' using errcode = '42501';
  end if;
  delete from public.lti_link_grant lg
  where lg.grant_hash = link_edition_to_lti.grant_hash
  returning * into g;
  if g.grant_hash is null or g.expires_at < now() then
    raise exception 'this link has expired; launch Yukibana from the Moodle course again' using errcode = '42501';
  end if;
  insert into public.lti_link (edition_id, platform_id, context_id, context_title, memberships_url, linked_by)
  values (edition, g.platform_id, g.context_id, g.context_title, g.memberships_url, (select auth.uid()))
  returning link_id into lid;
  perform app.audit('link_edition_to_lti', jsonb_build_object(
    'edition_id', edition, 'link_id', lid, 'platform_id', g.platform_id, 'context_id', g.context_id));
  return lid;
end
$$;

-- Owner action. The edition stops following Moodle. Its `sis` enrolments
-- stay as they are, and from now on change only by hand.
create or replace function app.unlink_edition_from_lti(edition uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.role_in(edition) is distinct from 'owner' then
    raise exception 'only an owner may unlink an edition' using errcode = '42501';
  end if;
  delete from public.lti_link where edition_id = edition;
  if not found then
    raise exception 'this edition is not linked' using errcode = 'P0002';
  end if;
  perform app.audit('unlink_edition_from_lti', jsonb_build_object('edition_id', edition));
end
$$;

-- The member list as rows: one per address, lowercased, members without an
-- address left out (Moodle sends none when the tool is not allowed to see
-- addresses, and an address is what an enrolment is). An address listed
-- twice keeps its higher role.
create or replace function app.lti_roster_rows(members jsonb)
returns table (email text, role app.edition_role)
language sql
immutable
set search_path = ''
as $$
  select distinct on (lower(m ->> 'email')) lower(m ->> 'email'), (m ->> 'role')::app.edition_role
  from jsonb_array_elements(members) m
  where coalesce(m ->> 'email', '') <> ''
  order by lower(m ->> 'email'), (m ->> 'role') = 'assistant' desc
$$;

-- LTI role. Makes the edition's `sis` enrolments match `members`, the
-- whole member list as NRPS returned it, mapped to edition roles by the
-- Worker: a JSON array of {"email": text, "role": "student"|"assistant"}.
--
-- The rules, which are the open decisions in docs/moodle-sync.md taken the
-- cautious way:
--  * Only `source = 'sis'` rows are the sync's. An address someone enrolled
--    by hand stays as they made it, role included, even when Moodle says
--    otherwise or nothing at all.
--  * The sync never makes or touches an owner. Moodle's Instructor is an
--    assistant here; an owner is someone a Yukibana owner chose. An `sis`
--    row an owner promoted to owner is left alone from then on.
--  * Someone gone from Moodle is unenrolled, as `app.unenrol` would: their
--    submissions stay. NRPS lists only active enrolments, so a suspended
--    student or one whose enrolment ended goes too, and comes back with
--    their submissions visible again when Moodle lists them again.
--  * An empty list removes nobody. A Moodle course always lists at least
--    the teacher who linked it, so empty means a broken fetch, and a broken
--    fetch must never empty a class. The Worker also never calls this with
--    a partial list (it follows every page or gives up).
create or replace function app.apply_lti_roster(link uuid, members jsonb, trigger text)
returns table (added integer, updated integer, removed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  ed uuid;
  n_added integer;
  n_updated integer;
  n_removed integer;
  n_members integer;
begin
  select l.edition_id into ed from public.lti_link l where l.link_id = link;
  if ed is null then
    raise exception 'no such link' using errcode = 'P0002';
  end if;
  if jsonb_typeof(members) <> 'array' or jsonb_array_length(members) = 0 then
    raise exception 'an empty roster removes nobody; refusing it' using errcode = '22023';
  end if;

  if exists (select 1 from app.lti_roster_rows(members) r where r.role not in ('student', 'assistant')) then
    raise exception 'a roster grants only student or assistant' using errcode = '42501';
  end if;
  select count(*) into n_members from app.lti_roster_rows(members);

  insert into public.enrollment (edition_id, email, role, source, user_id)
  select ed, r.email, r.role, 'sis',
         (select u.id from auth.users u where lower(u.email) = r.email and u.email_confirmed_at is not null)
  from app.lti_roster_rows(members) r
  on conflict (edition_id, email) do nothing;
  get diagnostics n_added = row_count;

  update public.enrollment e set role = r.role
  from app.lti_roster_rows(members) r
  where e.edition_id = ed and e.email = r.email and e.source = 'sis'
    and e.role <> 'owner' and e.role <> r.role;
  get diagnostics n_updated = row_count;

  delete from public.enrollment e
  where e.edition_id = ed and e.source = 'sis' and e.role <> 'owner'
    and not exists (select 1 from app.lti_roster_rows(members) r where r.email = e.email);
  get diagnostics n_removed = row_count;

  insert into public.lti_sync_run (link_id, trigger, members, added, updated, removed)
  values (link, apply_lti_roster.trigger, n_members, n_added, n_updated, n_removed);
  if n_added + n_updated + n_removed > 0 then
    perform app.audit('apply_lti_roster', jsonb_build_object(
      'edition_id', ed, 'link_id', link, 'trigger', apply_lti_roster.trigger,
      'added', n_added, 'updated', n_updated, 'removed', n_removed));
  end if;
  return query select n_added, n_updated, n_removed;
end
$$;

revoke execute on function app.lti_platform_for(text, text) from public, anon, authenticated;
revoke execute on function app.lti_target_for(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function app.lti_target_by_link(uuid) from public, anon, authenticated;
revoke execute on function app.lti_targets_due(interval) from public, anon, authenticated;
revoke execute on function app.grant_lti_link(bytea, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function app.apply_lti_roster(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function app.lti_roster_rows(jsonb) from public, anon, authenticated;
grant execute on function app.lti_platform_for(text, text) to yukibana_lti;
grant execute on function app.lti_target_for(uuid, text, text, text) to yukibana_lti;
grant execute on function app.lti_target_by_link(uuid) to yukibana_lti;
grant execute on function app.lti_targets_due(interval) to yukibana_lti;
grant execute on function app.grant_lti_link(bytea, uuid, text, text, text) to yukibana_lti;
grant execute on function app.apply_lti_roster(uuid, jsonb, text) to yukibana_lti;
