-- Why a submission is refused: said to the edition, and to nobody else.
--
-- now() is fixed for the whole of this transaction, so a project whose
-- window starts or ends at now() is exactly on the boundary.
begin;
select plan(21);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('assistant@example.com', 'Assistant', 'assistant');
select tests.create_user('alice@example.com', 'Alice', 'alice');
select tests.create_user('carol@example.com', 'Carol', 'carol');
select tests.create_user('dave@example.com', 'Dave', 'dave');
select tests.create_user('admin@example.com', 'Admin', 'admin');
update public.app_user set role = 'admin' where user_id = tests.uid('admin@example.com');
select tests.create_user('outsider@example.com', 'Outsider', 'outsider');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-WHY', 'Refusals');
select app.create_edition((select course_id from public.course where code = 'T-WHY'), '2026');
select app.create_edition((select course_id from public.course where code = 'T-WHY'), '2027');
select app.enrol(tests.edition('T-WHY', '2026'), 'alice@example.com');
select app.enrol(tests.edition('T-WHY', '2026'), 'dave@example.com');
select app.enrol(tests.edition('T-WHY', '2026'), 'assistant@example.com', 'assistant');
select app.enrol(tests.edition('T-WHY', '2027'), 'carol@example.com');
insert into public.project (edition_id, slug, title, kind)
values (tests.edition('T-WHY', '2026'), 'why-draft', 'Draft', 'rust-cargo');
insert into public.project (edition_id, slug, title, kind, available_after)
values (tests.edition('T-WHY', '2026'), 'why-soon', 'Soon', 'rust-cargo', now() + interval '1 day');
insert into public.project (edition_id, slug, title, kind, available_after, closes_at)
values (tests.edition('T-WHY', '2026'), 'why-closed', 'Closed', 'rust-cargo', now() - interval '2 days', now() - interval '1 day');
insert into public.project (edition_id, slug, title, kind, available_after)
values (tests.edition('T-WHY', '2026'), 'why-open', 'Open', 'rust-cargo', now() - interval '1 day');
insert into public.project (edition_id, slug, title, kind, available_after)
values (tests.edition('T-WHY', '2026'), 'why-starts-now', 'Starts now', 'rust-cargo', now());
insert into public.project (edition_id, slug, title, kind, available_after, closes_at)
values (tests.edition('T-WHY', '2026'), 'why-closes-now', 'Closes now', 'rust-cargo', now() - interval '1 day', now());
select app.unenrol(tests.edition('T-WHY', '2026'), 'dave@example.com');

-- Whether the reasons and the decision agree for whoever is asking: a
-- reason exactly where can_submit says no, over every project above.
create temporary view disagreements as
  select p.slug
  from (values ('why-draft'), ('why-soon'), ('why-closed'), ('why-open'), ('why-starts-now'), ('why-closes-now')) v(slug)
  cross join lateral (select v.slug, tests.project(v.slug) as id) p
  where app.can_submit(p.id) = exists (select 1 from app.submit_refusal(p.id));
grant select on disagreements to authenticated;

-- Staff never submit, whatever the window: the owner's own draft is the
-- case that started this.
select results_eq(
  $$ select reason, role::text, course_title, edition_label, at from app.submit_refusal(tests.project('why-draft')) $$,
  $$ values ('staff', 'owner', 'Refusals', '2026', null::timestamptz) $$,
  'an owner trying their own draft is told they are its owner, not a student');
select results_eq(
  $$ select reason, role::text from app.submit_refusal(tests.project('why-open')) $$,
  $$ values ('staff', 'owner') $$,
  'and so on an open project, where a student could');
select is_empty($$ select slug from disagreements $$, 'for the owner, a reason exactly where can_submit says no');
select tests.authenticate(tests.uid('assistant@example.com'));
select results_eq(
  $$ select reason, role::text from app.submit_refusal(tests.project('why-open')) $$,
  $$ values ('staff', 'assistant') $$,
  'an assistant is told they are its assistant');
select is_empty($$ select slug from disagreements $$, 'for the assistant too');

-- A student is told about the window, and when.
select tests.authenticate(tests.uid('alice@example.com'));
select results_eq(
  $$ select reason, at from app.submit_refusal(tests.project('why-draft')) $$,
  $$ values ('not_open', null::timestamptz) $$,
  'a draft is not open yet, and has no date to tell');
select results_eq(
  $$ select reason, at from app.submit_refusal(tests.project('why-soon')) $$,
  $$ values ('not_open', now() + interval '1 day') $$,
  'a project opening tomorrow is not open yet, and says when it opens');
select results_eq(
  $$ select reason, at from app.submit_refusal(tests.project('why-closed')) $$,
  $$ values ('closed', now() - interval '1 day') $$,
  'a closed project says it closed, and when');
select is_empty($$ select 1 from app.submit_refusal(tests.project('why-open')) $$, 'an open project gives its student no reason, because there is none');
select is_empty($$ select 1 from app.submit_refusal(tests.project('why-starts-now')) $$, 'a project is open from the instant it starts');
select results_eq(
  $$ select reason, at from app.submit_refusal(tests.project('why-closes-now')) $$,
  $$ values ('closed', now()) $$,
  'and closed from the instant it closes');
select is_empty($$ select slug from disagreements $$, 'for a student, a reason exactly where can_submit says no, boundaries included');

-- Outside the edition, nothing: not the reason, not the course, not
-- whether the project exists.
select tests.authenticate(tests.uid('carol@example.com'));
select is_empty($$ select 1 from app.submit_refusal(tests.project('why-closed')) $$, 'a student of another edition of the same course learns nothing about a closed project');
select is_empty($$ select 1 from app.submit_refusal(tests.project('why-draft')) $$, 'nor about a draft');
select tests.authenticate(tests.uid('dave@example.com'));
select is_empty($$ select 1 from app.submit_refusal(tests.project('why-closed')) $$, 'a student who was removed from the edition learns nothing');
select tests.authenticate(tests.uid('admin@example.com'));
select is_empty($$ select 1 from app.submit_refusal(tests.project('why-draft')) $$, 'an admin who is not enrolled learns nothing either: the platform role is not an edition role');
select is_empty($$ select 1 from app.submit_refusal(tests.project('why-closed')) $$, 'not even about a closed project');
select tests.authenticate(tests.uid('outsider@example.com'));
select is_empty($$ select 1 from app.submit_refusal(tests.project('why-draft')) $$, 'a stranger learns nothing about a draft');
select is_empty($$ select 1 from app.submit_refusal(tests.project('why-closed')) $$, 'nor about a closed project');
select is_empty(
  $$ select 1 from app.submit_refusal('00000000-0000-4000-8000-000000000000') $$,
  'and a project that does not exist looks the same to them');

select tests.clear_auth();
set local role anon;
select throws_ok(
  $$ select app.submit_refusal('00000000-0000-4000-8000-000000000000') $$,
  '42501', null, 'without a session, nobody may ask at all');

select * from finish();
rollback;
