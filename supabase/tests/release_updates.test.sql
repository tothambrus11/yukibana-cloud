-- Which release is newest, and an older release's starter, for the people
-- who may download the project's starter now and nobody else.
begin;
select plan(22);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('alice@example.com', 'Alice', 'alice');
select tests.create_user('bob@example.com', 'Bob', 'bob');
select tests.create_user('carol@example.com', 'Carol', 'carol');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-UPD', 'Updates');
select app.create_edition((select course_id from public.course where code = 'T-UPD'), '2026');
select app.create_edition((select course_id from public.course where code = 'T-UPD'), '2027');
select app.enrol(tests.edition('T-UPD', '2026'), 'alice@example.com');
select app.enrol(tests.edition('T-UPD', '2026'), 'carol@example.com');
select app.enrol(tests.edition('T-UPD', '2027'), 'bob@example.com');
insert into public.project (edition_id, slug, title, kind, available_after, closes_at)
values (tests.edition('T-UPD', '2026'), 'upd-open', 'Open', 'rust-cargo', now() - interval '1 day', now() + interval '1 day'),
       (tests.edition('T-UPD', '2026'), 'upd-draft', 'Draft', 'rust-cargo', null, null),
       (tests.edition('T-UPD', '2026'), 'upd-later', 'Later', 'rust-cargo', now() + interval '1 day', null),
       (tests.edition('T-UPD', '2026'), 'upd-closed', 'Closed', 'rust-cargo', now() - interval '2 days', now() - interval '1 day');
select app.publish_release(tests.project('upd-open'), '00000000-0000-7000-8000-0000000000a1', 'v1', null,
  'starters/upd-a1', 1, decode(repeat('aa', 32), 'hex'), 'teacher/upd-a1', 1, decode(repeat('bb', 32), 'hex'));
select app.publish_release(tests.project('upd-open'), '00000000-0000-7000-8000-0000000000a2', 'v2', null,
  'starters/upd-a2', 1, decode(repeat('aa', 32), 'hex'), 'teacher/upd-a2', 1, decode(repeat('bb', 32), 'hex'));
select app.publish_release(tests.project('upd-draft'), '00000000-0000-7000-8000-0000000000d1', 'draft', null,
  'starters/upd-d1', 1, decode(repeat('aa', 32), 'hex'), 'teacher/upd-d1', 1, decode(repeat('bb', 32), 'hex'));
select app.publish_release(tests.project('upd-later'), '00000000-0000-7000-8000-0000000000b1', 'later', null,
  'starters/upd-b1', 1, decode(repeat('aa', 32), 'hex'), 'teacher/upd-b1', 1, decode(repeat('bb', 32), 'hex'));
select app.publish_release(tests.project('upd-closed'), '00000000-0000-7000-8000-0000000000c1', 'closed', null,
  'starters/upd-c1', 1, decode(repeat('aa', 32), 'hex'), 'teacher/upd-c1', 1, decode(repeat('bb', 32), 'hex'));

-- Staff see their drafts' releases, as they see the current starter.
select is(app.current_release(tests.project('upd-draft')), '00000000-0000-7000-8000-0000000000d1'::uuid,
  'staff learn the newest release of a draft');
select is(app.release_starter('00000000-0000-7000-8000-0000000000d1'), 'starters/upd-d1',
  'and download its starter');

-- A student whose project is open: the newest release, and any release's
-- starter, which is what a merge needs as its base.
select tests.authenticate(tests.uid('alice@example.com'));
select is(app.current_release(tests.project('upd-open')), '00000000-0000-7000-8000-0000000000a2'::uuid,
  'a student learns which release is the newest of an open project');
select is(app.release_starter('00000000-0000-7000-8000-0000000000a1'), 'starters/upd-a1',
  'and can download the starter of an older release, the one their folder started from');
select is(app.release_starter('00000000-0000-7000-8000-0000000000a2'), 'starters/upd-a2',
  'and of the newest');
