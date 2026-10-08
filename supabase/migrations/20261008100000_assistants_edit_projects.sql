-- Assistants edit projects.
--
-- Until now only an owner could create a project, change its title and
-- dates, publish a release or reorder the list; an assistant could read all
-- of it and change none. In practice assistants are who keep the
-- assignments up to date, so they now do everything to a project that
-- changes the assignment itself: create it, edit it, publish a release of
-- it, move it in the list.
--
-- What stays the owners': deleting a project (its releases and tokens go
-- with it; one with submissions cannot be deleted at all), publishing
-- tokens (a long-lived credential, made once by whoever sets up the
-- course's CI), and everything about the edition and its roster.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

drop policy project_insert on public.project;
create policy project_insert on public.project for insert to authenticated with check (
  app.is_staff(edition_id)
);

drop policy project_update on public.project;
create policy project_update on public.project for update to authenticated
  using (app.is_staff(edition_id))
  with check (app.is_staff(edition_id));

-- A manual upload of the two archives the Worker has already stored, by
-- staff of the project's edition. Returns the release id.
create or replace function app.publish_release(
  project uuid, label text, commit_sha text,
  starter_key text, starter_size bigint, starter_sha256 bytea,
  teacher_key text, teacher_size bigint, teacher_sha256 bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid;
begin
  if not exists (select 1 from public.project p where p.project_id = project and app.is_staff(p.edition_id)) then
    raise exception 'only staff may publish a release' using errcode = '42501';
  end if;
  insert into public.project_release (project_id, label, commit_sha, starter_key, starter_size, starter_sha256,
                                      teacher_key, teacher_size, teacher_sha256, uploaded_by)
  values (project, label, commit_sha, starter_key, starter_size, starter_sha256,
          teacher_key, teacher_size, teacher_sha256, (select auth.uid()))
  returning release_id into rid;
  perform app.audit('publish_release', jsonb_build_object('project_id', project, 'release_id', rid, 'label', label));
  return rid;
end
$$;

-- Staff move `project` between two neighbours of the same edition; as in
-- 20261008090000, only the moved row changes.
create or replace function app.move_project(project uuid, after uuid, before uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  edition uuid;
  a numeric;
  b numeric;
  placed numeric;
begin
  select p.edition_id into edition from public.project p where p.project_id = project;
  if edition is null or not app.is_staff(edition) then
    raise exception 'only staff may reorder projects' using errcode = '42501';
  end if;
  if after is not null then
    select p.position into a from public.project p where p.project_id = after and p.edition_id = edition;
    if a is null then raise exception 'the project before it is not in this edition' using errcode = '23514'; end if;
  end if;
  if before is not null then
    select p.position into b from public.project p where p.project_id = before and p.edition_id = edition;
    if b is null then raise exception 'the project after it is not in this edition' using errcode = '23514'; end if;
  end if;
  placed := case
    when a is not null and b is not null then (a + b) * 0.5
    when a is not null then a + 1
    when b is not null then b - 1
  end;
  if placed is null then
    return (select p.position from public.project p where p.project_id = project);
  end if;
  update public.project p set position = placed where p.project_id = project;
  perform app.audit('move_project', jsonb_build_object('project_id', project, 'after', after, 'before', before));
  return placed;
end
$$;
