-- Deleting projects, editions and courses; teachers see every edition.
--
-- Until now the only way to remove anything was a bare `delete from project`
-- under the owner's policy, which the app never offered, and an edition or a
-- course made by mistake stayed for good. The three deletes are functions,
-- like every other write that has more to do than one row:
--
-- * Each checks its caller and leaves an audit row in the same transaction.
-- * Each refuses while there is a submission anywhere underneath. Submissions
--   are evidence (see the submissions migration); the foreign key already
--   refuses, but with a sentence about a constraint, so the functions ask
--   first and say "archive it instead". Archiving is the answer for a course
--   that ran; deleting is for one that should not have existed.
-- * Each returns the bucket keys of the releases it removed. The rows go with
--   the transaction; the objects are the Worker's to delete once it commits,
--   because the database cannot reach the bucket. A key the Worker fails to
--   delete is reported, never retried in a way that could take a live one.
--
-- The bare delete goes: its policy and grant are dropped below, so a project
-- cannot be removed without its release objects being named to the Worker.

-- Supabase runs each migration in one transaction; these bound how long it
-- may wait for a lock or run, so a deploy that would block the site fails
-- instead, and is retried when the table is quiet.
set local lock_timeout = '10s';
set local statement_timeout = '5min';

drop policy project_delete on public.project;
revoke delete on public.project from authenticated;

-- Owner action. The project, its releases and its tokens; refused while it
-- has a submission. Returns the release objects to delete from the bucket.
create or replace function app.delete_project(project uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid  uuid;
  keys text[];
begin
  select p.edition_id into eid from public.project p where p.project_id = project;
  -- A project the caller cannot own is refused the same way whether or not
  -- it exists, so the answer does not tell a stranger which ids are real.
  if eid is null or not app.is_owner(eid) then
    raise exception 'only an owner may delete a project' using errcode = '42501';
  end if;
  if exists (select 1 from public.submission s where s.project_id = project) then
    raise exception 'this project has submissions, which are kept; archive the edition instead' using errcode = '23503';
  end if;
  select coalesce(array_agg(k), '{}') into keys
  from public.project_release r, lateral (values (r.starter_key), (r.teacher_key)) as v(k)
  where r.project_id = project;
  delete from public.project p where p.project_id = project;
  perform app.audit('delete_project', jsonb_build_object('project_id', project, 'edition_id', eid));
  return query select unnest(keys);
end
$$;

-- Owner action. The edition, its roster and its projects; refused while any
-- of its projects has a submission. Another owner's consent is not asked:
-- every owner may already remove every other one.
create or replace function app.delete_edition(edition uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  keys text[];
begin
  if not app.is_owner(edition) then
    raise exception 'only an owner may delete an edition' using errcode = '42501';
  end if;
  if exists (select 1 from public.submission s where s.edition_id = edition) then
    raise exception 'this edition has submissions, which are kept; archive it instead' using errcode = '23503';
  end if;
  select coalesce(array_agg(k), '{}') into keys
  from public.project p
  join public.project_release r on r.project_id = p.project_id,
  lateral (values (r.starter_key), (r.teacher_key)) as v(k)
  where p.edition_id = edition;
  delete from public.course_edition e where e.edition_id = edition;
  perform app.audit('delete_edition', jsonb_build_object('edition_id', edition));
  return query select unnest(keys);
end
$$;

-- Whether the caller may delete `course`: a teacher who owns every one of
-- its editions, or, for a course with none, the teacher who made it or an
-- admin. Owning every edition is what deleting them one by one would need,
-- so this is no wider than that; an edition someone else runs keeps the
-- course. The page asks it to decide whether to offer the button.
create or replace function app.may_delete_course(course uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_teacher()
     and exists (select 1 from public.course c where c.course_id = course)
     and not exists (
       select 1 from public.course_edition e
       where e.course_id = course and not app.is_owner(e.edition_id)
     )
     and (
       exists (select 1 from public.course_edition e where e.course_id = course)
       or app.is_admin()
       or exists (select 1 from public.course c where c.course_id = course and c.created_by = (select auth.uid()))
     )
$$;

-- Teacher action. The course and every edition of it, under the rule above;
-- refused while any of them has a submission.
create or replace function app.delete_course(course uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  ccode text;
  keys  text[];
begin
  if not app.may_delete_course(course) then
    raise exception 'only a teacher who owns every edition of a course may delete it' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.submission s
    join public.course_edition e on e.edition_id = s.edition_id
    where e.course_id = course
  ) then
    raise exception 'this course has submissions, which are kept; archive its editions instead' using errcode = '23503';
  end if;
  select coalesce(array_agg(k), '{}') into keys
  from public.course_edition e
  join public.project p on p.edition_id = e.edition_id
  join public.project_release r on r.project_id = p.project_id,
  lateral (values (r.starter_key), (r.teacher_key)) as v(k)
  where e.course_id = course;
  delete from public.course c where c.course_id = course returning c.code into ccode;
  perform app.audit('delete_course', jsonb_build_object('course_id', course, 'code', ccode));
  return query select unnest(keys);
end
$$;

-- Teachers see every edition of every course, not only their own.
--
-- Teachers already saw every course (they pick one to add an edition to),
-- but an edition only its members, so a course somebody else ran looked
-- empty, and a teacher about to make "2026 autumn" could not see that a
-- colleague already had. An edition row is a label and a date; what is in
-- it (projects, roster, submissions) keeps its own policies, which ask for
-- a role in the edition, so a teacher outside it still sees none of that.
-- Students are unchanged: their editions and nothing else.
drop policy edition_read on public.course_edition;
create policy edition_read on public.course_edition for select to authenticated using (
  app.role_in(edition_id) is not null or app.is_teacher()
);

-- Who owns `edition`, by name, for the people who would want to ask them for
-- something: its members, and teachers, who now see editions they are not
-- in and need to know whom to ask to be added. A name or login, never an
-- address: the addresses stay on the roster, which is staff's.
create or replace function app.edition_owners(edition uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(u.full_name, u.github_login, 'someone not yet logged in')
  from public.enrollment en
  left join public.app_user u on u.user_id = en.user_id
  where en.edition_id = edition and en.role = 'owner'
    and (app.role_in(edition) is not null or app.is_teacher())
  order by 1
$$;
