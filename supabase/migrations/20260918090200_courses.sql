-- Courses, their editions, and who is in them.
--
-- A course is a name that groups editions; almost everything hangs off an
-- edition. A new edition is usually a copy of the last one (projects and
-- staff, not students), which is what `app.duplicate_edition` does.

-- Supabase runs each migration in one transaction; these bound how long it
-- may wait for a lock or run, so a deploy that would block the site fails
-- instead, and is retried when the table is quiet.
set local lock_timeout = '10s';
set local statement_timeout = '5min';

create table public.course (
  course_id  uuid primary key default app.uuidv7(),
  code       text not null unique,   -- 'CS-101': what the catalogue calls it
  title      text not null,
  created_by uuid references public.app_user (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.course_edition (
  edition_id  uuid primary key default app.uuidv7(),
  course_id   uuid not null references public.course (course_id) on delete cascade,
  label       text not null,          -- '2026 autumn'
  -- An archived edition stays readable but is no longer where anyone works;
  -- a student's list shows live editions first. Archiving is reversible.
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (course_id, label)
);

-- One table for "expected" and "present". A row with `user_id` null is an
-- address staff enrolled before that person ever logged in; the trigger in
-- this file fills it in at their first confirmed login. Roster feeds produce
-- exactly (edition, address, role), so this upserts against them cleanly.
create table public.enrollment (
  edition_id uuid not null references public.course_edition (edition_id) on delete cascade,
  -- Always lowercase, so equality is equality. (citext would do this, but
  -- its `=` lives in the extensions schema and every function here runs
  -- with an empty search_path, where it silently becomes text equality.)
  email      text not null check (email = lower(email)),
  role       app.edition_role not null default 'student',
  source     app.enrol_source not null default 'manual',
  user_id    uuid references public.app_user (user_id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (edition_id, email)
);
create index enrollment_by_user on public.enrollment (user_id, edition_id) where user_id is not null;
create index enrollment_unlinked on public.enrollment (email) where user_id is null;

alter table public.course         enable row level security;
alter table public.course_edition enable row level security;
alter table public.enrollment     enable row level security;
revoke all on public.course, public.course_edition, public.enrollment from public, anon, authenticated;

-- The caller's role in an edition, or null. Security definer because a policy
-- on `enrollment` that read `enrollment` would recurse into itself.
create or replace function app.role_in(edition uuid)
returns app.edition_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.enrollment
  where edition_id = edition and user_id = (select auth.uid())
$$;

create or replace function app.is_staff(edition uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(app.role_in(edition) in ('assistant', 'owner'), false)
$$;

-- Whether the caller and `other` are both in some edition. Security definer
-- because a policy that read `enrollment` directly would see it through the
-- caller's own policy, which shows a student only their own row.
create or replace function app.shares_edition(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.enrollment mine
    join public.enrollment theirs on theirs.edition_id = mine.edition_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = other
  )
$$;

-- Link every enrolment waiting on `addr` to the account `uid`. Idempotent:
-- called at every confirmed login, and a second call finds nothing to do.
create or replace function app.link_enrollments(uid uuid, addr text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.enrollment set user_id = uid
  where email = lower(addr) and user_id is null;
  get diagnostics n = row_count;
  return n;
end
$$;
revoke execute on function app.link_enrollments(uuid, text) from public, anon, authenticated;

-- Runs as supabase_auth_admin whenever Auth creates or changes an account.
-- Keeps the profile in step and links enrolments once the address is
-- confirmed. GitHub logins arrive confirmed; a provider that does not confirm
-- addresses leaves `email_confirmed_at` null and nothing links, which is the
-- point: an unverified address must never open a class.
create or replace function app.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_user (user_id, full_name, github_login)
  values (
    new.id,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    lower(nullif(coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'preferred_username'), ''))
  )
  on conflict (user_id) do update
    set full_name    = coalesce(excluded.full_name, public.app_user.full_name),
        github_login = coalesce(excluded.github_login, public.app_user.github_login);

  if new.email_confirmed_at is not null and new.email is not null then
    perform app.link_enrollments(new.id, new.email);
  end if;
  return new;
end
$$;

revoke execute on function app.handle_auth_user() from public, anon, authenticated;

create trigger on_auth_user_changed
  after insert or update of email, email_confirmed_at, raw_user_meta_data on auth.users
  for each row execute function app.handle_auth_user();

-- Teacher action. The course and its audit row, nothing else: an edition is a
-- separate step because a course is only a name.
create or replace function app.create_course(code text, title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  if not app.is_teacher() then
    raise exception 'only a teacher may create a course' using errcode = '42501';
  end if;
  insert into public.course (code, title, created_by)
  values (code, title, (select auth.uid()))
  returning course_id into cid;
  perform app.audit('create_course', jsonb_build_object('course_id', cid, 'code', code));
  return cid;
end
$$;

-- Teacher action. The edition and its first owner grant in one transaction:
-- straight after the insert the creator has no enrolment row, so RLS would
-- hide the edition they just made. There is no bare insert policy on
-- `course_edition` for that reason.
create or replace function app.create_edition(course uuid, label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid  uuid;
  addr text;
begin
  if not app.is_teacher() then
    raise exception 'only a teacher may create an edition' using errcode = '42501';
  end if;
  select lower(u.email) into addr from auth.users u where u.id = (select auth.uid());
  insert into public.course_edition (course_id, label)
  values (course, label)
  returning edition_id into eid;
  insert into public.enrollment (edition_id, email, role, user_id)
  values (eid, addr, 'owner', (select auth.uid()));
  perform app.audit('create_edition', jsonb_build_object('edition_id', eid, 'course_id', course, 'label', label));
  return eid;
end
$$;

-- Owner action. A new edition of the same course with the same projects and
-- the same staff. Students are not copied: they are the thing that changes.
-- Dates are not copied either: last year's deadline is never this year's, and
-- a project with no `available_after` is invisible to students until someone
-- sets one, which is the safe way round.
create or replace function app.duplicate_edition(from_edition uuid, new_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid;
  cid uuid;
begin
  if app.role_in(from_edition) <> 'owner' then
    raise exception 'only an owner may duplicate an edition' using errcode = '42501';
  end if;
  select course_id into cid from public.course_edition where edition_id = from_edition;
  insert into public.course_edition (course_id, label)
  values (cid, new_label)
  returning edition_id into eid;

  insert into public.enrollment (edition_id, email, role, source, user_id)
  select eid, e.email, e.role, e.source, e.user_id
  from public.enrollment e
  where e.edition_id = from_edition and e.role in ('assistant', 'owner');

  -- Projects come along without their releases: this year's starter is a
  -- new upload, and last year's teacher archive stays with last year.
  insert into public.project (edition_id, slug, title, kind, created_by)
  select eid, slug, title, kind, (select auth.uid())
  from public.project
  where edition_id = from_edition;

  perform app.audit('duplicate_edition', jsonb_build_object('source', from_edition, 'edition_id', eid, 'label', new_label));
  return eid;
end
$$;

-- Owner action. Enrol an address, linking it now if the account already
-- exists. Enrolling an address twice changes nothing, including its role: a
-- role change is deliberate and goes through `app.set_edition_role`.
create or replace function app.enrol(edition uuid, addr text, new_role app.edition_role default 'student')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.role_in(edition) <> 'owner' then
    raise exception 'only an owner may enrol' using errcode = '42501';
  end if;
  insert into public.enrollment (edition_id, email, role, user_id)
  values (
    edition, lower(addr), new_role,
    (select u.id from auth.users u where lower(u.email) = lower(addr) and u.email_confirmed_at is not null)
  )
  on conflict (edition_id, email) do nothing;
  perform app.audit('enrol', jsonb_build_object('edition_id', edition, 'email', lower(addr), 'role', new_role));
end
$$;

create or replace function app.set_edition_role(edition uuid, addr text, new_role app.edition_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.role_in(edition) <> 'owner' then
    raise exception 'only an owner may change a role' using errcode = '42501';
  end if;
  if new_role <> 'owner' and not exists (
    select 1 from public.enrollment
    where edition_id = edition and role = 'owner' and email <> lower(addr)
  ) then
    raise exception 'an edition keeps at least one owner' using errcode = '23514';
  end if;
  update public.enrollment set role = new_role
  where edition_id = edition and email = lower(addr);
  if not found then
    raise exception 'not enrolled' using errcode = 'P0002';
  end if;
  perform app.audit('set_edition_role', jsonb_build_object('edition_id', edition, 'email', lower(addr), 'role', new_role));
end
$$;

-- Owner action. Removing someone is a delete whether or not they ever logged
-- in. Their submissions stay: they are evidence, and `author_id` still names
-- them.
create or replace function app.unenrol(edition uuid, addr text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.role_in(edition) <> 'owner' then
    raise exception 'only an owner may unenrol' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.enrollment
    where edition_id = edition and role = 'owner' and email <> lower(addr)
  ) then
    raise exception 'an edition keeps at least one owner' using errcode = '23514';
  end if;
  delete from public.enrollment where edition_id = edition and email = lower(addr);
  perform app.audit('unenrol', jsonb_build_object('edition_id', edition, 'email', lower(addr)));
end
$$;

create or replace function app.archive_edition(edition uuid, archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.role_in(edition) <> 'owner' then
    raise exception 'only an owner may archive an edition' using errcode = '42501';
  end if;
  update public.course_edition
  set archived_at = case when archived then coalesce(archived_at, now()) else null end
  where edition_id = edition;
  perform app.audit('archive_edition', jsonb_build_object('edition_id', edition, 'archived', archived));
end
$$;

-- Reads.
-- A person: yourself, and anyone you share an edition with, which is what a
-- roster and a submission list need to show a name. Nothing else.
create policy app_user_read on public.app_user for select to authenticated using (
  user_id = (select auth.uid()) or app.shares_edition(user_id) or app.is_admin()
);

-- A course: teachers see all of them (they need the list to add an edition);
-- everyone else sees the courses of editions they are in.
create policy course_read on public.course for select to authenticated using (
  app.is_teacher()
  or exists (
    select 1 from public.course_edition e
    where e.course_id = course.course_id and app.role_in(e.edition_id) is not null
  )
);

-- An edition: its members. Admins are not members by default (see identity).
create policy edition_read on public.course_edition for select to authenticated using (
  app.role_in(edition_id) is not null
);

-- Enrolment rows: your own, and every row of an edition you are staff of.
-- A student never sees who else is enrolled, let alone their address.
create policy enrollment_read on public.enrollment for select to authenticated using (
  user_id = (select auth.uid())
  or app.is_staff(edition_id)
);

grant select on public.course, public.course_edition, public.enrollment to authenticated;
-- Every write goes through the functions above; there is no insert, update or
-- delete grant on these tables for any API role.
