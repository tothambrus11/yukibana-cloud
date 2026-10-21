-- Release ids travel inside the starter, and submissions say which release
-- they started from.
--
-- Until now the database chose a release's id when the row was inserted,
-- which is after the CLI had built and uploaded both archives, so nothing a
-- student received could say which release it was. Grading then had only
-- "the newest release" to compare a submission with, and a read-only file
-- fixed in a later release made every student who started earlier look as
-- if they had changed it.
--
-- Now the publisher chooses the id before building, writes it into the
-- starter's yukibana.json, and hands it to the publish functions, which
-- insert it as the primary key. That cannot race: a second release with the
-- same id is a unique violation and stores nothing, whichever project it
-- names, and the id inside an archive is the one its row has however late
-- a student downloads it. The student's folder keeps the id, `submit` sends
-- it, and the submission records it as `base_release_id`.
--
-- The base is a student's claim (yukibana.json is a file on their disk), so
-- it is never used to decide who may do what. It is only ever a release of
-- the submission's own project: the foreign key says so, and the insert
-- trigger forgets a claim that names anything else rather than refusing
-- the work.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- The pair the submission's foreign key points at. release_id alone is
-- already unique; the pair is what lets the key insist on the project too.
create unique index project_release_in_project on public.project_release (project_id, release_id);
alter table public.project_release
  add constraint project_release_in_project unique using index project_release_in_project;

-- Null for submissions made before this migration, for archives made by
-- hand, and for a claim the trigger below forgot.
alter table public.submission add column base_release_id uuid;
-- Restrict: releases are never deleted on their own, and a project with
-- submissions cannot be deleted, so this never fires; if it ever does, the
-- evidence wins. NOT VALID only spares the rows already there, which are
-- all null and so could not violate it; every row written from now on is
-- checked. Validating in the same transaction would block reads of the
-- table while it ran, for nothing.
alter table public.submission
  add constraint submission_base_release foreign key (project_id, base_release_id)
  references public.project_release (project_id, release_id) on delete restrict not valid;

-- Whether `release` is a release of `project`. Security definer because a
-- student cannot read project_release (its rows carry the teacher archive's
-- key), and the insert trigger asks on their behalf. It answers about one
-- pair of ids the caller already holds, and reads nothing else.
create or replace function app.is_release_of(project uuid, release uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_release r
    where r.project_id = is_release_of.project and r.release_id = is_release_of.release
  )
$$;
revoke execute on function app.is_release_of(uuid, uuid) from public, anon, authenticated;

-- As in 20260918090400, the author and the moment are what the server saw.
-- A base that is not a release of this project is forgotten, not refused:
-- a student whose starter came from a release that was never recorded (an
-- upload that lost its id) must still be able to hand in, and the CLI reads
-- the claim back out of the archive when it matters. Security definer, so
-- it may ask is_release_of; it writes nothing but `new`.
create or replace function app.stamp_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.author_id    := (select auth.uid());
  new.submitted_at := now();
  if new.base_release_id is not null and not app.is_release_of(new.project_id, new.base_release_id) then
    new.base_release_id := null;
  end if;
  return new;
end
$$;
revoke execute on function app.stamp_submission() from public, anon, authenticated;

-- Staff publish a release whose id the publisher chose; null lets the
-- database choose, for an upload that carries none. The checks are those of
-- 20261008100000. A duplicate id is a unique violation, answered as a
-- conflict, and stores nothing.
create or replace function app.publish_release(
  project uuid, release uuid, label text, commit_sha text,
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
  if not exists (select 1 from public.project p where p.project_id = project and app.may_edit_projects(p.edition_id)) then
    raise exception 'only staff may publish a release' using errcode = '42501';
  end if;
  insert into public.project_release (release_id, project_id, label, commit_sha, starter_key, starter_size, starter_sha256,
                                      teacher_key, teacher_size, teacher_sha256, uploaded_by)
  values (coalesce(release, app.uuidv7()), project, label, commit_sha, starter_key, starter_size, starter_sha256,
          teacher_key, teacher_size, teacher_sha256, (select auth.uid()))
  returning release_id into rid;
  perform app.audit('publish_release', jsonb_build_object('project_id', project, 'release_id', rid, 'label', label));
  return rid;
end
$$;

-- The old signature, for a Worker deployed before this migration: the
-- deploy runs migrations first, and that Worker serves until the new one is
-- up. It chooses no id. Drop it once no Worker calls it.
create or replace function app.publish_release(
  project uuid, label text, commit_sha text,
  starter_key text, starter_size bigint, starter_sha256 bytea,
  teacher_key text, teacher_size bigint, teacher_sha256 bytea
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select app.publish_release(project, null, label, commit_sha, starter_key, starter_size, starter_sha256,
                             teacher_key, teacher_size, teacher_sha256)
$$;

-- The publisher's write with a chosen id. As in 20260918090300, the hash is
-- checked here again, and the project is the token's, never the caller's
-- to say: an id cannot attach a release to another project.
create or replace function app.publish_release_with_token(
  token_hash bytea, release uuid, label text, commit_sha text,
  starter_key text, starter_size bigint, starter_sha256 bytea,
  teacher_key text, teacher_size bigint, teacher_sha256 bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t   public.project_token%rowtype;
  rid uuid;
begin
  select * into t from public.project_token pt
  where pt.token_hash = publish_release_with_token.token_hash and pt.revoked_at is null;
  if t.token_id is null then
    raise exception 'unknown or revoked token' using errcode = '42501';
  end if;
  insert into public.project_release (release_id, project_id, label, commit_sha, starter_key, starter_size, starter_sha256,
                                      teacher_key, teacher_size, teacher_sha256, uploaded_by, token_id)
  values (coalesce(release, app.uuidv7()), t.project_id, label, commit_sha, starter_key, starter_size, starter_sha256,
          teacher_key, teacher_size, teacher_sha256, t.created_by, t.token_id)
  returning release_id into rid;
  update public.project_token set last_used_at = now() where token_id = t.token_id;
  insert into public.audit_log (actor, action, subject)
  values (t.created_by, 'publish_release', jsonb_build_object('project_id', t.project_id, 'release_id', rid, 'label', label, 'token_id', t.token_id));
  return rid;
end
$$;

-- The old signature, as above.
create or replace function app.publish_release_with_token(
  token_hash bytea, label text, commit_sha text,
  starter_key text, starter_size bigint, starter_sha256 bytea,
  teacher_key text, teacher_size bigint, teacher_sha256 bytea
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select app.publish_release_with_token(token_hash, null, label, commit_sha, starter_key, starter_size, starter_sha256,
                                        teacher_key, teacher_size, teacher_sha256)
$$;

revoke execute on function app.publish_release_with_token(bytea, uuid, text, text, text, bigint, bytea, text, bigint, bytea)
  from public, anon, authenticated;
grant execute on function app.publish_release_with_token(bytea, uuid, text, text, text, bigint, bytea, text, bigint, bytea)
  to yukibana_publisher;
