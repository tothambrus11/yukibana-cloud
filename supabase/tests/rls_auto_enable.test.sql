-- The net under "every table enables row level security": a table created
-- in public by a migration that forgot to is locked anyway, and refuses
-- every row to a signed-in user, because it has no policy. Tables outside
-- public are not touched, and nobody but the owner may run the function.
begin;
select plan(7);

select ok(exists (select from pg_event_trigger where evtname = 'ensure_rls' and evtenabled = 'O'),
  'the ensure_rls event trigger exists and is enabled');

create table public.forgot_rls (id int);
insert into public.forgot_rls values (1);
select ok((select relrowsecurity from pg_class where oid = 'public.forgot_rls'::regclass),
  'a table created in public without enable row level security has it on anyway');

create table public.forgot_rls_as as select 1 as id;
select ok((select relrowsecurity from pg_class where oid = 'public.forgot_rls_as'::regclass),
  'so does a table made with create table as');

create schema rls_elsewhere;
create table rls_elsewhere.untouched (id int);
select ok(not (select relrowsecurity from pg_class where oid = 'rls_elsewhere.untouched'::regclass),
  'a table outside public is left as its migration made it');

grant select on public.forgot_rls to authenticated;
select tests.create_user('forgetful@example.com', 'Forgetful', 'forgetful');
select tests.authenticate(tests.uid('forgetful@example.com'));
select is((select count(*) from public.forgot_rls), 0::bigint,
  'a signed-in user granted select on that table still reads no row of it: no policy, no rows');
select tests.clear_auth();

select ok(not has_function_privilege('anon', 'public.rls_auto_enable()', 'execute'),
  'anon may not execute the function');
select ok(not has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute'),
  'authenticated may not execute the function');

select * from finish();
rollback;
