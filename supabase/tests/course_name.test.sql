-- Each edition carries the course name it ran under; its owners rename it,
-- and the course shows the name of its latest edition. Nobody else renames
-- anything: not an assistant, not a student, not a stranger, not a teacher
-- who owns no edition of the course.
begin;
select plan(20);

select col_not_null('public', 'course_edition', 'title', 'every edition has a course name: the column says so, not just the functions');

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('other@example.com', 'Other teacher', 'other');
update public.app_user set role = 'teacher' where user_id = tests.uid('other@example.com');
select tests.create_user('ta@example.com', 'Assistant', 'ta');
select tests.create_user('student@example.com', 'Student', 'student');
select tests.create_user('stranger@example.com', 'Stranger', 'stranger');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-REN', 'Old name');
select app.create_edition((select course_id from public.course where code = 'T-REN'), '2025');
select app.enrol(tests.edition('T-REN', '2025'), 'ta@example.com', 'assistant');
select app.enrol(tests.edition('T-REN', '2025'), 'student@example.com');

-- Ids that survive renames, readable by whoever the test is at the time.
select tests.clear_auth();
create temporary table ids as
  select tests.edition('T-REN', '2025') as old, (select course_id from public.course where code = 'T-REN') as course;
grant select on ids to authenticated;

select is((select title from public.course_edition where edition_id = (select old from ids)), 'Old name',
  'a first edition takes the name the course was created with');

-- Refusals first, while there is one edition to refuse them on.
select tests.authenticate(tests.uid('ta@example.com'));
select throws_ok($$ select app.update_edition((select old from ids), '2025', 'Hijacked') $$, '42501', null,
  'an assistant cannot rename the edition');
select throws_ok($$ select app.set_course_code((select course from ids), 'HIJACK') $$, '42501', null,
  'nor change the course code');
select tests.authenticate(tests.uid('student@example.com'));
select throws_ok($$ select app.update_edition((select old from ids), '2025', 'Hijacked') $$, '42501', null,
  'a student cannot rename the edition');
select throws_ok($$ select app.set_course_code((select course from ids), 'HIJACK') $$, '42501', null,
  'nor change the course code');
select tests.authenticate(tests.uid('stranger@example.com'));
select throws_ok($$ select app.update_edition((select old from ids), '2025', 'Hijacked') $$, '42501', null,
  'a stranger who knows the id cannot rename the edition');
select tests.authenticate(tests.uid('other@example.com'));
select throws_ok($$ select app.update_edition((select old from ids), '2025', 'Hijacked') $$, '42501', null,
  'a teacher who owns no edition of the course cannot rename one');
select throws_ok($$ select app.set_course_code((select course from ids), 'HIJACK') $$, '42501', null,
  'nor change its code');

select tests.authenticate(tests.uid('teacher@example.com'));
select throws_ok($$ select app.update_edition((select old from ids), '  ', 'A name') $$, '23514', null,
  'an owner cannot blank the label');
select throws_ok($$ select app.update_edition((select old from ids), '2025', '') $$, '23514', null,
  'nor the course name');
select throws_ok($$ select app.set_course_code((select course from ids), '') $$, '23514', null,
  'nor the code');

select tests.clear_auth();
select results_eq(
  $$ select c.code, c.title, e.label, e.title from public.course_edition e join public.course c using (course_id)
     where course_id = (select course from ids) $$,
  $$ values ('T-REN', 'Old name', '2025', 'Old name') $$,
  'after every refusal, the course and its edition are as they were');

-- An owner renames.
select tests.authenticate(tests.uid('teacher@example.com'));
select lives_ok($$ select app.update_edition((select old from ids), ' 2025 autumn ', ' New name ') $$,
  'an owner renames the edition and its course name');
select tests.clear_auth();
select results_eq(
  $$ select e.label, e.title, c.title from public.course_edition e join public.course c using (course_id)
     where course_id = (select course from ids) $$,
  $$ values ('2025 autumn', 'New name', 'New name') $$,
  'trimmed, and the course shows the name of its only edition');

-- A second edition, renamed: the course follows the latest one, and the
-- older edition keeps the name it ran under.
-- Inside one transaction every `created_at` is the same, so "latest" falls
-- to the ids, which are ordered by the millisecond: wait one out.
select pg_sleep(0.002);
select tests.authenticate(tests.uid('teacher@example.com'));
select app.duplicate_edition((select old from ids), '2026');
select is((select title from public.course_edition where edition_id = tests.edition('T-REN', '2026')), 'New name',
  'a duplicate keeps the name of the edition it was copied from');
select app.update_edition(tests.edition('T-REN', '2026'), '2026', 'Newest name');
select app.update_edition((select old from ids), '2025 autumn', 'Old name again');
select tests.clear_auth();
select results_eq(
  $$ select e.label, e.title, c.title from public.course_edition e join public.course c using (course_id)
     where course_id = (select course from ids) order by e.label $$,
  $$ values ('2025 autumn', 'Old name again', 'Newest name'), ('2026', 'Newest name', 'Newest name') $$,
  'the course shows its latest edition''s name, whichever was renamed last');

select pg_sleep(0.002);
select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_edition((select course from ids), '2027');
select is((select title from public.course_edition where edition_id = tests.edition('T-REN', '2027')), 'Newest name',
  'a new edition starts with the course''s current name');
select throws_ok($$ select app.update_edition(tests.edition('T-REN', '2027'), '2026', 'x') $$, '23505', null,
  'a label another edition of the course has is refused');

-- The owner of any one edition may change the shared code.
select lives_ok($$ select app.set_course_code((select course from ids), 'T-REN2') $$,
  'an owner of one of its editions changes the course code');

select * from finish();
rollback;
