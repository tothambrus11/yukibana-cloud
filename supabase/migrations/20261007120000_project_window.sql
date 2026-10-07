-- A project's window, and late submissions.
--
-- Until now the deadline was a wall: past it, `app.can_submit` said no and a
-- student who was a minute late had nowhere to put their work. Courses do
-- accept late work; what they need is to know it was late. So the deadline
-- becomes what it is in a syllabus, the due date, and a new `closes_at` is
-- the wall:
--
--   available_after ── deadline ── closes_at
--   └ a student sees it, downloads, submits ┘
--                      └ submissions are late ┘
--
-- Outside the window a student does not see the project at all, which is
-- what "only the exercises that are current" means. A null `closes_at` is a
-- window that never closes, so late work is possible unless a teacher bounds
-- it.
--
-- Lateness is not stored. `submission.submitted_at` is stamped by the server
-- (see the submissions migration), and "late" is `submitted_at > deadline`,
-- asked when it is read. A deadline extended after the fact then applies to
-- the work already handed in, which is what an extension means; a stored
-- flag would have to be rewritten, and submissions are never rewritten.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- The checks are the new column's own, declared with it: a column that is
-- null in every row cannot violate them, so there is nothing to validate
-- (a separate `add constraint` would want a `not valid` and a second
-- transaction to validate in, and a migration is one transaction).
alter table public.project add column closes_at timestamptz
  constraint project_closes_after_deadline check (closes_at is null or deadline is null or closes_at >= deadline)
  constraint project_closes_after_start check (closes_at is null or available_after is null or closes_at > available_after);

grant update (closes_at) on public.project to authenticated;

-- Whether the caller, as a student, may see a project now: enrolled as a
-- student, started, and not yet closed. Replaces the two-argument version,
-- which knew nothing of an end.
create or replace function app.project_open(edition uuid, available_after timestamptz, closes_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.role_in(edition) = 'student'
     and available_after is not null
     and available_after <= now()
     and (closes_at is null or now() < closes_at)
$$;

-- Whether the caller may submit to `project` right now: while it is open to
-- them, before the deadline or after it. Whether a submission was late is
-- for whoever reads it to ask; refusing it is `closes_at`'s job alone.
create or replace function app.can_submit(project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project p
    where p.project_id = project
      and app.project_open(p.edition_id, p.available_after, p.closes_at)
  )
$$;

-- The starter a student may download right now: the same window.
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
    and (app.is_staff(p.edition_id) or app.project_open(p.edition_id, p.available_after, p.closes_at))
  order by r.seq desc
  limit 1
$$;

-- Reads: staff see every project of their editions; students see the ones
-- whose window is open now. Dropped and created, not altered, so the diff
-- engine and a reviewer both see the whole policy.
drop policy project_read on public.project;
create policy project_read on public.project for select to authenticated using (
  app.is_staff(edition_id) or app.project_open(edition_id, available_after, closes_at)
);

-- Nothing calls the two-argument version any more; left in place it would be
-- a second answer to "is this open?" that ignores the end of the window.
drop function app.project_open(uuid, timestamptz);

-- The deadline of `project`, for whoever has a reason to know it: its staff,
-- a student while its window is open, and anyone who submitted to it. The
-- last is why this exists: once the window closes a student no longer sees
-- the project, but still reads their own submissions (the submission policy
-- is by author), and whether one was late is a question about this date.
-- Null for anyone else, and for a project without a deadline.
create or replace function app.deadline_of(project uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select p.deadline
  from public.project p
  where p.project_id = project
    and (
      app.is_staff(p.edition_id)
      or app.project_open(p.edition_id, p.available_after, p.closes_at)
      or exists (select 1 from public.submission s where s.project_id = p.project_id and s.author_id = (select auth.uid()))
    )
$$;
