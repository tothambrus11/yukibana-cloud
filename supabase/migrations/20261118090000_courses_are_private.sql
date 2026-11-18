-- A course belongs to the people in its editions; admins oversee them all.
--
-- A mistake, written down. `course_read` let every teacher read every
-- course, so that the home page could offer "add an edition" to any of
-- them, and `app.create_edition` let any teacher add an edition to any
-- course. Together they meant a teacher saw the code and the latest
-- edition's name of every course on the platform, other teachers'
-- included, and could put an edition of their own under one of them. That
-- edition was empty, because creating an edition copies nothing (copying is
-- `app.duplicate_edition`, which only an owner of the source may do), and
-- it hung under another teacher's course, changing the name that course
-- showed. Reported 2026-11.
--
-- Now:
--
--   * A course is visible to the people enrolled in one of its editions, in
--     any role, to its creator while it has no editions at all (the step
--     between `app.create_course` and its first `app.create_edition`), and
--     to admins. Only an owner of one of its editions, or its creator while
--     it has none, or an admin, may add an edition.
--   * A course's name is no longer readable from the course. `course.title`
--     is the name of its latest edition, and somebody in last year's
--     edition is not in this year's: reading it told them what an edition
--     they are not part of is called. The column grant leaves it out;
--     `app.course_name` gives the name of the latest edition the caller is
--     in, which is what a page means by "the course's name".
--   * An admin is an owner of every edition, and sees every course and
--     edition and every roster. That is `app.is_owner` and three read
--     policies, so the owner functions and the edition page work for an
--     admin unchanged.
--   * An admin also reads every project and its releases, starter and
--     teacher archive alike (`app.oversees`), to see what a course hands
--     out. That is all: an admin is not staff (`app.is_staff`), so
--     students' submissions stay with the people enrolled, and changing a
--     project, or its tokens, stays with its staff and owners.
--
-- A teacher outside a course learns one thing about it: that its code is
-- taken, because codes are unique across the platform.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- Whether the caller owns `edition`. Never null. An admin owns every
-- edition, without an enrolment row: the roster says who teaches, and an
-- admin who joined each one to manage it would be on every roster.
create or replace function app.is_owner(edition uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(app.role_in(edition) = 'owner', false) or app.is_admin()
$$;

-- Whether the caller created `course` and it has no editions yet: the one
-- moment a course belongs to nobody's roster. Security definer because "no
-- editions" must count editions the caller cannot read.
create or replace function app.created_unstarted(course uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.course c
    where c.course_id = course
      and c.created_by = (select auth.uid())
      and not exists (select 1 from public.course_edition e where e.course_id = c.course_id)
  )
$$;

-- Whether the caller may add an edition to the course: a teacher who owns
-- one of its editions, or created it while it has none, or an admin. Never
-- null. Owners and not assistants: an edition made here makes its maker its
-- owner, so an assistant who could do this would be making themselves an
-- owner of the course.
create or replace function app.may_add_edition(course uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_teacher() and (
    app.is_admin()
    or exists (
      select 1 from public.enrollment r join public.course_edition e on e.edition_id = r.edition_id
      where e.course_id = course and r.user_id = (select auth.uid()) and r.role = 'owner'
    )
    or app.created_unstarted(course)
  )
$$;

-- The course's name as the caller may know it: the name of the latest
-- edition they can see (enrolled in, or any for an admin), or before the
-- first edition the name it was created with. Null for a course the caller
-- is not in. Ties on `created_at` (two editions in one transaction) fall to
-- the time-ordered id, as in `app.follow_latest_edition`.
create or replace function app.course_name(course uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.title from public.course_edition e
     where e.course_id = course and (app.role_in(e.edition_id) is not null or app.is_admin())
     order by e.created_at desc, e.edition_id desc
     limit 1),
    (select c.title from public.course c
     where c.course_id = course and (app.created_unstarted(course) or app.is_admin()))
  )
$$;

drop policy course_read on public.course;
-- A course: whoever can see one of its editions (through `edition_read`, so
-- members and admins), and its creator before it has any.
create policy course_read on public.course for select to authenticated using (
  exists (select 1 from public.course_edition e where e.course_id = course.course_id)
  or app.created_unstarted(course_id)
);

drop policy edition_read on public.course_edition;
create policy edition_read on public.course_edition for select to authenticated using (
  app.role_in(edition_id) is not null or app.is_admin()
);

drop policy enrollment_read on public.enrollment;
create policy enrollment_read on public.enrollment for select to authenticated using (
  user_id = (select auth.uid())
  or app.is_staff(edition_id)
  or app.is_admin()
);

-- Every column but the name, which `app.course_name` gives out per caller.
revoke select on public.course from authenticated;
grant select (course_id, code, created_by, created_at) on public.course to authenticated;

-- Teacher action, as before, now only on a course the caller may add to,
-- and named after the latest edition the caller is in rather than the
-- course's latest, which may be somebody else's. The refusal is the same
-- for a course that exists and one that does not, so the function cannot
-- be used to ask whether an id is a course.
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
  if not app.may_add_edition(course) then
    raise exception 'only an owner of one of its editions may add an edition to a course' using errcode = '42501';
  end if;
  select lower(u.email) into addr from auth.users u where u.id = (select auth.uid());
  insert into public.course_edition (course_id, label, title)
  values (course, label, app.course_name(course))
  returning edition_id into eid;
  insert into public.enrollment (edition_id, email, role, user_id)
  values (eid, addr, 'owner', (select auth.uid()));
  perform app.audit('create_edition', jsonb_build_object('edition_id', eid, 'course_id', course, 'label', label));
  return eid;
end
$$;

-- Whether the caller may read every project of `edition` and its releases:
-- its staff, or an admin. Never null. Not `app.is_staff` with admins added,
-- because that also opens submissions and project edits, which an admin
-- has no part in.
create or replace function app.oversees(edition uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.is_staff(edition) or app.is_admin()
$$;

-- As in 20261007120000, with an admin reading every starter, so the
-- edition and project pages say whether a project is ready.
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
    and (app.oversees(p.edition_id) or app.project_open(p.edition_id, p.available_after, p.closes_at))
  order by r.seq desc
  limit 1
$$;

drop policy project_read on public.project;
create policy project_read on public.project for select to authenticated using (
  app.oversees(edition_id) or app.project_open(edition_id, available_after, closes_at)
);

drop policy release_read on public.project_release;
create policy release_read on public.project_release for select to authenticated using (
  exists (select 1 from public.project p where p.project_id = project_release.project_id and app.oversees(p.edition_id))
);
