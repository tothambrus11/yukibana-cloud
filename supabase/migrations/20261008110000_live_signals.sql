-- Live pages: the database tells open pages that something changed.
--
-- When staff reorder or edit projects, publish a release, change the
-- roster, or a student submits (from the IDE, say), the pages that show it
-- should change without a reload. Supabase Realtime carries the news, as
-- broadcasts on private channels, and the news is only ever "something in
-- this edition changed": the payload names the table and nothing else. A
-- page that hears it loads again through the Worker, as the person, under
-- the same policies as any other load. So no row ever travels over
-- Realtime, and there is no second copy of the read rules to keep in step
-- with the first: what someone may listen to only decides whom to wake.
--
-- Topics:
--   edition:<id>        everyone enrolled in the edition, students too:
--                       projects students can see, and their releases
--   edition:<id>:staff  its owners and assistants: every project, drafts
--                       included, releases, the roster, every submission
--   user:<id>           one person: their own submissions, anywhere
--
-- A change to a project students cannot see goes to the staff topic only,
-- so students do not learn when a draft is being worked on.
--
-- Only the database sends. Nobody has an insert policy on
-- realtime.messages, so a client can listen and cannot speak.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- Whether the caller may listen to `topic`. Anything that is not one of the
-- three shapes above is refused; the uuid is matched in full before it is
-- cast, so a malformed topic is a "no", not an error.
create or replace function app.may_listen(topic text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when topic ~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then substr(topic, 6)::uuid = (select auth.uid())
    when topic ~ '^edition:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then app.role_in(substr(topic, 9, 36)::uuid) is not null
    when topic ~ '^edition:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:staff$'
      then app.is_staff(substr(topic, 9, 36)::uuid)
    else false
  end
$$;

-- Realtime asks this policy when a client joins a private channel, with the
-- topic in `realtime.topic()`. Joining is all Realtime uses it for, but a
-- policy that checked only the topic asked about would show anyone reading
-- the table directly every topic's rows; each row has to belong to that
-- topic as well.
create policy listen_to_signals on realtime.messages for select to authenticated using (
  extension = 'broadcast'
  and topic = (select realtime.topic())
  and app.may_listen((select realtime.topic()))
);

-- One broadcast, private, with nothing in it but the table that changed.
create or replace function app.signal(topic text, source text)
returns void
language sql
security definer
set search_path = ''
as $$
  -- realtime.send never raises: a broadcast that cannot be stored is a
  -- warning in the log, and the write that caused it goes ahead.
  select realtime.send(jsonb_build_object('table', source), 'changed', topic, true)
$$;
revoke execute on function app.signal(text, text) from public, anon, authenticated;

-- A project is students' to hear about once it has opened, before or after
-- the change; a draft or a project not yet open is staff's alone.
create or replace function app.signal_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_now public.project := case when tg_op = 'DELETE' then old else new end;
  visible boolean :=
       (tg_op <> 'INSERT' and old.available_after is not null and old.available_after <= now())
    or (tg_op <> 'DELETE' and new.available_after is not null and new.available_after <= now());
begin
  perform app.signal('edition:' || row_now.edition_id || ':staff', tg_table_name);
  if visible then
    perform app.signal('edition:' || row_now.edition_id, tg_table_name);
  end if;
  return null;
end
$$;
revoke execute on function app.signal_project() from public, anon, authenticated;
create trigger project_signal after insert or update or delete on public.project
  for each row execute function app.signal_project();

-- A release changes what students can download, if they can see the project.
create or replace function app.signal_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.project;
begin
  select * into p from public.project where project_id = new.project_id;
  perform app.signal('edition:' || p.edition_id || ':staff', tg_table_name);
  if p.available_after is not null and p.available_after <= now() then
    perform app.signal('edition:' || p.edition_id, tg_table_name);
  end if;
  return null;
end
$$;
revoke execute on function app.signal_release() from public, anon, authenticated;
create trigger release_signal after insert on public.project_release
  for each row execute function app.signal_release();

-- The roster is staff's; the person enrolled or removed hears it on their
-- own topic, so a new course appears on their home page.
create or replace function app.signal_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_now public.enrollment := case when tg_op = 'DELETE' then old else new end;
begin
  perform app.signal('edition:' || row_now.edition_id || ':staff', tg_table_name);
  if row_now.user_id is not null then
    perform app.signal('user:' || row_now.user_id, tg_table_name);
  end if;
  return null;
end
$$;
revoke execute on function app.signal_enrollment() from public, anon, authenticated;
create trigger enrollment_signal after insert or update or delete on public.enrollment
  for each row execute function app.signal_enrollment();

-- A submission: staff see it arrive, and so does its author, wherever they
-- have the page open.
create or replace function app.signal_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.signal('edition:' || new.edition_id || ':staff', tg_table_name);
  perform app.signal('user:' || new.author_id, tg_table_name);
  return null;
end
$$;
revoke execute on function app.signal_submission() from public, anon, authenticated;
create trigger submission_signal after insert on public.submission
  for each row execute function app.signal_submission();
