-- What a student can see of a project, and when; releases and tokens.
begin;
select plan(18);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('ta@example.com', 'Assistant', 'ta');
select tests.create_user('student@example.com', 'Student', 'student');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-PROJ', 'Projects');
select app.create_edition((select course_id from public.course where code = 'T-PROJ'), '2026');
select app.enrol(tests.edition('T-PROJ', '2026'), 'ta@example.com', 'assistant');
select app.enrol(tests.edition('T-PROJ', '2026'), 'student@example.com');

-- Only an owner creates a project, and it is stamped with them.
select tests.authenticate(tests.uid('ta@example.com'));
select throws_ok(
  $$ insert into public.project (edition_id, slug, title, kind)
     values (tests.edition('T-PROJ', '2026'), 'nope', 'Nope', 'rust-cargo') $$,
  '42501', null, 'an assistant cannot create a project');
select tests.authenticate(tests.uid('teacher@example.com'));
insert into public.project (edition_id, slug, title, kind, created_by)
values (tests.edition('T-PROJ', '2026'), 'proj-draft', 'Draft', 'scala-sbt', tests.uid('ta@example.com'));
select is(
  (select created_by from public.project where slug = 'proj-draft'),
  tests.uid('teacher@example.com'),
  'the creator is whoever inserted, whatever the row claimed');
insert into public.project (edition_id, slug, title, kind, available_after)
values (tests.edition('T-PROJ', '2026'), 'proj-soon', 'Soon', 'rust-cargo', now() + interval '1 day');
insert into public.project (edition_id, slug, title, kind, available_after, deadline)
values (tests.edition('T-PROJ', '2026'), 'proj-open', 'Open', 'rust-cargo', now() - interval '1 day', now() + interval '1 day');
select throws_ok(
  $$ insert into public.project (edition_id, slug, title, kind, available_after, deadline)
     values (tests.edition('T-PROJ', '2026'), 'proj-bad', 'Bad', 'rust-cargo', now(), now() - interval '1 day') $$,
  '23514', null, 'a deadline before availability is refused');
select throws_ok(
  $$ update public.project set edition_id = tests.edition('T-PROJ', '2026') where slug = 'proj-open' $$,
  '42501', null, 'an owner cannot move a project to another edition');

-- Students see published projects whose date has passed, and nothing else.
select tests.authenticate(tests.uid('student@example.com'));
select results_eq(
  $$ select slug from public.project order by 1 $$,
  $$ values ('proj-open') $$,
  'a student sees the open project, not the draft, not next week''s');
select tests.authenticate(tests.uid('ta@example.com'));
select is((select count(*) from public.project), 3::bigint, 'staff see all three');

-- Releases: an owner publishes manually; staff read them; students only get
-- the newest starter key, and only of a project they may see.
select throws_ok(
  $$ select app.publish_release(tests.project('proj-open'), 'v1', null, 'starters/a', 1, decode(repeat('aa', 32), 'hex'), 'teacher/a', 1, decode(repeat('bb', 32), 'hex')) $$,
  '42501', null, 'an assistant cannot publish');
select tests.authenticate(tests.uid('teacher@example.com'));
select lives_ok(
  $$ select app.publish_release(tests.project('proj-open'), 'v1', null, 'starters/open-1', 1, decode(repeat('aa', 32), 'hex'), 'teacher/open-1', 1, decode(repeat('bb', 32), 'hex')) $$,
  'an owner publishes');
select app.publish_release(tests.project('proj-open'), 'v2', 'abc', 'starters/open-2', 1, decode(repeat('aa', 32), 'hex'), 'teacher/open-2', 1, decode(repeat('bb', 32), 'hex'));
select app.publish_release(tests.project('proj-draft'), 'v1', null, 'starters/draft-1', 1, decode(repeat('aa', 32), 'hex'), 'teacher/draft-1', 1, decode(repeat('bb', 32), 'hex'));

select tests.authenticate(tests.uid('student@example.com'));
select is_empty($$ select 1 from public.project_release $$, 'a student reads no release rows, and so no teacher archive keys');
select is(app.current_starter(tests.project('proj-open')), 'starters/open-2', 'a student gets the newest starter');
select is(app.current_starter(tests.project('proj-draft')), null, 'and nothing for a draft, even though a release exists');
select tests.authenticate(tests.uid('ta@example.com'));
select is((select count(*) from public.project_release), 3::bigint, 'staff read every release');
select is(app.current_starter(tests.project('proj-draft')), 'starters/draft-1', 'staff can fetch a draft''s starter to check it');

-- Tokens: made by an owner, usable by the publisher role until revoked.
--
-- The publisher acts here and the assertions come afterwards, as a role that
-- can make them. That is not ceremony: `yukibana_publisher` has usage on
-- nothing but `app`, and a schema a role cannot use is one whose contents it
-- cannot even name, pgTAP's own `is` and `throws_ok` included. Asserting
-- while wearing it would mean granting it something production never gives
-- it, and this role having nothing is the whole claim under test.
select throws_ok($$ select app.create_project_token(tests.project('proj-open'), 'ci') $$, '42501', null, 'an assistant cannot make a token');
select tests.authenticate(tests.uid('teacher@example.com'));
create temporary table t as select app.create_project_token(tests.project('proj-open'), 'ci') as secret;
create temporary table did (what text primary key, value text);
grant select on t to yukibana_publisher;
grant select, insert on did to yukibana_publisher;

select tests.as_publisher();
insert into did values ('named', app.project_for_token(sha256(convert_to((select secret from t), 'UTF8')))::text);
insert into did values ('published', app.publish_release_with_token(
  sha256(convert_to((select secret from t), 'UTF8')), 'ci build', 'def',
  'starters/open-3', 1, decode(repeat('aa', 32), 'hex'),
  'teacher/open-3', 1, decode(repeat('bb', 32), 'hex'))::text);
do $$
begin
  perform 1 from public.project_release;
  insert into did values ('reads', 'allowed');
exception when insufficient_privilege then
  insert into did values ('reads', 'denied');
end
$$;
select tests.clear_auth();
select is((select value from did where what = 'named'), tests.project('proj-open')::text,
  'the publisher turns the token''s hash into its project');
select isnt((select value from did where what = 'published'), null, 'and publishes with it');
select is((select value from did where what = 'reads'), 'denied', 'but reads nothing');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.revoke_project_token((select token_id from public.project_token where label = 'ci'));
select tests.as_publisher();
insert into did values ('after_revoke', coalesce(app.project_for_token(sha256(convert_to((select secret from t), 'UTF8')))::text, 'nothing'));
select tests.clear_auth();
select is((select value from did where what = 'after_revoke'), 'nothing', 'a revoked token names nothing');

select * from finish();
rollback;
