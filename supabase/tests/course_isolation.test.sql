-- A teacher sees and adds to only the courses they are in. Another
-- teacher's course is not in their list, and an edition of their own
-- cannot be put under it, even by somebody who knows its id.
begin;
select plan(16);

select tests.create_user('owner@example.com', 'Owner', 'owner');
update public.app_user set role = 'teacher' where user_id = tests.uid('owner@example.com');
select tests.create_user('other@example.com', 'Other teacher', 'other');
update public.app_user set role = 'teacher' where user_id = tests.uid('other@example.com');
select tests.create_user('ta@example.com', 'Assistant teacher', 'ta');
update public.app_user set role = 'teacher' where user_id = tests.uid('ta@example.com');
select tests.create_user('student@example.com', 'Student', 'student');

select tests.authenticate(tests.uid('owner@example.com'));
select app.create_course('T-ISO', 'Isolated');
select app.create_edition((select course_id from public.course where code = 'T-ISO'), '2026');
select app.enrol(tests.edition('T-ISO', '2026'), 'ta@example.com', 'assistant');
select app.enrol(tests.edition('T-ISO', '2026'), 'student@example.com');

select tests.clear_auth();
create temporary table ids as select (select course_id from public.course where code = 'T-ISO') as course;
grant select on ids to authenticated;

-- Another teacher.
select tests.authenticate(tests.uid('other@example.com'));
select is_empty($$ select 1 from public.course where course_id = (select course from ids) $$,
  'a teacher does not see a course they have no edition of');
select is_empty($$ select 1 from public.course_edition $$, 'nor any of its editions');
select ok(not app.may_add_edition((select course from ids)), 'a teacher outside a course may not add to it: false, not null');
select throws_ok($$ select app.create_edition((select course from ids), '2027') $$, '42501', null,
  'a teacher who knows the id cannot add an edition to another teacher''s course');
select throws_ok($$ select app.create_edition(gen_random_uuid(), '2027') $$, '42501', null,
  'and an id that is no course is refused the same way, so the refusal says nothing about which ids exist');

-- A course of their own, before its first edition.
select app.create_course('T-MINE', 'Mine');
select isnt_empty($$ select 1 from public.course where code = 'T-MINE' $$,
  'a teacher sees the course they just created, before it has an edition');
select tests.clear_auth();
create temporary table mine as select course_id from public.course where code = 'T-MINE';
grant select on mine to authenticated;
select tests.authenticate(tests.uid('owner@example.com'));
select is_empty($$ select 1 from public.course where code = 'T-MINE' $$,
  'and nobody else does');
select throws_ok($$ select app.create_edition((select course_id from mine), 'x') $$, '42501', null,
  'nor may they add an edition to it');

-- Inside the course, not as an owner.
select tests.authenticate(tests.uid('ta@example.com'));
select isnt_empty($$ select 1 from public.course where course_id = (select course from ids) $$,
  'an assistant sees the course of their edition');
select ok(not app.may_add_edition((select course from ids)), 'an assistant who is a teacher may not add an edition');
select throws_ok($$ select app.create_edition((select course from ids), '2027') $$, '42501', null,
  'and is refused when they try, since the new edition would make them its owner');
select tests.authenticate(tests.uid('student@example.com'));
select isnt_empty($$ select 1 from public.course where course_id = (select course from ids) $$,
  'a student sees the course of their edition');
select throws_ok($$ select app.create_edition((select course from ids), '2027') $$, '42501', null,
  'and cannot add an edition to it');

-- The owner.
select tests.authenticate(tests.uid('owner@example.com'));
select ok(app.may_add_edition((select course from ids)), 'an owner of one of its editions may add an edition');
select lives_ok($$ select app.create_edition((select course from ids), '2027') $$, 'and does');

select tests.clear_auth();
select results_eq(
  $$ select e.label, r.email, r.role::text from public.course_edition e join public.enrollment r using (edition_id)
     where e.course_id = (select course from ids) order by e.label, r.email $$,
  $$ values ('2026', 'owner@example.com', 'owner'), ('2026', 'student@example.com', 'student'), ('2026', 'ta@example.com', 'assistant'),
            ('2027', 'owner@example.com', 'owner') $$,
  'after every refusal, the course has the owner''s two editions and nobody else''s');

select * from finish();
rollback;
