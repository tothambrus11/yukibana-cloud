-- Deleting a project, an edition or a course: who may, what it takes with
-- it, and the submissions it never takes.
begin;
select plan(24);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('other@example.com', 'Other teacher', 'other');
update public.app_user set role = 'teacher' where user_id = tests.uid('other@example.com');
select tests.create_user('ta@example.com', 'Assistant', 'ta');
select tests.create_user('student@example.com', 'Student', 'student');
select tests.create_user('stranger@example.com', 'Stranger', 'stranger');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-DEL', 'Deletion');
select app.create_edition((select course_id from public.course where code = 'T-DEL'), '2025');
select app.create_edition((select course_id from public.course where code = 'T-DEL'), '2026');
select app.enrol(tests.edition('T-DEL', '2026'), 'ta@example.com', 'assistant');
select app.enrol(tests.edition('T-DEL', '2026'), 'student@example.com');
insert into public.project (edition_id, slug, title, kind, available_after)
values (tests.edition('T-DEL', '2026'), 'del-empty', 'No submissions', 'rust-cargo', now() - interval '1 day'),
       (tests.edition('T-DEL', '2026'), 'del-kept', 'Has submissions', 'rust-cargo', now() - interval '1 day'),
       (tests.edition('T-DEL', '2025'), 'del-old', 'Last year', 'rust-cargo', null);
select app.publish_release(tests.project('del-empty'), 'v1', null, 'starters/del-1', 1, decode(repeat('aa', 32), 'hex'), 'teacher/del-1', 1, decode(repeat('bb', 32), 'hex'));
select app.publish_release(tests.project('del-old'), 'v1', null, 'starters/del-2', 1, decode(repeat('aa', 32), 'hex'), 'teacher/del-2', 1, decode(repeat('bb', 32), 'hex'));
select app.create_project_token(tests.project('del-empty'), 'ci');

select tests.authenticate(tests.uid('student@example.com'));
insert into public.submission (edition_id, project_id, object_key, byte_size, sha256)
values (tests.edition('T-DEL', '2026'), tests.project('del-kept'), 'submissions/del-1', 1, decode(repeat('cc', 32), 'hex'));

-- Projects.
select throws_ok($$ select app.delete_project(tests.project('del-empty')) $$, '42501', null, 'a student cannot delete a project');
select tests.authenticate(tests.uid('ta@example.com'));
select throws_ok($$ select app.delete_project(tests.project('del-empty')) $$, '42501', null, 'nor can an assistant');
select tests.authenticate(tests.uid('stranger@example.com'));
select throws_ok($$ select app.delete_project(tests.project('del-empty')) $$, '42501', null, 'nor somebody outside the edition');
select throws_ok($$ select app.delete_project(gen_random_uuid()) $$, '42501', null, 'and a project that does not exist reads the same as one they may not touch');

select tests.authenticate(tests.uid('teacher@example.com'));
select throws_ok($$ select app.delete_project(tests.project('del-kept')) $$, '23503', null, 'an owner cannot delete a project that has submissions');
select results_eq(
  $$ select k from app.delete_project(tests.project('del-empty')) as k order by k $$,
  $$ values ('starters/del-1'), ('teacher/del-1') $$,
  'deleting a project names its release objects, for the Worker to remove');
select tests.clear_auth();
select is((select count(*) from public.project where slug = 'del-empty'), 0::bigint, 'and the project is gone');
select is((select count(*) from public.project_release where starter_key = 'starters/del-1'), 0::bigint, 'with its releases');
select is((select count(*) from public.project_token t where not exists (select 1 from public.project p where p.project_id = t.project_id)), 0::bigint, 'and its tokens');
select is((select count(*) from public.audit_log where action = 'delete_project'), 1::bigint, 'and the audit log says so');

-- Editions.
select tests.authenticate(tests.uid('ta@example.com'));
select throws_ok($$ select app.delete_edition(tests.edition('T-DEL', '2025')) $$, '42501', null, 'an assistant cannot delete an edition');
select tests.authenticate(tests.uid('stranger@example.com'));
select throws_ok($$ select app.delete_edition(tests.edition('T-DEL', '2025')) $$, '42501', null, 'nor can a stranger who knows its id');
select tests.authenticate(tests.uid('teacher@example.com'));
select throws_ok($$ select app.delete_edition(tests.edition('T-DEL', '2026')) $$, '23503', null, 'an owner cannot delete an edition that has submissions');

-- Courses: the other teacher runs an edition of it, so its owner cannot
-- take that with the course.
select tests.authenticate(tests.uid('other@example.com'));
select ok(not app.may_delete_course((select course_id from public.course where code = 'T-DEL')), 'a teacher who owns none of a course''s editions may not delete it');
select throws_ok($$ select app.delete_course((select course_id from public.course where code = 'T-DEL')) $$, '42501', null, 'and is refused');
select app.create_edition((select course_id from public.course where code = 'T-DEL'), 'other');
select tests.authenticate(tests.uid('teacher@example.com'));
select ok(not app.may_delete_course((select course_id from public.course where code = 'T-DEL')), 'nor may a teacher while somebody else owns one of them');

select results_eq(
  $$ select k from app.delete_edition(tests.edition('T-DEL', '2025')) as k order by k $$,
  $$ values ('starters/del-2'), ('teacher/del-2') $$,
  'deleting an edition names the release objects of all its projects');
select tests.clear_auth();
select is((select count(*) from public.course_edition where label = '2025'), 0::bigint, 'and the edition is gone');
select is((select count(*) from public.project where slug = 'del-old'), 0::bigint, 'with its projects');

-- An empty course: its maker and admins may delete it, nobody else.
select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-EMPTY', 'Nothing in it');
select tests.authenticate(tests.uid('other@example.com'));
select throws_ok($$ select app.delete_course((select course_id from public.course where code = 'T-EMPTY')) $$, '42501', null, 'another teacher cannot delete an empty course they did not make');
select tests.authenticate(tests.uid('student@example.com'));
select throws_ok($$ select app.delete_course((select course_id from public.course c where c.code = 'T-DEL')) $$, '42501', null, 'a student cannot delete a course');
select tests.authenticate(tests.uid('teacher@example.com'));
select lives_ok($$ select app.delete_course((select course_id from public.course where code = 'T-EMPTY')) $$, 'its maker can');

-- A course whose every edition the caller owns, with submissions in one.
select tests.authenticate(tests.uid('other@example.com'));
select app.delete_edition(tests.edition('T-DEL', 'other'));
select tests.authenticate(tests.uid('teacher@example.com'));
select throws_ok($$ select app.delete_course((select course_id from public.course where code = 'T-DEL')) $$, '23503', null, 'a course with submissions cannot be deleted, even by the owner of all of it');
select tests.clear_auth();
select is((select count(*) from public.submission where object_key = 'submissions/del-1'), 1::bigint, 'and the submission is still there');

select * from finish();
rollback;
