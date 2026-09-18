-- Projects: an assignment in one edition, built from a GitHub repository into
-- a starter archive students download.

-- Supabase runs each migration in one transaction; these bound how long it
-- may wait for a lock or run, so a deploy that would block the site fails
-- instead, and is retried when the table is quiet.
set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- A GitHub App installation someone connected. The installation is what the
-- builder mints tokens for; it is scoped by GitHub to the repositories the
-- installer chose, never wider.
create table public.github_installation (
  installation_id bigint primary key,
  account_login   text not null,        -- the org or user it was installed on
  installed_by    uuid not null references public.app_user (user_id) on delete restrict,
  created_at      timestamptz not null default now(),
  -- Set when GitHub says the app was uninstalled. The row stays so a project
  -- can say why its builds stopped rather than failing on a missing key.
  removed_at      timestamptz
);

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

  github_installation_id bigint references public.github_installation (installation_id) on delete set null,
  github_repo_id         bigint,       -- numeric: survives a rename
  github_repo_full_name  text,         -- 'org/repo' at the time it was chosen, refreshed by webhooks
  github_ref             text not null default 'main',

  created_by   uuid not null references public.app_user (user_id) on delete restrict,
  created_at   timestamptz not null default now(),
  unique (edition_id, slug),
  -- Lets `submission` reference both columns at once, so a submission can only
  -- ever name a project of the edition it claims.
  unique (edition_id, project_id)
);
create index project_by_repo on public.project (github_repo_id) where github_repo_id is not null;

-- One row per attempt to build a starter. The latest succeeded row is what
-- students download. `log` is for staff: it may name the hidden paths it
-- removed, which is exactly why students read through `app.current_starter`
-- instead of this table.
create table public.project_build (
  build_id     uuid primary key default app.uuidv7(),
  project_id   uuid not null references public.project (project_id) on delete cascade,
  commit_sha   text,
  status       app.build_status not null default 'queued',
  log          text not null default '',
  starter_key  text,                    -- the archive students get
  snapshot_key text,                    -- the whole repository at that commit, hidden tests included
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index project_build_latest on public.project_build (project_id, started_at desc);

-- GitHub retries deliveries it thinks failed. Each carries a unique id; the
-- webhook route inserts it here first and a duplicate is answered 200 and
-- ignored, so a retry never builds twice.
create table public.github_delivery (
  delivery_id  uuid primary key,
  received_at  timestamptz not null default now()
);

alter table public.github_installation enable row level security;
alter table public.project              enable row level security;
alter table public.project_build        enable row level security;
alter table public.github_delivery      enable row level security;
revoke all on public.github_installation, public.project, public.project_build, public.github_delivery
  from public, anon, authenticated;

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

-- The key of the starter a student may download right now, or null. The only
-- path from a student to `project_build`, and it reads nothing but the key.
create or replace function app.current_starter(project uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select b.starter_key
  from public.project p
  join public.project_build b on b.project_id = p.project_id
  where p.project_id = project
    and b.status = 'succeeded'
    and b.starter_key is not null
    and (app.is_staff(p.edition_id) or app.project_open(p.edition_id, p.available_after))
  order by b.started_at desc
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

-- Builds: staff read them; the builder writes them (see roles migration).
create policy project_build_read on public.project_build for select to authenticated using (
  exists (select 1 from public.project p where p.project_id = project_build.project_id and app.is_staff(p.edition_id))
);

-- An owner asks for a rebuild by queueing a row; the Worker picks it up.
create policy project_build_queue on public.project_build for insert to authenticated with check (
  status = 'queued'
  and exists (select 1 from public.project p where p.project_id = project_build.project_id and app.role_in(p.edition_id) = 'owner')
);

-- Installations: whoever installed it, and admins.
create policy installation_read on public.github_installation for select to authenticated using (
  installed_by = (select auth.uid()) or app.is_admin()
);
create policy installation_insert on public.github_installation for insert to authenticated with check (
  installed_by = (select auth.uid())
);

grant select on public.project, public.project_build, public.github_installation to authenticated;
grant insert, delete on public.project to authenticated;
-- The columns an owner may change. `edition_id`, `project_id`, `created_by`
-- and `created_at` are not among them.
grant update (title, kind, available_after, deadline, github_installation_id,
              github_repo_id, github_repo_full_name, github_ref) on public.project to authenticated;
grant insert (project_id, status) on public.project_build to authenticated;
grant insert on public.github_installation to authenticated;
