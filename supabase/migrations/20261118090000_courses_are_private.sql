-- A course belongs to the people in its editions.
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
-- showed (`course.title` follows the latest edition). Reported 2026-11.
--
-- Now a course is visible to the people enrolled in one of its editions, in
-- any role, and to its creator only while it has no editions at all (the
-- step between `app.create_course` and its first `app.create_edition`).
-- Only an owner of one of its editions may add an edition, the same rule as
-- for the course code, or its creator while it has none. A teacher outside
-- a course learns one thing about it: that its code is taken, because codes
-- are unique across the platform.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- Whether the caller is in the course: enrolled in one of its editions, or
-- the creator of a course that has no editions yet. Never null. Security
-- definer because "has no editions" must count editions the caller cannot
-- read; through the caller's policies every course they are not in would
-- look empty, and so look like theirs to name.
create or replace function app.in_course(course uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.course_edition e
    where e.course_id = course and app.role_in(e.edition_id) is not null
  ) or exists (
    select 1 from public.course c
    where c.course_id = course
      and c.created_by = (select auth.uid())
      and not exists (select 1 from public.course_edition e where e.course_id = c.course_id)
  )
$$;

-- Whether the caller may add an edition to the course: a teacher who owns
-- one of its editions, or who created it while it has none. Never null.
-- Owners and not assistants: an edition made here makes its maker its
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
    exists (
      select 1 from public.course_edition e
      where e.course_id = course and app.is_owner(e.edition_id)
    ) or exists (
      select 1 from public.course c
      where c.course_id = course
        and c.created_by = (select auth.uid())
        and not exists (select 1 from public.course_edition e where e.course_id = c.course_id)
    )
  )
$$;

drop policy course_read on public.course;
create policy course_read on public.course for select to authenticated using (
  app.in_course(course_id)
);

-- Teacher action, as before, now only on a course the caller may add to.
-- The refusal is the same for a course that exists and one that does not,
-- so the function cannot be used to ask whether an id is a course.
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
  if not app.may_add_edition(course) then
    raise exception 'only an owner of one of its editions may add an edition to a course' using errcode = '42501';
  end if;
  select lower(u.email) into addr from auth.users u where u.id = (select auth.uid());
  insert into public.course_edition (course_id, label, title)
  select c.course_id, label, c.title from public.course c where c.course_id = course
  returning edition_id into eid;
  if eid is null then
    raise exception 'no such course' using errcode = 'P0002';
  end if;
  insert into public.enrollment (edition_id, email, role, user_id)
  values (eid, addr, 'owner', (select auth.uid()));
  perform app.audit('create_edition', jsonb_build_object('edition_id', eid, 'course_id', course, 'label', label));
  return eid;
end
$$;
