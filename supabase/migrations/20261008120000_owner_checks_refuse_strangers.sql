-- Owner checks that refuse people outside the edition.
--
-- A mistake, written down. The roster functions checked their caller with
-- `if app.role_in(edition) <> 'owner' then raise`. For somebody not
-- enrolled at all, `role_in` is null, `null <> 'owner'` is null, and an
-- `if` on null does not raise: the check passed. Any signed-in person who
-- knew an edition's id (it is in every edition's URL) could enrol
-- themselves as its owner with app.enrol, and from there do anything an
-- owner can. app.set_edition_role, app.unenrol, app.archive_edition and
-- app.duplicate_edition had the same hole. Found in review, 2026-10.
--
-- The checks now ask app.is_owner, which is false rather than null for a
-- stranger, the way app.is_staff already was. The negative tests in
-- supabase/tests/strangers.test.sql are what would have caught it.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- Whether the caller owns `edition`. Never null: false for somebody not
-- enrolled, so it is safe on its own in an `if`.
create or replace function app.is_owner(edition uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(app.role_in(edition) = 'owner', false)
$$;

create or replace function app.duplicate_edition(from_edition uuid, new_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid;
  cid uuid;
begin
  if not app.is_owner(from_edition) then
    raise exception 'only an owner may duplicate an edition' using errcode = '42501';
  end if;
  select course_id into cid from public.course_edition where edition_id = from_edition;
  insert into public.course_edition (course_id, label)
  values (cid, new_label)
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

create or replace function app.enrol(edition uuid, addr text, new_role app.edition_role default 'student')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_owner(edition) then
    raise exception 'only an owner may enrol' using errcode = '42501';
  end if;
  insert into public.enrollment (edition_id, email, role, user_id)
  values (
    edition, lower(addr), new_role,
    (select u.id from auth.users u where lower(u.email) = lower(addr) and u.email_confirmed_at is not null)
  )
  on conflict (edition_id, email) do nothing;
  perform app.audit('enrol', jsonb_build_object('edition_id', edition, 'email', lower(addr), 'role', new_role));
end
$$;

create or replace function app.set_edition_role(edition uuid, addr text, new_role app.edition_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_owner(edition) then
    raise exception 'only an owner may change a role' using errcode = '42501';
  end if;
  if new_role <> 'owner' and not exists (
    select 1 from public.enrollment
    where edition_id = edition and role = 'owner' and email <> lower(addr)
  ) then
    raise exception 'an edition keeps at least one owner' using errcode = '23514';
  end if;
  update public.enrollment set role = new_role
  where edition_id = edition and email = lower(addr);
  if not found then
    raise exception 'not enrolled' using errcode = 'P0002';
  end if;
  perform app.audit('set_edition_role', jsonb_build_object('edition_id', edition, 'email', lower(addr), 'role', new_role));
end
$$;

create or replace function app.unenrol(edition uuid, addr text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_owner(edition) then
    raise exception 'only an owner may unenrol' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.enrollment
    where edition_id = edition and role = 'owner' and email <> lower(addr)
  ) then
    raise exception 'an edition keeps at least one owner' using errcode = '23514';
  end if;
  delete from public.enrollment where edition_id = edition and email = lower(addr);
  perform app.audit('unenrol', jsonb_build_object('edition_id', edition, 'email', lower(addr)));
end
$$;

create or replace function app.archive_edition(edition uuid, archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_owner(edition) then
    raise exception 'only an owner may archive an edition' using errcode = '42501';
  end if;
  update public.course_edition
  set archived_at = case when archived then coalesce(archived_at, now()) else null end
  where edition_id = edition;
  perform app.audit('archive_edition', jsonb_build_object('edition_id', edition, 'archived', archived));
end
$$;