select is((select count(*) from public.project_release), 0::bigint,
  'but still cannot read a release row, which carries the teacher archive''s key');

-- Outside the window, nothing: not even that a release exists.
select is(app.current_release(tests.project('upd-draft')), null, 'a student learns no release of a draft');
select is(app.release_starter('00000000-0000-7000-8000-0000000000d1'), null,
  'nor downloads a draft''s starter by its id');
select is(app.current_release(tests.project('upd-later')), null, 'nor of a project that has not opened yet');
select is(app.release_starter('00000000-0000-7000-8000-0000000000b1'), null,
  'nor its starter, even holding the id');
select is(app.current_release(tests.project('upd-closed')), null, 'nor of a project whose window has closed');
select is(app.release_starter('00000000-0000-7000-8000-0000000000c1'), null,
  'nor the starter of a closed project''s release');
select is(app.release_starter('00000000-0000-7000-8000-0000000000ff'), null, 'an id that is no release is nothing');

-- Someone in another edition of the same course, or in none.
select tests.authenticate(tests.uid('bob@example.com'));
select is(app.current_release(tests.project('upd-open')), null, 'a student of another edition learns nothing');
select is(app.release_starter('00000000-0000-7000-8000-0000000000a1'), null,
  'and cannot download a starter of a project outside their edition, holding its id');
select tests.clear_auth();
select tests.create_user('dave@example.com', 'Dave', 'dave');
select tests.authenticate(tests.uid('dave@example.com'));
select is(app.release_starter('00000000-0000-7000-8000-0000000000a1'), null, 'nor can someone enrolled nowhere');

-- A student removed from the edition loses it with the rest.
select tests.authenticate(tests.uid('teacher@example.com'));
select app.unenrol(tests.edition('T-UPD', '2026'), 'carol@example.com');
select tests.authenticate(tests.uid('carol@example.com'));
select is(app.current_release(tests.project('upd-open')), null, 'a removed student learns no release');
select is(app.release_starter('00000000-0000-7000-8000-0000000000a1'), null, 'and downloads no starter');

-- Roles without a person: anonymous requests and project tokens call
-- neither. As in release_ids.test.sql, each acts, and the assertions come
-- afterwards as the suite's own role.
select tests.clear_auth();
create temporary table did (who text, what text, value text, primary key (who, what));
grant select, insert on did to anon, yukibana_publisher;
set local role anon;
do $$
begin
  perform app.current_release(gen_random_uuid());
  insert into did values ('anon', 'current', 'allowed');
exception when insufficient_privilege then
  insert into did values ('anon', 'current', 'denied');
end
$$;
do $$
begin
  perform app.release_starter(gen_random_uuid());
  insert into did values ('anon', 'starter', 'allowed');
exception when insufficient_privilege then
  insert into did values ('anon', 'starter', 'denied');
end
$$;
reset role;
select tests.as_publisher();
do $$
begin
  perform app.current_release(gen_random_uuid());
  insert into did values ('publisher', 'current', 'allowed');
exception when insufficient_privilege then
  insert into did values ('publisher', 'current', 'denied');
end
$$;
do $$
begin
  perform app.release_starter(gen_random_uuid());
  insert into did values ('publisher', 'starter', 'allowed');
exception when insufficient_privilege then
  insert into did values ('publisher', 'starter', 'denied');
end
$$;
select tests.clear_auth();
select is((select value from did where who = 'anon' and what = 'current'), 'denied', 'an anonymous request cannot ask for the newest release');
select is((select value from did where who = 'anon' and what = 'starter'), 'denied', 'nor for a starter');
select is((select value from did where who = 'publisher' and what = 'current'), 'denied', 'a project token cannot ask for the newest release');
select is((select value from did where who = 'publisher' and what = 'starter'), 'denied', 'nor for a starter: it calls its two functions and nothing else');

select * from finish();
rollback;
