-- Submissions: who, when, and never changed.
begin;
select plan(20);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('alice@example.com', 'Alice', 'alice');
select tests.create_user('bob@example.com', 'Bob', 'bob');
select tests.create_user('outsider@example.com', 'Outsider', 'outsider');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-SUB', 'Submissions');
select app.create_edition((select course_id from public.course where code = 'T-SUB'), '2026');
select app.enrol(tests.edition('T-SUB', '2026'), 'alice@example.com');
select app.enrol(tests.edition('T-SUB', '2026'), 'bob@example.com');
insert into public.project (edition_id, slug, title, kind, available_after, deadline)
values (tests.edition('T-SUB', '2026'), 'sub-open', 'Open', 'rust-cargo', now() - interval '1 day', now() + interval '1 day');
insert into public.project (edition_id, slug, title, kind, available_after, deadline)
values (tests.edition('T-SUB', '2026'), 'sub-late', 'Late', 'rust-cargo', now() - interval '2 days', now() - interval '1 day');
insert into public.project (edition_id, slug, title, kind, available_after, deadline, closes_at)
values (tests.edition('T-SUB', '2026'), 'sub-closed', 'Closed', 'rust-cargo', now() - interval '3 days', now() - interval '2 days', now() - interval '1 day');
insert into public.project (edition_id, slug, title, kind, available_after)
values (tests.edition('T-SUB', '2026'), 'sub-soon', 'Soon', 'rust-cargo', now() + interval '1 day');

-- A student submits inside the window; the row is theirs whatever it said.
select tests.authenticate(tests.uid('alice@example.com'));
select ok(app.can_submit(tests.project('sub-open')), 'the open project accepts submissions');
insert into public.submission (edition_id, project_id, author_id, submitted_at, object_key, byte_size, sha256)
values (tests.edition('T-SUB', '2026'), tests.project('sub-open'), tests.uid('bob@example.com'), '2000-01-01',
        'submissions/a1', 10, decode(repeat('ab', 32), 'hex'));
select results_eq(
  $$ select author_id, submitted_at > now() - interval '1 minute' from public.submission $$,
  $$ values (tests.uid('alice@example.com'), true) $$,
  'the author and the moment are what the server saw, not what the row claimed');
select lives_ok(
  $$ insert into public.submission (edition_id, project_id, author_id, object_key, byte_size, sha256)
     values (tests.edition('T-SUB', '2026'), tests.project('sub-open'), tests.uid('alice@example.com'),
             'submissions/a2', 11, decode(repeat('cd', 32), 'hex')) $$,
  'a second version is a second row');

-- Past the deadline but inside the window, work is still accepted, and the
-- time the server stamped is what says it was late.
select ok(app.can_submit(tests.project('sub-late')), 'past the deadline a project still accepts late work');
select lives_ok(
  $$ insert into public.submission (edition_id, project_id, author_id, object_key, byte_size, sha256)
     values (tests.edition('T-SUB', '2026'), tests.project('sub-late'), tests.uid('alice@example.com'),
             'submissions/late', 1, decode(repeat('00', 32), 'hex')) $$,
  'and the late submission lands');
select ok(
  (select s.submitted_at > p.deadline from public.submission s join public.project p using (project_id) where s.object_key = 'submissions/late'),
  'its stamped time is after the deadline, which is how it reads as late');

-- Outside the window, or outside the roster, nothing lands.
select ok(not app.can_submit(tests.project('sub-closed')), 'once the window has closed, nothing is accepted');
select throws_ok(
  $$ insert into public.submission (edition_id, project_id, author_id, object_key, byte_size, sha256)
     values (tests.edition('T-SUB', '2026'), tests.project('sub-closed'), tests.uid('alice@example.com'),
             'submissions/x', 1, decode(repeat('00', 32), 'hex')) $$,
  '42501', null, 'and refuses the insert');
select is_empty($$ select 1 from public.project where slug = 'sub-closed' $$, 'a closed project is gone from the student''s view');
select throws_ok(
  $$ insert into public.submission (edition_id, project_id, author_id, object_key, byte_size, sha256)
     values (tests.edition('T-SUB', '2026'), tests.project('sub-soon'), tests.uid('alice@example.com'),
             'submissions/y', 1, decode(repeat('00', 32), 'hex')) $$,
  '42501', null, 'so does a project not yet available');
select tests.authenticate(tests.uid('outsider@example.com'));
select throws_ok(
  $$ insert into public.submission (edition_id, project_id, author_id, object_key, byte_size, sha256)
     values (tests.edition('T-SUB', '2026'), tests.project('sub-open'), tests.uid('outsider@example.com'),
             'submissions/z', 1, decode(repeat('00', 32), 'hex')) $$,
  '42501', null, 'someone not enrolled cannot submit');
select tests.authenticate(tests.uid('teacher@example.com'));
select ok(not app.can_submit(tests.project('sub-open')), 'staff are not students and do not submit');

-- Reading: your own, or everything if you are staff.
select tests.authenticate(tests.uid('bob@example.com'));
select is_empty($$ select 1 from public.submission $$, 'a classmate sees none of Alice''s submissions');
select tests.authenticate(tests.uid('teacher@example.com'));
select is((select count(*) from public.submission), 3::bigint, 'staff see them all');
select tests.authenticate(tests.uid('alice@example.com'));
select is_empty($$ update public.project set closes_at = null where slug = 'sub-closed' returning 1 $$, 'a student cannot reopen a closed project');

-- After the window closes, a student who submitted still learns the
-- deadline, so their own work can read as late or not; nobody else does.
select tests.authenticate(tests.uid('teacher@example.com'));
update public.project set closes_at = now() - interval '1 second' where slug = 'sub-late';
select tests.authenticate(tests.uid('alice@example.com'));
select isnt(app.deadline_of((select project_id from public.submission where object_key = 'submissions/late')), null,
  'the student who submitted still reads the deadline of a closed project');
select tests.authenticate(tests.uid('bob@example.com'));
select is(app.deadline_of(tests.project('sub-late')), null, 'a classmate who did not submit there does not');
select tests.authenticate(tests.uid('outsider@example.com'));
select is(app.deadline_of(tests.project('sub-open')), null, 'nor does someone not enrolled');

-- Nothing changes a submission.
select tests.authenticate(tests.uid('alice@example.com'));
select throws_ok($$ update public.submission set byte_size = 1 $$, '42501', null, 'not an update');
select throws_ok($$ delete from public.submission $$, '42501', null, 'not a delete');

select * from finish();
rollback;
