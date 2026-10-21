-- Release ids chosen by the publisher, and the base release a submission
-- names: always a release of its own project, never another's.
begin;
select plan(12);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('alice@example.com', 'Alice', 'alice');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-REL', 'Release ids');
select app.create_edition((select course_id from public.course where code = 'T-REL'), '2026');
select app.enrol(tests.edition('T-REL', '2026'), 'alice@example.com');
insert into public.project (edition_id, slug, title, kind, available_after, deadline)
values (tests.edition('T-REL', '2026'), 'rel-one', 'One', 'rust-cargo', now() - interval '1 day', now() + interval '1 day');
insert into public.project (edition_id, slug, title, kind, available_after, deadline)
values (tests.edition('T-REL', '2026'), 'rel-two', 'Two', 'rust-cargo', now() - interval '1 day', now() + interval '1 day');

-- The id the publisher wrote into the starter is the row's id.
select is(
  app.publish_release(tests.project('rel-one'), '00000000-0000-7000-8000-00000000000a', 'v1', null,
    'starters/rel-1', 1, decode(repeat('aa', 32), 'hex'), 'teacher/rel-1', 1, decode(repeat('bb', 32), 'hex')),
  '00000000-0000-7000-8000-00000000000a'::uuid,
  'a release keeps the id its publisher chose');
select isnt(
  app.publish_release(tests.project('rel-one'), null, 'v2', null,
    'starters/rel-2', 1, decode(repeat('aa', 32), 'hex'), 'teacher/rel-2', 1, decode(repeat('bb', 32), 'hex')),
  null,
  'and without one the database chooses');
select throws_ok(
  $$ select app.publish_release(tests.project('rel-one'), '00000000-0000-7000-8000-00000000000a', 'again', null,
       'starters/rel-x', 1, decode(repeat('aa', 32), 'hex'), 'teacher/rel-x', 1, decode(repeat('bb', 32), 'hex')) $$,
  '23505', null, 'the same id twice is refused, not overwritten');
select throws_ok(
  $$ select app.publish_release(tests.project('rel-two'), '00000000-0000-7000-8000-00000000000a', 'stolen', null,
       'starters/rel-y', 1, decode(repeat('aa', 32), 'hex'), 'teacher/rel-y', 1, decode(repeat('bb', 32), 'hex')) $$,
  '23505', null, 'and so is another project''s id: a release cannot be moved by naming it');
select is(
  (select project_id from public.project_release where release_id = '00000000-0000-7000-8000-00000000000a'),
  tests.project('rel-one'),
  'which still belongs to the project that published it');
select app.publish_release(tests.project('rel-two'), '00000000-0000-7000-8000-00000000000b', 'v1', null,
  'starters/rel-two-1', 1, decode(repeat('aa', 32), 'hex'), 'teacher/rel-two-1', 1, decode(repeat('bb', 32), 'hex'));

-- A student cannot publish whatever id they choose.
select tests.authenticate(tests.uid('alice@example.com'));
select throws_ok(
  $$ select app.publish_release(tests.project('rel-one'), '00000000-0000-7000-8000-00000000000c', 'mine', null,
       'starters/rel-z', 1, decode(repeat('aa', 32), 'hex'), 'teacher/rel-z', 1, decode(repeat('bb', 32), 'hex')) $$,
  '42501', null, 'a student cannot publish a release, chosen id or not');

-- The base a submission names: kept when it is a release of its project,
-- forgotten when it is another project's or nobody's.
insert into public.submission (edition_id, project_id, author_id, object_key, byte_size, sha256, base_release_id)
values (tests.edition('T-REL', '2026'), tests.project('rel-one'), tests.uid('alice@example.com'),
        'submissions/rel-ok', 1, decode(repeat('00', 32), 'hex'), '00000000-0000-7000-8000-00000000000a');
insert into public.submission (edition_id, project_id, author_id, object_key, byte_size, sha256, base_release_id)
values (tests.edition('T-REL', '2026'), tests.project('rel-one'), tests.uid('alice@example.com'),
        'submissions/rel-other', 1, decode(repeat('00', 32), 'hex'), '00000000-0000-7000-8000-00000000000b');
insert into public.submission (edition_id, project_id, author_id, object_key, byte_size, sha256, base_release_id)
values (tests.edition('T-REL', '2026'), tests.project('rel-one'), tests.uid('alice@example.com'),
        'submissions/rel-none', 1, decode(repeat('00', 32), 'hex'), '00000000-0000-7000-8000-0000000000ff');
select is((select base_release_id from public.submission where object_key = 'submissions/rel-ok'),
  '00000000-0000-7000-8000-00000000000a'::uuid, 'a submission records the release of its own project it started from');
select is((select base_release_id from public.submission where object_key = 'submissions/rel-other'),
  null, 'but not another project''s release, even one in the same edition');
select is((select base_release_id from public.submission where object_key = 'submissions/rel-none'),
  null, 'nor an id that is no release at all');
select is((select count(*) from public.submission where object_key like 'submissions/rel-%'), 3::bigint,
  'and a wrong claim costs the student nothing: all three were handed in');
select throws_ok(
  $$ select app.is_release_of(tests.project('rel-one'), '00000000-0000-7000-8000-00000000000a') $$,
  '42501', null, 'a student cannot ask which ids are releases');

-- Even the table's owner cannot pin a submission to another project's
-- release: the foreign key holds where the trigger is not asked.
select tests.clear_auth();
select throws_ok(
  $$ update public.submission set base_release_id = '00000000-0000-7000-8000-00000000000b'
     where object_key = 'submissions/rel-ok' $$,
  '23503', null, 'the database itself refuses a base from another project');

select * from finish();
rollback;
