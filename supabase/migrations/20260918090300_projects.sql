-- Projects: an assignment in one edition, published as releases.
--
-- The cloud is a registry. It never reads a repository or transforms one:
-- the starter students download and the teacher archive (the whole project,
-- hidden tests included) are built beforehand, by the CLI in a teacher's
-- own CI or on their machine, and uploaded as two artifacts. Keeping the
-- transformation out of here is what keeps the Worker within a free plan's
-- CPU allowance, and keeps a teacher's repository their own business.

-- Supabase runs each migration in one transaction; these bound how long it
-- may wait for a lock or run, so a deploy that would block the site fails
-- instead, and is retried when the table is quiet.
set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- For hashing upload tokens. Supabase ships it; the schema is theirs.
create extension if not exists pgcrypto with schema extensions;

create table public.project (
  project_id   uuid primary key default app.uuidv7(),
  edition_id   uuid not null references public.course_edition (edition_id) on delete cascade,
  -- The folder name in the starter archive and the path segment in a URL.
  slug         text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  title        text not null,
  kind         app.project_kind not null,
  -- Null means draft: students cannot see the project at all. Only a set date
  -- publishes it, so nothing leaks before a teacher decides.
  available_after timestamptz,
  -- Null means no deadline. Past it, submissions are refused; a late window
  -- is a later column, not a later interpretation of this one.
  deadline     timestamptz,
  check (deadline is null or available_after is null or deadline > available_after),
  created_by   uuid not null references public.app_user (user_id) on delete restrict,
  created_at   timestamptz not null default now(),
  unique (edition_id, slug),
  -- Lets `submission` reference both columns at once, so a submission can only
  -- ever name a project of the edition it claims.
  unique (edition_id, project_id)
);

-- One row per upload of the pair. The newest is what students download.
-- Rows are never changed: a wrong release is followed by a right one, and
-- the history says what was live when.
create table public.project_release (
  release_id     uuid primary key default app.uuidv7(),
  project_id     uuid not null references public.project (project_id) on delete cascade,
  -- Whatever the uploader said: a version, a commit, "fixed the typo".
  label          text not null default '',
  commit_sha     text,
  starter_key    text not null unique,
  starter_size   bigint not null check (starter_size > 0),
  starter_sha256 bytea not null check (octet_length(starter_sha256) = 32),
  -- The whole project, hidden tests included. Staff only, ever.
  teacher_key    text not null unique,
  teacher_size   bigint not null check (teacher_size > 0),
  teacher_sha256 bytea not null check (octet_length(teacher_sha256) = 32),
  -- The person, or the person whose token, uploaded it.
  uploaded_by    uuid not null references public.app_user (user_id) on delete restrict,
  -- Null for a manual upload; the token otherwise.
  token_id       uuid,
  uploaded_at    timestamptz not null default now()
);
create index project_release_latest on public.project_release (project_id, uploaded_at desc);

-- A secret that lets a CI job publish releases to one project and do nothing
-- else. Only its hash is kept; the secret is shown once when made. A leak
-- costs one project's release history, which staff can see and follow with
-- a new release, and the token is revoked from the project page.
create table public.project_token (
  token_id    uuid primary key default app.uuidv7(),
  project_id  uuid not null references public.project (project_id) on delete cascade,
  token_hash  bytea not null unique check (octet_length(token_hash) = 32),
  label       text not null default '',
  created_by  uuid not null references public.app_user (user_id) on delete restrict,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at  timestamptz
);

alter table public.project         enable row level security;
alter table public.project_release enable row level security;
alter table public.project_token   enable row level security;
revoke all on public.project, public.project_release, public.project_token from public, anon, authenticated;

