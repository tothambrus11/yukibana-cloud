-- Who a person is, and who may say so.
begin;
select plan(17);

-- The trigger on auth.users creates the profile with what GitHub said.
select tests.create_user('ada@example.com', 'Ada Lovelace', 'ada');
select results_eq(
  $$ select full_name, github_login, role::text from public.app_user where user_id = tests.uid('ada@example.com') $$,
  $$ values ('Ada Lovelace', 'ada', 'user') $$,
  'a login creates a profile with the provider''s name and handle, as a plain user');

-- The first admin is made by an operator, once. Before that person has
-- logged in, the call is a no-op, so a deploy can run it before the app exists.
select ok(not app.bootstrap_admin('nobody@example.com'), 'an address with no account yet changes nothing');
select ok(app.bootstrap_admin('ada@example.com'), 'the first admin is bootstrapped from an address');
select is((select role::text from public.app_user where user_id = tests.uid('ada@example.com')), 'admin');
select tests.create_user('grace@example.com', 'Grace Hopper', 'grace');
select ok(not app.bootstrap_admin('grace@example.com'), 'bootstrapping again changes nothing once an admin exists');
select is((select role::text from public.app_user where user_id = tests.uid('grace@example.com')), 'user');

-- A person cannot promote themselves: the column has no update grant.
select tests.authenticate(tests.uid('grace@example.com'));
select throws_ok(
  $$ update public.app_user set role = 'admin' where user_id = tests.uid('grace@example.com') $$,
  '42501', null,
  'a user cannot write their own platform role');
select throws_ok(
  $$ select app.set_platform_role(tests.uid('grace@example.com'), 'admin') $$,
  '42501', null,
  'nor call the function that changes it');
select lives_ok(
  $$ update public.app_user set full_name = 'Rear Admiral Hopper' where user_id = tests.uid('grace@example.com') $$,
  'but may change their own display name');

-- An admin can, and it is written down.
select tests.authenticate(tests.uid('ada@example.com'));
select lives_ok($$ select app.set_platform_role(tests.uid('grace@example.com'), 'teacher') $$, 'an admin makes a teacher');
select tests.clear_auth();
select is((select role::text from public.app_user where user_id = tests.uid('grace@example.com')), 'teacher');
select is(
  (select count(*) from public.audit_log where action = 'set_platform_role' and actor = tests.uid('ada@example.com')),
  1::bigint,
  'and the change is audited with the admin as actor');

-- A profile is visible to those who share an edition, and to nobody else.
select tests.create_user('linus@example.com', 'Linus', 'linus');
select tests.create_user('stranger@example.com', 'Stranger', 'stranger');
select tests.authenticate(tests.uid('grace@example.com'));
select app.create_course('T-IDENT', 'Identity');
select app.create_edition((select course_id from public.course where code = 'T-IDENT'), '2026');
select app.enrol(tests.edition('T-IDENT', '2026'), 'linus@example.com');
select tests.authenticate(tests.uid('linus@example.com'));
select results_eq(
  $$ select github_login from public.app_user order by 1 $$,
  $$ values ('grace'), ('linus') $$,
  'a student sees themselves and the staff of their edition');
select is_empty(
  $$ select 1 from public.app_user where user_id = tests.uid('stranger@example.com') $$,
  'and not someone in no edition of theirs');
select tests.authenticate(tests.uid('stranger@example.com'));
select results_eq(
  $$ select github_login from public.app_user $$,
  $$ values ('stranger') $$,
  'a person in no edition sees only themselves');

-- An admin sees everyone, and can promote by address.
select tests.authenticate(tests.uid('ada@example.com'));
select is(
  (select count(*) from public.app_user where user_id in (tests.uid('ada@example.com'), tests.uid('grace@example.com'), tests.uid('linus@example.com'), tests.uid('stranger@example.com'))),
  4::bigint,
  'an admin sees every profile, shared edition or not');
select lives_ok($$ select app.set_platform_role_by_email('Stranger@Example.com', 'teacher') $$, 'an admin promotes by address, whatever its case');

select * from finish();
rollback;
