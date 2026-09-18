-- What a student can see of a project, and when.
begin;
select plan(13);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('ta@example.com', 'Assistant', 'ta');
select tests.create_user('student@example.com', 'Student', 'student');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-PROJ', 'Projects');
select app.create_edition((select course_id from public.course where code = 'T-PROJ'), '2026');
select app.enrol(tests.edition('T-PROJ', '2026'), 'ta@example.com', 'assistant');
select app.enrol(tests.edition('T-PROJ', '2026'), 'student@example.com');

-- Only an owner creates a project, and it is stamped with them.
select tests.authenticate(tests.uid('ta@example.com'));
select throws_ok(
  $$ insert into public.project (edition_id, slug, title, kind)
     values (tests.edition('T-PROJ', '2026'), 'nope', 'Nope', 'rust-cargo') $$,
  '42501', null, 'an assistant cannot create a project');
select tests.authenticate(tests.uid('teacher@example.com'));
insert into public.project (edition_id, slug, title, kind, created_by)
values (tests.edition('T-PROJ', '2026'), 'proj-draft', 'Draft', 'scala-sbt', tests.uid('ta@example.com'));
select is(
  (select created_by from public.project where slug = 'proj-draft'),
  tests.uid('teacher@example.com'),
  'the creator is whoever inserted, whatever the row claimed');
insert into public.project (edition_id, slug, title, kind, available_after)
values (tests.edition('T-PROJ', '2026'), 'proj-soon', 'Soon', 'rust-cargo', now() + interval '1 day');
insert into public.project (edition_id, slug, title, kind, available_after, deadline)
values (tests.edition('T-PROJ', '2026'), 'proj-open', 'Open', 'rust-cargo', now() - interval '1 day', now() + interval '1 day');
select throws_ok(
  $$ insert into public.project (edition_id, slug, title, kind, available_after, deadline)
     values (tests.edition('T-PROJ', '2026'), 'proj-bad', 'Bad', 'rust-cargo', now(), now() - interval '1 day') $$,
  '23514', null, 'a deadline before availability is refused');
select throws_ok(
  $$ update public.project set edition_id = tests.edition('T-PROJ', '2026') where slug = 'proj-open' $$,
  '42501', null, 'an owner cannot move a project to another edition');

-- Students see published projects whose date has passed, and nothing else.
select tests.authenticate(tests.uid('student@example.com'));
select results_eq(
  $$ select slug from public.project order by 1 $$,
  $$ values ('proj-open') $$,
  'a student sees the open project, not the draft, not next week''s');
select tests.authenticate(tests.uid('ta@example.com'));
select is((select count(*) from public.project), 3::bigint, 'staff see all three');

-- Builds: the builder writes them, staff read them, students only get the key.
select tests.as_builder();
insert into public.project_build (project_id, status, starter_key, finished_at)
values (tests.project('proj-open'), 'succeeded', 'starters/open/aaa.tar.gz', now() - interval '2 hours');
insert into public.project_build (project_id, status, starter_key, log, started_at, finished_at)
values (tests.project('proj-open'), 'succeeded', 'starters/open/bbb.tar.gz', 'removed tests/hidden/secret.rs',
        now() + interval '1 second', now() + interval '2 seconds');
insert into public.project_build (project_id, status, log, started_at, finished_at)
values (tests.project('proj-open'), 'failed', 'yukibana.json: unknown kind', now() + interval '3 seconds', now() + interval '4 seconds');
insert into public.project_build (project_id, status, starter_key, finished_at)
values (tests.project('proj-draft'), 'succeeded', 'starters/draft/ccc.tar.gz', now());

select tests.authenticate(tests.uid('student@example.com'));
select is_empty($$ select 1 from public.project_build $$, 'a student reads no build rows, and so no logs');
select is(app.current_starter(tests.project('proj-open')), 'starters/open/bbb.tar.gz', 'a student gets the latest successful starter');
select is(app.current_starter(tests.project('proj-draft')), null, 'and nothing for a draft, even though a build exists');
select tests.authenticate(tests.uid('ta@example.com'));
select is((select count(*) from public.project_build), 4::bigint, 'staff read every build');
select is(app.current_starter(tests.project('proj-draft')), 'starters/draft/ccc.tar.gz', 'staff can fetch a draft''s starter to check it');

-- An owner asks for a rebuild by queueing; a student cannot.
select tests.authenticate(tests.uid('teacher@example.com'));
select lives_ok(
  $$ insert into public.project_build (project_id, status) values (tests.project('proj-open'), 'queued') $$,
  'an owner queues a rebuild');
select tests.authenticate(tests.uid('student@example.com'));
select throws_ok(
  $$ insert into public.project_build (project_id, status) values (tests.project('proj-open'), 'queued') $$,
  '42501', null, 'a student cannot');

select * from finish();
rollback;
