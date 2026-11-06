-- What a student's IDE needs to bring a folder up to the newest release.
--
-- A student's folder carries the id of the release it started from (the
-- stamp, 20261021130000). When the teacher publishes again, the IDE updates
-- the folder: files only the teacher changed are replaced, files both
-- changed are offered to the student as a three-way merge. That needs two
-- answers a student could not get until now, because they cannot read
-- project_release (its rows carry the teacher archive's key):
--
--   * which release is the newest they may download, to know an update
--     exists, and to fetch it by id rather than "whatever is newest when the
--     download happens to run";
--   * the starter of the release their folder started from, which is the
--     merge's base.
--
-- Both are security definer functions under the very rule that decides who
-- may download the current starter (`app.current_starter`): staff of the
-- edition always, a student while the project's window is open. Nothing
-- else is exposed: not labels, commits, uploaders, dates, and never a
-- teacher archive, which stays behind the release_read policy.
--
-- Who can reach an old starter, and why that is acceptable. A starter holds
-- nothing hidden (hidden paths are removed when it is built), so an old one
-- tells a student what an old version of their own assignment looked like.
-- There is one case where it tells more than they were ever given: a
-- release published and superseded while the project was still a draft or
-- not yet open never reached any student, and a teacher may believe it
-- never will. `app.release_starter` hands it out once the window opens to
-- whoever names its id. The id is the capability: release ids reach
-- students only inside the `yukibana.json` of starters handed to someone in
-- the edition, a superseded draft's id was never in one, and a uuidv7 has 74
-- random bits. So such a release is reachable only through an id staff
-- leaked. Checking "was this release ever current while the window was
-- open" instead would be wrong as well as complicated, because
-- `available_after` can be edited after the fact. This was decided, not
-- overlooked (2026-11).

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- The release whose starter `app.current_starter(project)` hands out, under
-- the same predicate; null when there is none or the caller may not
-- download it now. The two are kept as twins rather than one calling the
-- other so each stays a single indexed lookup.
create or replace function app.current_release(project uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.release_id
  from public.project p
  join public.project_release r on r.project_id = p.project_id
  where p.project_id = current_release.project
    and (app.is_staff(p.edition_id) or app.project_open(p.edition_id, p.available_after, p.closes_at))
  order by r.seq desc
  limit 1
$$;
revoke execute on function app.current_release(uuid) from public, anon;
grant execute on function app.current_release(uuid) to authenticated;

-- The starter key of `release`, when the caller may download its project's
-- current starter (see the head of this file for why that is the whole
-- rule); null otherwise, including for an id that names no release. A
-- release id determines its project, so there is no project argument to
-- disagree with it.
create or replace function app.release_starter(release uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.starter_key
  from public.project_release r
  join public.project p on p.project_id = r.project_id
  where r.release_id = release_starter.release
    and (app.is_staff(p.edition_id) or app.project_open(p.edition_id, p.available_after, p.closes_at))
$$;
revoke execute on function app.release_starter(uuid) from public, anon;
grant execute on function app.release_starter(uuid) to authenticated;
