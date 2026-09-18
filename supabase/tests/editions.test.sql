-- Duplicating an edition carries the staff and the projects, not the students
-- and not the dates.
begin;
select plan(8);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('ta@example.com', 'Assistant', 'ta');
select tests.create_user('student@example.com', 'Student', 'student');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-DUP', 'Duplication');
select app.create_edition((select course_id from public.course where code = 'T-DUP'), '2025');
select app.enrol(tests.edition('T-DUP', '2025'), 'ta@example.com', 'assistant');
select app.enrol(tests.edition('T-DUP', '2025'), 'student@example.com');
insert into public.project (edition_id, slug, title, kind, available_after, deadline)
values (tests.edition('T-DUP', '2025'), 'dup-p1', 'Project one', 'rust-cargo',
        now() - interval '1 day', now() + interval '1 day');
select app.publish_release(tests.project('dup-p1'), 'v1', null, 'starters/dup-1', 1, decode(repeat('aa', 32), 'hex'), 'teacher/dup-1', 1, decode(repeat('bb', 32), 'hex'));

select tests.authenticate(tests.uid('ta@example.com'));
select throws_ok(
  $$ select app.duplicate_edition(tests.edition('T-DUP', '2025'), '2026') $$,
  '42501', null, 'an assistant cannot duplicate an edition');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.duplicate_edition(tests.edition('T-DUP', '2025'), '2026');
select results_eq(
  $$ select email, role::text from public.enrollment where edition_id = tests.edition('T-DUP', '2026') order by 1 $$,
  $$ values ('ta@example.com', 'assistant'), ('teacher@example.com', 'owner') $$,
  'the staff come along; the students do not');
select results_eq(
  $$ select slug, title, kind::text, available_after, deadline
     from public.project where edition_id = tests.edition('T-DUP', '2026') $$,
  $$ values ('dup-p1', 'Project one', 'rust-cargo', null::timestamptz, null::timestamptz) $$,
  'the projects come along without their dates');
select is(
  (select count(*) from public.project_release r join public.project p on p.project_id = r.project_id where p.edition_id = tests.edition('T-DUP', '2026')),
  0::bigint,
  'and without their releases');
select is(
  (select course_id from public.course_edition where edition_id = tests.edition('T-DUP', '2026')),
  (select course_id from public.course where code = 'T-DUP'),
  'the copy is an edition of the same course');

-- Archiving hides nothing; it is a flag a list sorts on.
select lives_ok($$ select app.archive_edition(tests.edition('T-DUP', '2025'), true) $$);
select isnt(
  (select archived_at from public.course_edition where edition_id = tests.edition('T-DUP', '2025')),
  null, 'archived is a timestamp');
select tests.authenticate(tests.uid('student@example.com'));
select is((select count(*) from public.course_edition), 1::bigint, 'the student still sees the archived edition they were in');

select * from finish();
rollback;
