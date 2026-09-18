-- Enrolment before and after the account exists, and who may enrol.
begin;
select plan(16);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('user@example.com', 'User', 'user1');
select tests.create_user('early@example.com', 'Early Bird', 'early');

-- A plain user cannot create a course; a teacher can, and owns the edition.
select tests.authenticate(tests.uid('user@example.com'));
select throws_ok($$ select app.create_course('X', 'X') $$, '42501', null, 'a plain user cannot create a course');
select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-ENROL', 'Enrolment');
select app.create_edition((select course_id from public.course where code = 'T-ENROL'), '2026');
select is(app.role_in(tests.edition('T-ENROL', '2026'))::text, 'owner', 'the creator of an edition is its owner');

-- Enrolling an address that already has a confirmed account links at once.
select app.enrol(tests.edition('T-ENROL', '2026'), 'Early@Example.com');
select is(
  (select user_id from public.enrollment where edition_id = tests.edition('T-ENROL', '2026') and email = 'early@example.com'),
  tests.uid('early@example.com'),
  'an address with an account links on enrolment, whatever its case');

-- Enrolling an unknown address waits, and links at that person's first
-- confirmed login. An unconfirmed login does not count.
select app.enrol(tests.edition('T-ENROL', '2026'), 'late@example.com');
select is(
  (select user_id from public.enrollment where edition_id = tests.edition('T-ENROL', '2026') and email = 'late@example.com'),
  null,
  'an unknown address is enrolled but unlinked');
select tests.create_user('late@example.com', 'Late Comer', 'late', confirmed => false);
select is(
  (select user_id from public.enrollment where edition_id = tests.edition('T-ENROL', '2026') and email = 'late@example.com'),
  null,
  'an unconfirmed address does not link');
select tests.confirm_user('late@example.com');
select is(
  (select user_id from public.enrollment where edition_id = tests.edition('T-ENROL', '2026') and email = 'late@example.com'),
  tests.uid('late@example.com'),
  'a confirmed address links at that moment');

-- Enrolling twice neither duplicates nor changes the role.
select app.enrol(tests.edition('T-ENROL', '2026'), 'early@example.com', 'assistant');
select results_eq(
  $$ select role::text from public.enrollment where edition_id = tests.edition('T-ENROL', '2026') and email = 'early@example.com' $$,
  $$ values ('student') $$,
  'enrolling an address again changes nothing, not even the role');
select lives_ok(
  $$ select app.set_edition_role(tests.edition('T-ENROL', '2026'), 'early@example.com', 'assistant') $$,
  'a role change is its own action');

-- Only an owner enrols or removes.
select tests.authenticate(tests.uid('early@example.com'));
select throws_ok(
  $$ select app.enrol(tests.edition('T-ENROL', '2026'), 'friend@example.com') $$,
  '42501', null, 'an assistant cannot enrol');
select tests.authenticate(tests.uid('late@example.com'));
select throws_ok(
  $$ select app.unenrol(tests.edition('T-ENROL', '2026'), 'early@example.com') $$,
  '42501', null, 'a student cannot unenrol anyone');

-- What each sees of the roster.
select results_eq(
  $$ select email from public.enrollment order by 1 $$,
  $$ values ('late@example.com') $$,
  'a student sees only their own enrolment row');
select tests.authenticate(tests.uid('early@example.com'));
select is(
  (select count(*) from public.enrollment where edition_id = tests.edition('T-ENROL', '2026')),
  3::bigint,
  'an assistant sees the whole roster');
select tests.authenticate(tests.uid('user@example.com'));
select is_empty($$ select 1 from public.course_edition $$, 'someone in no edition sees no edition');
select is_empty($$ select 1 from public.course $$, 'nor its course');

-- The last owner stays.
select tests.authenticate(tests.uid('teacher@example.com'));
select throws_ok(
  $$ select app.unenrol(tests.edition('T-ENROL', '2026'), 'teacher@example.com') $$,
  '23514', null, 'the last owner cannot remove themselves');
select throws_ok(
  $$ select app.set_edition_role(tests.edition('T-ENROL', '2026'), 'teacher@example.com', 'student') $$,
  '23514', null, 'nor step down');

select * from finish();
rollback;
