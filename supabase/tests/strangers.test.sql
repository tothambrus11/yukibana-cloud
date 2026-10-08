-- Somebody outside an edition, who knows its id, can change nothing about it.
--
-- The roster functions once checked `role_in(edition) <> 'owner'`, which is
-- null, not true, for a person with no role, so the check let strangers
-- through (see 20261008120000_owner_checks_refuse_strangers.sql). An
-- edition id is in every edition URL; these are the people who have one
-- and no business with it.
begin;
select plan(8);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('stranger@example.com', 'Stranger', 'stranger');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-STR', 'Strangers');
select app.create_edition((select course_id from public.course where code = 'T-STR'), '2026');
select app.enrol(tests.edition('T-STR', '2026'), 'student@example.com');

create temporary table e as select tests.edition('T-STR', '2026') as id;
grant select on e to authenticated;

select tests.authenticate(tests.uid('stranger@example.com'));
select ok(not app.is_owner((select id from e)), 'a stranger is not an owner: false, not null');
select throws_ok($$ select app.enrol((select id from e), 'stranger@example.com', 'owner') $$, '42501', null, 'a stranger cannot enrol themselves as owner');
select throws_ok($$ select app.enrol((select id from e), 'friend@example.com') $$, '42501', null, 'nor enrol anybody else');
select throws_ok($$ select app.set_edition_role((select id from e), 'student@example.com', 'owner') $$, '42501', null, 'nor change a role');
select throws_ok($$ select app.unenrol((select id from e), 'teacher@example.com') $$, '42501', null, 'nor remove anybody');
select throws_ok($$ select app.archive_edition((select id from e), true) $$, '42501', null, 'nor archive the edition');
select throws_ok($$ select app.duplicate_edition((select id from e), 'copy') $$, '42501', null, 'nor duplicate it');

select tests.clear_auth();
select results_eq(
  $$ select email, role::text from public.enrollment where edition_id = (select id from e) order by email $$,
  $$ values ('student@example.com', 'student'), ('teacher@example.com', 'owner') $$,
  'and the roster is exactly what the owner made it');

select * from finish();
rollback;
