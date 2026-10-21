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
-- Worker asks this only after they have said no. It answers only people
-- enrolled in the project's edition, in any role, because they already
-- know the edition and its course, and the project's id reached them from
-- it (a starter, a page, a teacher). Anyone else gets no row, the same as
-- for a project that does not exist, so an id tells a stranger nothing.
--
-- A student is told when a project opens or closed even though the
-- project's policy hides it from them outside its window. Hiding is what
-- keeps the list of current exercises current; it is not a secret from
-- the student holding the id, and the dates are the ones the course
-- announced. A draft has no date to tell, and says only that it is not
-- open yet.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- One row when the caller is enrolled in `project`'s edition and may not
-- submit to it now, none otherwise (no such project, not enrolled, or
-- nothing to refuse). `reason` is, first match wins:
--   'staff'     the caller's role in the edition is not student
--   'not_open'  no `available_after` (a draft), or it is still ahead
--   'closed'    `closes_at` has passed
-- The order matches what a person can do about it: staff never submit, so
-- the window is beside the point for them. The window test is
-- `app.window_open`'s, spelled out, so the reasons and the decision cannot
-- disagree about a project whose window is open: such a row has no reason
-- and is filtered out.
create or replace function app.submit_refusal(project uuid)
returns table (
  reason text,
  role app.edition_role,
  course_title text,
  edition_label text,
  available_after timestamptz,
  closes_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.reason, r.role, r.course_title, r.edition_label, r.available_after, r.closes_at
  from (
    select
      case
        when m.role <> 'student' then 'staff'
        when p.available_after is null or p.available_after > now() then 'not_open'
        when p.closes_at is not null and now() >= p.closes_at then 'closed'
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
