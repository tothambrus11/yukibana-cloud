-- A Moodle course as the source of an edition's roster: who may link, and
-- what a sync may and may not change.
begin;
select plan(21);

-- pgTAP's functions are where the LTI role, which reads nothing, cannot see
-- them; for this test only (it rolls back), let it call them.
grant usage on schema extensions, public to yukibana_lti;

select tests.create_user('admin@example.com', 'Admin', 'admin');
update public.app_user set role = 'admin' where user_id = tests.uid('admin@example.com');
select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('other@example.com', 'Other Teacher', 'other');
update public.app_user set role = 'teacher' where user_id = tests.uid('other@example.com');
select tests.create_user('alice@example.com', 'Alice', 'alice');

-- Only an admin registers a platform.
select tests.authenticate(tests.uid('teacher@example.com'));
select throws_ok(
  $$ select app.register_lti_platform('http://moodle', 'cid', '1', 'Moodle', 'http://moodle/auth', 'http://moodle/token', 'http://moodle/certs') $$,
  '42501', null, 'a teacher cannot register a Moodle site');
select tests.authenticate(tests.uid('admin@example.com'));
select lives_ok(
  $$ select app.register_lti_platform('http://moodle', 'cid', '1', 'Moodle', 'http://moodle/auth', 'http://moodle/token', 'http://moodle/certs') $$,
  'an admin registers a Moodle site');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-LTI', 'Linked');
select app.create_edition((select course_id from public.course where code = 'T-LTI'), '2026');
select app.enrol(tests.edition('T-LTI', '2026'), 'handpicked@example.com', 'student');
select tests.authenticate(tests.uid('other@example.com'));
select app.create_course('T-OTHER', 'Other');
select app.create_edition((select course_id from public.course where code = 'T-OTHER'), '2026');

-- Nobody logged in can make a grant or apply a roster; only the LTI role.
select tests.authenticate(tests.uid('teacher@example.com'));
select throws_ok(
  $$ select app.grant_lti_link('\x01', (select platform_id from public.lti_platform), '42', 'CS', 'http://moodle/m') $$,
  '42501', null, 'a teacher cannot make themselves a link grant');
select is((select count(*) from public.lti_platform)::int, 0, 'a teacher does not see the registered platforms');

select tests.clear_auth();
select tests.as_lti();
select app.grant_lti_link('\x01', (select platform_id from app.lti_platform_for('http://moodle', 'cid')), '42', 'CS 101', 'http://moodle/m');
select is((select count(*) from app.lti_platform_for('http://moodle', 'nope'))::int, 0, 'an unknown client id names no platform');
select throws_ok($$ select * from public.lti_link $$, '42501', null, 'the LTI role reads no table');

-- Linking needs both: owning the edition, and the grant.
select tests.clear_auth();
select tests.authenticate(tests.uid('other@example.com'));
select throws_ok(
  $$ select app.link_edition_to_lti(tests.edition('T-LTI', '2026'), '\x01') $$,
  '42501', null, 'a teacher who does not own the edition cannot link it');
select throws_ok(
  $$ select app.link_edition_to_lti(tests.edition('T-OTHER', '2026'), '\x02') $$,
  '42501', null, 'an owner without a grant from the Moodle course cannot link it');
select tests.authenticate(tests.uid('teacher@example.com'));
select lives_ok(
  $$ select app.link_edition_to_lti(tests.edition('T-LTI', '2026'), '\x01') $$,
  'the owner who launched from Moodle links their edition');
select tests.authenticate(tests.uid('other@example.com'));
select throws_ok(
  $$ select app.link_edition_to_lti(tests.edition('T-OTHER', '2026'), '\x01') $$,
  '42501', null, 'a grant is spent once');
select is((select count(*) from public.lti_link)::int, 0, 'an owner of another edition does not see the link');

-- A sync: Instructor is an assistant, Learner a student, nobody an owner.
select tests.clear_auth();
select tests.as_lti();
select throws_ok(
  $$ select * from app.apply_lti_roster((select link_id from app.lti_target_for((select platform_id from app.lti_platform_for('http://moodle', 'cid')), '42')),
       '[{"email": "teacher@example.com", "role": "owner"}]', 'manual') $$,
  '42501', null, 'a roster cannot make an owner');
