-- The course name belongs to the edition.
--
-- A course's title was fixed at `app.create_course` and nothing could
-- change it, so a typo was permanent and a course that changed its name
-- from one year to the next had to pretend it had not. Now each edition
-- carries the course name it ran under (`course_edition.title`), its
-- owners can change it along with the edition's label, and the course is
-- only what groups the editions: its code, and the name of its latest one.
--
-- `course.title` stays, as the name of the course's latest edition (by
-- `created_at`), kept so by a trigger on `course_edition` rather than by
-- each function that writes it. It is what a page shows when it speaks of
-- the course rather than of one edition: the new-edition picker, say. A
-- computed lookup would have had to read editions the caller is not in
-- (a teacher picking a course they have never taught), which a policy
-- would hide and a security definer would widen; one column written by a
-- trigger does neither. Before the first edition it is the name the course
-- was created with, which the first edition then takes.
--
-- The code stays on the course, shared by every edition, and any owner of
-- one of its editions may change it: the rule for the name, applied to
-- the one thing editions share.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- Nullable, and never null in practice, for the reason `project.position`
-- is (20261008090000_project_order.sql): filled for every existing row
-- here, and by every function that creates an edition; there is no insert
-- or update grant on the table, so nothing else writes it. `not null` would
-- cost a default to drop or a scan, both of which squawk rightly flags.
alter table public.course_edition add column title text;
update public.course_edition e set title = c.title
from public.course c where c.course_id = e.course_id;

-- Keeps `course.title` the name of the course's latest edition. Runs after
-- an edition is created or renamed; renaming an older edition recomputes
-- and finds the same latest one, so it changes nothing. Two editions made
-- in one transaction share a `created_at`; the id, time-ordered to the
-- millisecond, decides between them. Security definer
-- because the caller has no update grant on `course`, which is the point.
create or replace function app.follow_latest_edition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.course c
  set title = latest.title
  from (
    select e.title from public.course_edition e
    where e.course_id = new.course_id
    order by e.created_at desc, e.edition_id desc
    limit 1
  ) latest
  where c.course_id = new.course_id and c.title is distinct from latest.title;
  return null;
end
$$;
revoke execute on function app.follow_latest_edition() from public, anon, authenticated;

create trigger course_follows_latest_edition
  after insert or update of title on public.course_edition
  for each row execute function app.follow_latest_edition();

-- Teacher action, as before. The new edition starts with the course's
-- current name, the latest edition's; its owner can change it afterwards.
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

-- Owner action, as before, and the copy keeps the name of the edition it
-- was copied from: duplicating last year's edition is saying "this again".
create or replace function app.duplicate_edition(from_edition uuid, new_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid;
begin
  if not app.is_owner(from_edition) then
    raise exception 'only an owner may duplicate an edition' using errcode = '42501';
  end if;
  insert into public.course_edition (course_id, label, title)
  select e.course_id, new_label, e.title from public.course_edition e where e.edition_id = from_edition
  returning edition_id into eid;

  insert into public.enrollment (edition_id, email, role, source, user_id)
  select eid, e.email, e.role, e.source, e.user_id
  from public.enrollment e
  where e.edition_id = from_edition and e.role in ('assistant', 'owner');

  -- Projects come along without their releases: this year's starter is a
  -- new upload, and last year's teacher archive stays with last year.
  insert into public.project (edition_id, slug, title, kind, position, created_by)
  select eid, slug, title, kind, position, (select auth.uid())
  from public.project
  where edition_id = from_edition;

  perform app.audit('duplicate_edition', jsonb_build_object('source', from_edition, 'edition_id', eid, 'label', new_label));
  return eid;
end
$$;

-- Owner action. The edition's label and the course name it runs under.
-- Both are trimmed and neither may be empty: an edition with no label
-- cannot be told from its siblings, and one with no name has nothing to
-- show in a list. A label another edition of the course already has is
-- refused by the unique constraint, as at creation.
create or replace function app.update_edition(edition uuid, new_label text, new_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_owner(edition) then
    raise exception 'only an owner may rename an edition' using errcode = '42501';
  end if;
  if coalesce(btrim(new_label), '') = '' or coalesce(btrim(new_title), '') = '' then
    raise exception 'an edition needs a label and a course name' using errcode = '23514';
  end if;
  update public.course_edition
  set label = btrim(new_label), title = btrim(new_title)
  where edition_id = edition;
  perform app.audit('update_edition', jsonb_build_object('edition_id', edition, 'label', btrim(new_label), 'title', btrim(new_title)));
end
$$;

-- Owner action: the code every edition of the course is listed under. Any
-- owner of any of its editions may, because the code is the one thing they
-- share and there is nobody else to ask; the audit row says who did.
create or replace function app.set_course_code(course uuid, new_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.course_edition e
    where e.course_id = course and app.is_owner(e.edition_id)
  ) then
    raise exception 'only an owner of one of its editions may change a course code' using errcode = '42501';
  end if;
  if coalesce(btrim(new_code), '') = '' then
    raise exception 'a course needs a code' using errcode = '23514';
  end if;
  -- Aliased: unaliased, `course` here would also name the table.
  update public.course c set code = btrim(new_code) where c.course_id = course;
  perform app.audit('set_course_code', jsonb_build_object('course_id', course, 'code', btrim(new_code)));
end
$$;
