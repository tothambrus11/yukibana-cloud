-- The order of an edition's projects: who may change it, and that a move
-- touches one row and never runs out of room.
begin;
select plan(14);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('ta@example.com', 'Assistant', 'ta');
select tests.create_user('student@example.com', 'Student', 'student');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-ORD', 'Order');
select app.create_edition((select course_id from public.course where code = 'T-ORD'), '2026');
select app.create_edition((select course_id from public.course where code = 'T-ORD'), '2027');
select app.enrol(tests.edition('T-ORD', '2026'), 'ta@example.com', 'assistant');
select app.enrol(tests.edition('T-ORD', '2026'), 'student@example.com');
insert into public.project (edition_id, slug, title, kind, available_after)
values (tests.edition('T-ORD', '2026'), 'ord-a', 'A', 'rust-cargo', now() - interval '1 day'),
       (tests.edition('T-ORD', '2026'), 'ord-b', 'B', 'rust-cargo', now() - interval '1 day'),
       (tests.edition('T-ORD', '2026'), 'ord-c', 'C', 'rust-cargo', now() - interval '1 day');
insert into public.project (edition_id, slug, title, kind)
values (tests.edition('T-ORD', '2027'), 'ord-other', 'Other', 'rust-cargo');

select results_eq(
  $$ select slug from public.project where edition_id = tests.edition('T-ORD', '2026') order by position $$,
  $$ values ('ord-a'), ('ord-b'), ('ord-c') $$,
  'new projects go to the end of their edition, in the order they were made');

-- An owner moves C between A and B; only C's row changes.
select lives_ok($$ select app.move_project(tests.project('ord-c'), tests.project('ord-a'), tests.project('ord-b')) $$, 'an owner moves a project');
select results_eq(
  $$ select slug from public.project where edition_id = tests.edition('T-ORD', '2026') order by position $$,
  $$ values ('ord-a'), ('ord-c'), ('ord-b') $$,
  'it lands between the two it was dropped between');
select is((select position from public.project where slug = 'ord-a'), 1::numeric, 'and its neighbours keep their positions');

-- Sixty moves into the same gap: the midpoint is exact, so no two collide.
do $$
begin
  for i in 1..60 loop
    perform app.move_project(
      case when i % 2 = 0 then tests.project('ord-c') else tests.project('ord-b') end,
      tests.project('ord-a'),
      case when i % 2 = 0 then tests.project('ord-b') else tests.project('ord-c') end);
  end loop;
end
$$;
select is((select count(distinct position) from public.project where edition_id = tests.edition('T-ORD', '2026')), 3::bigint,
  'sixty moves into one gap still leave every position distinct');

select lives_ok($$ select app.move_project(tests.project('ord-a'), tests.project('ord-b'), null) $$, 'moving to the end needs only the project before it');
select is((select slug from public.project where edition_id = tests.edition('T-ORD', '2026') order by position desc limit 1), 'ord-a', 'and it is last');
select throws_ok(
  $$ select app.move_project(tests.project('ord-a'), tests.project('ord-other'), null) $$,
  '23514', null, 'a neighbour from another edition is refused');

-- Assistants reorder too; students do not, and nobody writes the column
-- directly.
select tests.authenticate(tests.uid('ta@example.com'));
select lives_ok($$ select app.move_project(tests.project('ord-a'), null, tests.project('ord-b')) $$, 'an assistant reorders');
select throws_ok($$ select app.move_project(tests.project('ord-other'), null, null) $$, '42501', null, 'but not in an edition they are not staff of');
select tests.authenticate(tests.uid('student@example.com'));
select throws_ok($$ select app.move_project(tests.project('ord-a'), null, tests.project('ord-b')) $$, '42501', null, 'a student cannot reorder');
select tests.authenticate(tests.uid('teacher@example.com'));
select throws_ok($$ update public.project set position = 0 where slug = 'ord-a' $$, '42501', null, 'not even an owner writes a position except by moving');

-- A duplicate keeps the order.
select app.duplicate_edition(tests.edition('T-ORD', '2026'), '2028');
select results_eq(
  $$ select slug from public.project where edition_id = tests.edition('T-ORD', '2028') order by position $$,
  $$ select slug from public.project where edition_id = tests.edition('T-ORD', '2026') order by position $$,
  'a duplicated edition keeps the order of the one it came from');
-- The audit log is admins' to read; count it as the test's own superuser.
select tests.clear_auth();
select is((select count(*) from public.audit_log where action = 'move_project'), 63::bigint, 'every move that happened is in the audit log, and the refused one is not');

select * from finish();
rollback;
