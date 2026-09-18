-- Submissions: who, when, and never changed.
begin;
select plan(12);

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
values (tests.edition('T-SUB', '2026'), 'sub-closed', 'Closed', 'rust-cargo', now() - interval '2 days', now() - interval '1 day');
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

-- Outside the window, or outside the roster, nothing lands.
select ok(not app.can_submit(tests.project('sub-closed')), 'past the deadline is closed');
select throws_ok(
  $$ insert into public.submission (edition_id, project_id, author_id, object_key, byte_size, sha256)
     values (tests.edition('T-SUB', '2026'), tests.project('sub-closed'), tests.uid('alice@example.com'),
             'submissions/x', 1, decode(repeat('00', 32), 'hex')) $$,
  '42501', null, 'and refuses the insert');
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
select is((select count(*) from public.submission), 2::bigint, 'staff see them all');

-- Nothing changes a submission.
select tests.authenticate(tests.uid('alice@example.com'));
select throws_ok($$ update public.submission set byte_size = 1 $$, '42501', null, 'not an update');
select throws_ok($$ delete from public.submission $$, '42501', null, 'not a delete');

select * from finish();
rollback;
