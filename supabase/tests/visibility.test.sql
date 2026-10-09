-- Who sees which editions: a teacher every one, so a course reads whole;
-- a student theirs and nothing else; and seeing an edition is not seeing
-- what is in it.
begin;
select plan(9);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('colleague@example.com', 'Colleague', 'colleague');
update public.app_user set role = 'teacher' where user_id = tests.uid('colleague@example.com');
select tests.create_user('student@example.com', 'Student', 'student');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-VIS', 'Visibility');
select app.create_edition((select course_id from public.course where code = 'T-VIS'), 'mine');
select app.create_edition((select course_id from public.course where code = 'T-VIS'), 'theirs-too');
select app.enrol(tests.edition('T-VIS', 'mine'), 'student@example.com');
insert into public.project (edition_id, slug, title, kind, available_after)
values (tests.edition('T-VIS', 'mine'), 'vis-open', 'Open', 'rust-cargo', now() - interval '1 day');

select tests.authenticate(tests.uid('colleague@example.com'));
select is((select count(*) from public.course_edition e join public.course c using (course_id) where c.code = 'T-VIS'), 2::bigint,
  'a teacher sees every edition of a course, including ones they are not in');
select is((select count(*) from public.project where slug = 'vis-open'), 0::bigint, 'but not the projects of an edition they are not in');
select is((select count(*) from public.enrollment where edition_id = tests.edition('T-VIS', 'mine')), 0::bigint, 'nor its roster');
select results_eq($$ select app.edition_owners(tests.edition('T-VIS', 'mine')) $$, $$ values ('Teacher') $$,
  'and learns who owns it, by name, to ask to be added');
select is(app.role_in(tests.edition('T-VIS', 'mine')), null, 'seeing it does not make them a member');

select tests.authenticate(tests.uid('student@example.com'));
select results_eq($$ select label from public.course_edition $$, $$ values ('mine') $$,
  'a student sees only the editions they are in');
select is((select count(*) from app.edition_owners(tests.edition('T-VIS', 'theirs-too'))), 0::bigint,
  'and cannot learn who owns one they are not in');
select tests.create_user('outsider@example.com', 'Outsider', 'outsider');
select tests.authenticate(tests.uid('outsider@example.com'));
select is((select count(*) from public.course_edition), 0::bigint, 'somebody in nothing sees no edition');
select is((select count(*) from public.course), 0::bigint, 'and no course');

select * from finish();
rollback;
