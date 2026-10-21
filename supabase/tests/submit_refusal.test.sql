-- Why a submission is refused: said to the edition, and to nobody else.
begin;
select plan(12);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('assistant@example.com', 'Assistant', 'assistant');
select tests.create_user('alice@example.com', 'Alice', 'alice');
select tests.create_user('outsider@example.com', 'Outsider', 'outsider');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-WHY', 'Refusals');
select app.create_edition((select course_id from public.course where code = 'T-WHY'), '2026');
select app.enrol(tests.edition('T-WHY', '2026'), 'alice@example.com');
select app.enrol(tests.edition('T-WHY', '2026'), 'assistant@example.com', 'assistant');
insert into public.project (edition_id, slug, title, kind)
values (tests.edition('T-WHY', '2026'), 'why-draft', 'Draft', 'rust-cargo');
insert into public.project (edition_id, slug, title, kind, available_after)
values (tests.edition('T-WHY', '2026'), 'why-soon', 'Soon', 'rust-cargo', now() + interval '1 day');
insert into public.project (edition_id, slug, title, kind, available_after, closes_at)
values (tests.edition('T-WHY', '2026'), 'why-closed', 'Closed', 'rust-cargo', now() - interval '2 days', now() - interval '1 day');
insert into public.project (edition_id, slug, title, kind, available_after)
values (tests.edition('T-WHY', '2026'), 'why-open', 'Open', 'rust-cargo', now() - interval '1 day');

-- Staff never submit, whatever the window: the owner's own draft is the
-- case that started this.
select results_eq(
  $$ select reason, role::text, course_title, edition_label from app.submit_refusal(tests.project('why-draft')) $$,
  $$ values ('staff', 'owner', 'Refusals', '2026') $$,
  'an owner trying their own draft is told they are its owner, not a student');
select results_eq(
  $$ select reason, role::text from app.submit_refusal(tests.project('why-open')) $$,
  $$ values ('staff', 'owner') $$,
  'and so on an open project, where a student could');
select tests.authenticate(tests.uid('assistant@example.com'));
select results_eq(
  $$ select reason, role::text from app.submit_refusal(tests.project('why-open')) $$,
  $$ values ('staff', 'assistant') $$,
  'an assistant is told they are its assistant');

-- A student is told about the window.
select tests.authenticate(tests.uid('alice@example.com'));
select results_eq(
  $$ select reason, available_after from app.submit_refusal(tests.project('why-draft')) $$,
  $$ values ('not_open', null::timestamptz) $$,
  'a draft is not open yet, and has no date to tell');
select results_eq(
  $$ select reason, available_after > now() from app.submit_refusal(tests.project('why-soon')) $$,
  $$ values ('not_open', true) $$,
  'a project opening tomorrow is not open yet, and says when it opens');
select results_eq(
  $$ select reason, closes_at < now() from app.submit_refusal(tests.project('why-closed')) $$,
  $$ values ('closed', true) $$,
  'a closed project says it closed, and when');
select is_empty(
  $$ select 1 from app.submit_refusal(tests.project('why-open')) $$,
  'an open project gives its student no reason, because there is none');

-- The reasons and the decision agree: a reason exactly where can_submit says no.
select results_eq(
  $$ select p.slug, app.can_submit(p.project_id), exists (select 1 from app.submit_refusal(p.project_id))
     from (values ('why-draft'), ('why-soon'), ('why-closed'), ('why-open')) v(slug)
     cross join lateral (select tests.project(v.slug) as project_id, v.slug) p
     order by 1 $$,
  $$ values ('why-closed', false, true), ('why-draft', false, true), ('why-open', true, false), ('why-soon', false, true) $$,
  'a student has a reason for every project they cannot submit to, and none for the one they can');

-- A reason is not a way in.
select throws_ok(
  $$ insert into public.submission (edition_id, project_id, author_id, object_key, byte_size, sha256)
     values (tests.edition('T-WHY', '2026'), tests.project('why-closed'), tests.uid('alice@example.com'),
             'submissions/why', 1, decode(repeat('00', 32), 'hex')) $$,
  '42501', null, 'being told why does not change that the insert is refused');

-- Outside the edition, nothing: not the reason, not the course, not
-- whether the project exists.
select tests.authenticate(tests.uid('outsider@example.com'));
select is_empty($$ select 1 from app.submit_refusal(tests.project('why-draft')) $$, 'a stranger learns nothing about a draft');
select is_empty($$ select 1 from app.submit_refusal(tests.project('why-closed')) $$, 'nor about a closed project');
select is_empty(
  $$ select 1 from app.submit_refusal('00000000-0000-4000-8000-000000000000') $$,
  'and a project that does not exist looks the same to them');

select * from finish();
rollback;
