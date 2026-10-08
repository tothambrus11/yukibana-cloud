-- Live pages: who may listen to which topic, and what the database says on
-- each. The payload is never more than a table name, so the claim under test
-- is about whom a change wakes, and that a draft wakes no student.
begin;
select plan(19);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('ta@example.com', 'Assistant', 'ta');
select tests.create_user('student@example.com', 'Student', 'student');
select tests.create_user('outsider@example.com', 'Outsider', 'outsider');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-LIVE', 'Live');
select app.create_edition((select course_id from public.course where code = 'T-LIVE'), '2026');
select app.enrol(tests.edition('T-LIVE', '2026'), 'ta@example.com', 'assistant');
select app.enrol(tests.edition('T-LIVE', '2026'), 'student@example.com');

create temporary table topics (who text, name text);
insert into topics values
  ('edition', 'edition:' || tests.edition('T-LIVE', '2026')),
  ('staff',   'edition:' || tests.edition('T-LIVE', '2026') || ':staff'),
  ('student', 'user:' || tests.uid('student@example.com')),
  ('ta',      'user:' || tests.uid('ta@example.com'));
grant select on topics to authenticated;
create function pg_temp.topic(who text) returns text language sql as $$ select name from topics where topics.who = topic.who $$;

-- Listening.
select tests.authenticate(tests.uid('student@example.com'));
select ok(app.may_listen(pg_temp.topic('edition')), 'a student listens to their edition');
select ok(not app.may_listen(pg_temp.topic('staff')), 'but not to its staff topic');
select ok(app.may_listen(pg_temp.topic('student')), 'a student listens to their own topic');
select ok(not app.may_listen(pg_temp.topic('ta')), 'and not to anybody else''s');
select ok(not app.may_listen('edition:not-a-uuid'), 'a malformed topic is refused, not an error');
select ok(not app.may_listen('realtime:anything'), 'and so is any other shape');
select tests.authenticate(tests.uid('ta@example.com'));
select ok(app.may_listen(pg_temp.topic('staff')), 'an assistant listens to the staff topic');
select tests.authenticate(tests.uid('outsider@example.com'));
select ok(not app.may_listen(pg_temp.topic('edition')), 'somebody not enrolled hears nothing of the edition');

-- Sending. Count what each change put on each topic.
select tests.clear_auth();
delete from realtime.messages where topic in (select name from topics);
create function pg_temp.heard(who text) returns bigint language sql as $$
  select count(*) from realtime.messages where topic = pg_temp.topic(who) $$;

select tests.authenticate(tests.uid('ta@example.com'));
insert into public.project (edition_id, slug, title, kind)
values (tests.edition('T-LIVE', '2026'), 'live-draft', 'Draft', 'rust-cargo');
update public.project set title = 'Still a draft' where slug = 'live-draft';
select tests.clear_auth();
select is(pg_temp.heard('staff'), 2::bigint, 'staff hear a draft being made and edited');
select is(pg_temp.heard('edition'), 0::bigint, 'students do not');

select tests.authenticate(tests.uid('ta@example.com'));
update public.project set available_after = now() - interval '1 hour' where slug = 'live-draft';
select tests.clear_auth();
select is(pg_temp.heard('edition'), 1::bigint, 'students hear it the moment it opens');

select tests.authenticate(tests.uid('ta@example.com'));
select app.publish_release(tests.project('live-draft'), 'v1', null, 'starters/live-1', 1, decode(repeat('aa', 32), 'hex'), 'teacher/live-1', 1, decode(repeat('bb', 32), 'hex'));
select tests.clear_auth();
select is(pg_temp.heard('edition'), 2::bigint, 'and when a release of an open project is published');

select tests.authenticate(tests.uid('ta@example.com'));
insert into public.project (edition_id, slug, title, kind, available_after, deadline, closes_at)
values (tests.edition('T-LIVE', '2026'), 'live-closed', 'Closed', 'rust-cargo', now() - interval '3 days', now() - interval '2 days', now() - interval '1 day');
update public.project set title = 'Closed, renamed' where slug = 'live-closed';
select tests.clear_auth();
select is(pg_temp.heard('edition'), 2::bigint, 'a project that has closed wakes no student either');

select tests.authenticate(tests.uid('student@example.com'));
insert into public.submission (edition_id, project_id, object_key, byte_size, sha256)
values (tests.edition('T-LIVE', '2026'), tests.project('live-draft'), 'submissions/live-1', 1, decode(repeat('cc', 32), 'hex'));
select tests.clear_auth();
select is(pg_temp.heard('student'), 1::bigint, 'a submission wakes its author''s other pages');
select is(pg_temp.heard('edition'), 2::bigint, 'but not their classmates');
select is(pg_temp.heard('staff'), 7::bigint, 'staff heard all seven changes');
select is((select count(*) from realtime.messages where topic in (select name from topics) and payload - 'id' <> jsonb_build_object('table', payload ->> 'table')), 0::bigint,
  'and no message carries anything but the table''s name');

-- The policy itself, as Realtime asks it: a student joining the staff topic
-- reads nothing.
select tests.authenticate(tests.uid('student@example.com'));
select set_config('realtime.topic', pg_temp.topic('staff'), true);
select is((select count(*) from realtime.messages), 0::bigint, 'a student joining the staff topic is refused by the policy');
select set_config('realtime.topic', pg_temp.topic('edition'), true);
select is((select count(*) from realtime.messages), 2::bigint, 'and let into their edition''s');

select * from finish();
rollback;
