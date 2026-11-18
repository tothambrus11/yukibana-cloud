-- Everybody sees only the editions they are in. Another teacher's course is
-- not in a teacher's list, an edition of their own cannot be put under it,
-- and somebody in one edition of a course does not learn what a later
-- edition they are not in is called. Admins are owner and staff of every
-- edition, and nobody else is.
begin;
select plan(26);

select tests.create_user('owner@example.com', 'Owner', 'owner');
update public.app_user set role = 'teacher' where user_id = tests.uid('owner@example.com');
select tests.create_user('other@example.com', 'Other teacher', 'other');
update public.app_user set role = 'teacher' where user_id = tests.uid('other@example.com');
select tests.create_user('ta@example.com', 'Assistant teacher', 'ta');
update public.app_user set role = 'teacher' where user_id = tests.uid('ta@example.com');
select tests.create_user('admin@example.com', 'Admin', 'admin');
update public.app_user set role = 'admin' where user_id = tests.uid('admin@example.com');
select tests.create_user('student@example.com', 'Student', 'student');

select tests.authenticate(tests.uid('owner@example.com'));
select app.create_course('T-ISO', 'Isolated', '2026');
select app.enrol(tests.edition('T-ISO', '2026'), 'ta@example.com', 'assistant');
select app.enrol(tests.edition('T-ISO', '2026'), 'student@example.com');
insert into public.project (edition_id, slug, title, kind) values (tests.edition('T-ISO', '2026'), 'p', 'P', 'rust-cargo');

select tests.clear_auth();
create temporary table ids as select (select course_id from public.course where code = 'T-ISO') as course;
grant select on ids to authenticated;
select results_eq(
  $$ select r.email, r.role::text from public.enrollment r where r.edition_id = tests.edition('T-ISO', '2026') and r.role = 'owner' $$,
  $$ values ('owner@example.com', 'owner') $$,
  'a course is created with its first edition, owned by whoever created it');

-- Another teacher.
select tests.authenticate(tests.uid('other@example.com'));
select is_empty($$ select 1 from public.course where course_id = (select course from ids) $$,
  'a teacher does not see a course they have no edition of');
select is_empty($$ select 1 from public.course_edition $$, 'nor any of its editions');
select is(app.course_name((select course from ids)), null, 'nor its name');
select ok(not app.may_add_edition((select course from ids)), 'a teacher outside a course may not add to it: false, not null');
select throws_ok($$ select app.create_edition((select course from ids), '2027') $$, '42501', null,
  'a teacher who knows the id cannot add an edition to another teacher''s course');
select throws_ok($$ select app.create_edition(gen_random_uuid(), '2027') $$, '42501', null,
  'and an id that is no course is refused the same way, so the refusal says nothing about which ids exist');
select throws_ok($$ select app.enrol(tests.edition('T-ISO', '2026'), 'other@example.com', 'owner') $$, '42501', null,
  'nor can they enrol themselves into it');

-- Inside the course, not as an owner.
select tests.authenticate(tests.uid('ta@example.com'));
select isnt_empty($$ select 1 from public.course where course_id = (select course from ids) $$,
  'an assistant sees the course of their edition');
select ok(not app.may_add_edition((select course from ids)), 'an assistant who is a teacher may not add an edition');
select throws_ok($$ select app.create_edition((select course from ids), '2027') $$, '42501', null,
  'and is refused when they try, since the new edition would make them its owner');
select tests.authenticate(tests.uid('student@example.com'));
select throws_ok($$ select app.create_edition((select course from ids), '2027') $$, '42501', null,
  'a student cannot add an edition to their course');
select throws_ok($$ select title from public.course $$, '42501', null,
  'and nobody reads the course''s own name column, which once followed its latest edition');

-- A later edition the earlier edition's people are not in. The owner of
-- 2026 adds 2027, renames it, and hands it to the other teacher.
select tests.authenticate(tests.uid('owner@example.com'));
select app.create_edition((select course from ids), '2027');
select app.update_edition(tests.edition('T-ISO', '2027'), '2027', 'Renamed next year');
select app.enrol(tests.edition('T-ISO', '2027'), 'other@example.com', 'owner');
select app.unenrol(tests.edition('T-ISO', '2027'), 'owner@example.com');

select tests.authenticate(tests.uid('student@example.com'));
select results_eq($$ select label from public.course_edition $$, $$ values ('2026') $$,
  'a student of one edition sees that edition and not the course''s next one');
select is(app.course_name((select course from ids)), 'Isolated', 'the course''s name, to them, is their edition''s');
select tests.authenticate(tests.uid('owner@example.com'));
select results_eq($$ select label from public.course_edition $$, $$ values ('2026') $$,
  'nor does the owner of the earlier edition, once out of the later one');
select is(app.course_name((select course from ids)), 'Isolated', 'and to them too');
select tests.authenticate(tests.uid('other@example.com'));
select is(app.course_name((select course from ids)), 'Renamed next year', 'the owner of the later edition sees its name');
select is_empty($$ select 1 from public.course_edition where label = '2026' $$, 'and not the earlier edition');

-- An admin.
select tests.authenticate(tests.uid('admin@example.com'));
select results_eq($$ select label from public.course_edition where course_id = (select course from ids) order by label $$,
  $$ values ('2026'), ('2027') $$, 'an admin sees every edition of every course');
select ok(app.is_owner(tests.edition('T-ISO', '2026')) and app.is_staff(tests.edition('T-ISO', '2026')),
  'and is owner and staff of each, without being on its roster');
select isnt_empty($$ select 1 from public.enrollment where edition_id = tests.edition('T-ISO', '2026') $$, 'sees every roster');
select isnt_empty($$ select 1 from public.project where slug = 'p' $$, 'and every project, drafts included');
select lives_ok($$ select app.enrol(tests.edition('T-ISO', '2026'), 'new@example.com', 'owner') $$,
  'manages an edition they are not enrolled in');
select ok(app.may_add_edition((select course from ids)), 'and may add an edition to any course');

select tests.clear_auth();
select is_empty($$ select 1 from public.enrollment where email = 'admin@example.com' $$,
  'all of it without appearing on any roster');

select * from finish();
rollback;