-- Whether the caller, as a student, may see a project now.
create or replace function app.project_open(edition uuid, available_after timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.role_in(edition) = 'student'
     and available_after is not null
     and available_after <= now()
$$;

-- The key of the starter a student may download right now, or null: the
-- newest release of a project they may see. The only path from a student to
-- `project_release`, and it reads nothing but the key.
create or replace function app.current_starter(project uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.starter_key
  from public.project p
  join public.project_release r on r.project_id = p.project_id
  where p.project_id = project
    and (app.is_staff(p.edition_id) or app.project_open(p.edition_id, p.available_after))
  -- Two uploads in one transaction share `uploaded_at`; the id breaks the tie.
  order by r.uploaded_at desc, r.release_id desc
  limit 1
$$;

-- Reads: staff see every project of their editions; students see published
-- ones once their date has passed.
create policy project_read on public.project for select to authenticated using (
  app.is_staff(edition_id) or app.project_open(edition_id, available_after)
);

-- Writes: owners. `created_by` must be the caller; the trigger below makes it
-- so rather than trusting the client to say so.
create policy project_insert on public.project for insert to authenticated with check (
  app.role_in(edition_id) = 'owner'
);
create policy project_update on public.project for update to authenticated
  using (app.role_in(edition_id) = 'owner')
  with check (app.role_in(edition_id) = 'owner');
create policy project_delete on public.project for delete to authenticated using (
  app.role_in(edition_id) = 'owner'
);

create or replace function app.stamp_project()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := (select auth.uid());
  new.created_at := now();
  return new;
end
$$;
revoke execute on function app.stamp_project() from public, anon, authenticated;
create trigger project_stamp before insert on public.project
  for each row execute function app.stamp_project();

-- Releases: staff read them. Writes go through the two functions below.
create policy release_read on public.project_release for select to authenticated using (
  exists (select 1 from public.project p where p.project_id = project_release.project_id and app.is_staff(p.edition_id))
);

-- Tokens: owners see their project's tokens (never the hash: it is not in
-- the grant). Creation and revocation are functions.
create policy token_read on public.project_token for select to authenticated using (
  exists (select 1 from public.project p where p.project_id = project_token.project_id and app.role_in(p.edition_id) = 'owner')
);

grant select on public.project, public.project_release to authenticated;
grant select (token_id, project_id, label, created_by, created_at, last_used_at, revoked_at) on public.project_token to authenticated;
grant insert, delete on public.project to authenticated;
-- The columns an owner may change. `edition_id`, `project_id`, `created_by`
-- and `created_at` are not among them.
grant update (title, kind, available_after, deadline) on public.project to authenticated;

-- Owner action, from the project page: a manual upload of the two archives
-- the Worker has already stored. Returns the release id.
create or replace function app.publish_release(
  project uuid, label text, commit_sha text,
  starter_key text, starter_size bigint, starter_sha256 bytea,
  teacher_key text, teacher_size bigint, teacher_sha256 bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid;
begin
  if not exists (select 1 from public.project p where p.project_id = project and app.role_in(p.edition_id) = 'owner') then
    raise exception 'only an owner may publish a release' using errcode = '42501';
  end if;
  insert into public.project_release (project_id, label, commit_sha, starter_key, starter_size, starter_sha256,
                                      teacher_key, teacher_size, teacher_sha256, uploaded_by)
  values (project, label, commit_sha, starter_key, starter_size, starter_sha256,
          teacher_key, teacher_size, teacher_sha256, (select auth.uid()))
  returning release_id into rid;
  perform app.audit('publish_release', jsonb_build_object('project_id', project, 'release_id', rid, 'label', label));
  return rid;
end
$$;

-- Owner action: a new token for CI. Returns the secret, once. The database
-- keeps the hash; the Worker hashes what it receives and looks that up.
create or replace function app.create_project_token(project uuid, label text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  if not exists (select 1 from public.project p where p.project_id = project and app.role_in(p.edition_id) = 'owner') then
    raise exception 'only an owner may create a token' using errcode = '42501';
  end if;
  -- 256 bits from two v4 uuids; the prefix lets a leak scanner recognise it.
  secret := 'yk_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.project_token (project_id, token_hash, label, created_by)
  values (project, extensions.digest(secret, 'sha256'), label, (select auth.uid()));
  perform app.audit('create_project_token', jsonb_build_object('project_id', project, 'label', label));
  return secret;
end
$$;

create or replace function app.revoke_project_token(token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.project_token t set revoked_at = coalesce(t.revoked_at, now())
  where t.token_id = token
    and exists (select 1 from public.project p where p.project_id = t.project_id and app.role_in(p.edition_id) = 'owner');
  if not found then
    raise exception 'no such token, or not an owner' using errcode = '42501';
  end if;
  perform app.audit('revoke_project_token', jsonb_build_object('token_id', token));
end
$$;

-- The project a token hash names, or null when it is unknown or revoked.
-- What the upload route asks before accepting bytes. Runs as the publisher
-- role (see the connection roles migration); nobody logged in can call it.
create or replace function app.project_for_token(token_hash bytea)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select project_id from public.project_token
  where project_token.token_hash = project_for_token.token_hash and revoked_at is null
$$;

-- The publisher's write: a release on behalf of whoever made the token. The
-- hash is checked again here, so a route cannot publish with a bad token by
-- skipping the question above.
create or replace function app.publish_release_with_token(
  token_hash bytea, label text, commit_sha text,
  starter_key text, starter_size bigint, starter_sha256 bytea,
  teacher_key text, teacher_size bigint, teacher_sha256 bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t   public.project_token%rowtype;
  rid uuid;
begin
  select * into t from public.project_token pt
  where pt.token_hash = publish_release_with_token.token_hash and pt.revoked_at is null;
  if t.token_id is null then
    raise exception 'unknown or revoked token' using errcode = '42501';
  end if;
  insert into public.project_release (project_id, label, commit_sha, starter_key, starter_size, starter_sha256,
                                      teacher_key, teacher_size, teacher_sha256, uploaded_by, token_id)
  values (t.project_id, label, commit_sha, starter_key, starter_size, starter_sha256,
          teacher_key, teacher_size, teacher_sha256, t.created_by, t.token_id)
  returning release_id into rid;
  update public.project_token set last_used_at = now() where token_id = t.token_id;
  insert into public.audit_log (actor, action, subject)
  values (t.created_by, 'publish_release', jsonb_build_object('project_id', t.project_id, 'release_id', rid, 'label', label, 'token_id', t.token_id));
  return rid;
end
$$;

revoke execute on function app.project_for_token(bytea) from public, anon, authenticated;
revoke execute on function app.publish_release_with_token(bytea, text, text, text, bigint, bytea, text, bigint, bytea)
  from public, anon, authenticated;
