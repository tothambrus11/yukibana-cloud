-- Why a submission is refused, for the people entitled to know.
--
-- `app.can_submit` answers yes or no, and the Worker turned every no into
-- one sentence: "This project is not accepting submissions from you now."
-- That sentence covered a course owner trying the IDE's submit button on
-- their own draft, a student whose project had not opened yet, and a
-- student a minute after it closed, and none of them could tell which they
-- were. The IDE and the CLI show the registry's sentence as it is, so the
-- sentence is the only place the difference can be said.
--
-- This function says which condition failed. It decides nothing:
-- `can_submit` and the submission insert policy still decide, and the
-- Worker asks this only after they have said no, in the same transaction
-- as `can_submit` so both read the same `now()`.
--
-- Who learns what. Someone not enrolled in the project's edition gets no
-- row, the same as for a project that does not exist: for them an id
-- tells nothing, as a 404 does in app/src/lib/server/catalogue.ts. Someone
-- enrolled in the edition, in any role, is told the reason, and that is
-- more than the rest of the app tells a student: the project policy hides
-- a project from its students outside its window, and the catalogue
-- answers 404 for it. A student who holds the id of a hidden project
-- learns from this that it exists in their edition, whether it is a draft
-- or opens later (and when) or has closed (and when), and the edition's
-- course name and label, which they already see. They learn nothing else
-- about it: not its title, not its releases. The id itself reaches a
-- student from a starter, a link or a teacher, and is not guessable.
-- Whether this is the right trade is the course's call; this is what it is.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- One row when the caller is enrolled in `project`'s edition and may not
-- submit to it now, none otherwise (no such project, not enrolled, or
-- nothing to refuse). `reason` is, first match wins:
--   'staff'     the caller's role in the edition is not student
--   'closed'    `closes_at` has passed
--   'not_open'  any other closed window: a draft (no `available_after`)
--               or one whose `available_after` is still ahead
-- A window that `app.window_open` calls open gives no reason, so the
-- reasons are the decision's complement by construction rather than by a
-- second copy of its test. `at` is when the window opens ('not_open';
-- null for a draft) or when it closed ('closed'); null for 'staff'.
create or replace function app.submit_refusal(project uuid)
returns table (
  reason text,
  role app.edition_role,
  course_title text,
  edition_label text,
  at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.reason, r.role, r.course_title, r.edition_label,
         case r.reason when 'not_open' then r.available_after when 'closed' then r.closes_at end
  from (
    select
      case
        when m.role <> 'student' then 'staff'
        when app.window_open(p.available_after, p.closes_at) then null
        when p.closes_at is not null and p.closes_at <= now() then 'closed'
        else 'not_open'
      end as reason,
      m.role, e.title as course_title, e.label as edition_label, p.available_after, p.closes_at
    from public.project p
    join public.course_edition e on e.edition_id = p.edition_id
    cross join lateral (select app.role_in(p.edition_id) as role) m
    where p.project_id = submit_refusal.project
      and m.role is not null
  ) r
  where r.reason is not null
$$;
revoke execute on function app.submit_refusal(uuid) from public, anon;
grant execute on function app.submit_refusal(uuid) to authenticated;