select throws_ok(
  $$ select * from app.apply_lti_roster((select link_id from app.lti_target_for((select platform_id from app.lti_platform_for('http://moodle', 'cid')), '42')),
       '[]', 'manual') $$,
  '22023', null, 'an empty roster is refused rather than emptying the class');
select results_eq(
  $$ select * from app.apply_lti_roster((select link_id from app.lti_target_for((select platform_id from app.lti_platform_for('http://moodle', 'cid')), '42')),
       '[{"email": "Teacher@example.com", "role": "assistant"},
         {"email": "alice@example.com", "role": "student"},
         {"email": "bob@example.com", "role": "student"},
         {"email": "handpicked@example.com", "role": "assistant"},
         {"role": "student"}]', 'manual') $$,
  $$ values (2, 0, 0) $$,
  'a first sync adds the students it does not know and nothing else');
select tests.clear_auth();
select results_eq(
  $$ select email, role::text, source::text, user_id is not null from public.enrollment
     where edition_id = tests.edition('T-LTI', '2026') order by email $$,
  $$ values ('alice@example.com', 'student', 'sis', true),
            ('bob@example.com', 'student', 'sis', false),
            ('handpicked@example.com', 'student', 'manual', false),
            ('teacher@example.com', 'owner', 'manual', true) $$,
  'the owner stays owner, a hand-made enrolment keeps its role, and an account links at once');

-- Moodle changes: Alice becomes a teacher there, Bob leaves.
select tests.as_lti();
select results_eq(
  $$ select * from app.apply_lti_roster((select link_id from app.lti_target_for((select platform_id from app.lti_platform_for('http://moodle', 'cid')), '42')),
       '[{"email": "teacher@example.com", "role": "assistant"},
         {"email": "alice@example.com", "role": "assistant"}]', 'hint') $$,
  $$ values (0, 1, 1) $$,
  'a later sync changes a role and removes someone gone from Moodle');
select tests.clear_auth();
select is(
  (select count(*) from public.enrollment where edition_id = tests.edition('T-LTI', '2026') and email = 'handpicked@example.com')::int,
  1, 'someone enrolled by hand is never removed by a sync');
select is(
  (select role::text from public.enrollment where edition_id = tests.edition('T-LTI', '2026') and email = 'alice@example.com'),
  'assistant', 'a Moodle teacher becomes an assistant');

-- An owner promoted from the roster is not the sync's any more.
select tests.authenticate(tests.uid('teacher@example.com'));
select app.set_edition_role(tests.edition('T-LTI', '2026'), 'alice@example.com', 'owner');
select tests.clear_auth();
select tests.as_lti();
select results_eq(
  $$ select * from app.apply_lti_roster((select link_id from app.lti_target_for((select platform_id from app.lti_platform_for('http://moodle', 'cid')), '42')),
       '[{"email": "teacher@example.com", "role": "assistant"}]', 'schedule') $$,
  $$ values (0, 0, 0) $$,
  'a sync never removes or demotes an owner, even one it once enrolled');

-- What staff and students see.
select tests.clear_auth();
select tests.authenticate(tests.uid('alice@example.com'));
select is((select count(*) from public.lti_sync_run)::int, 3, 'an owner sees the sync history of their edition');
select tests.clear_auth();
select tests.as_lti();
select app.apply_lti_roster((select link_id from app.lti_target_for((select platform_id from app.lti_platform_for('http://moodle', 'cid')), '42')),
  '[{"email": "teacher@example.com", "role": "assistant"}, {"email": "carol@example.com", "role": "student"}]', 'schedule');
select tests.clear_auth();
select tests.create_user('carol@example.com', 'Carol', 'carol');
select tests.authenticate(tests.uid('carol@example.com'));
select is((select count(*) from public.lti_link)::int, 0, 'a student does not see where the roster comes from');

select * from finish();
rollback;
