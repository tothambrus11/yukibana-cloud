-- Which event triggers run our functions, checked against production nightly
-- by .github/workflows/drift.yml and against the rebuilt database by CI.
--
-- An event trigger belongs to no schema, so the drift job's diff of `public`
-- and `app` cannot see one: it saw the function public.rls_auto_enable that
-- Supabase's "automatically enable RLS on new tables" setting created, but
-- not the trigger that runs it. This lists every event trigger whose
-- function is in `public` or `app` (Supabase's own, on functions in its
-- schemas, are left out), with what decides its behaviour: its event, tags,
-- state and owner, and its function's signature, owner, grants and a hash of
-- its whole definition (pg_get_functiondef: body, language, security, search
-- path). Raises, and so fails the job, unless that is exactly what the
-- migrations create (20261025000000_rls_auto_enable.sql), and prints what
-- it found in full so the difference can be read off the log.

do $$
declare
  found text;
  definitions text;
  expected constant text :=
    'ensure_rls on ddl_command_end {"CREATE TABLE","CREATE TABLE AS","SELECT INTO"} enabled=O owner=postgres'
    || ' -> rls_auto_enable() owner=postgres acl={postgres=X/postgres} def=6998ea6b4c2480f5d2e34b5dcf3f8d36';
begin
  select coalesce(string_agg(format('%s on %s %s enabled=%s owner=%s -> %s owner=%s acl=%s def=%s',
                                    e.evtname, e.evtevent, coalesce(e.evttags::text, '{}'), e.evtenabled,
                                    e.evtowner::regrole, p.oid::regprocedure, p.proowner::regrole,
                                    coalesce(p.proacl::text, '(default)'), md5(pg_get_functiondef(p.oid))),
                             E'\n' order by e.evtname), '(none)'),
         coalesce(string_agg(pg_get_functiondef(p.oid), E'\n' order by e.evtname), '')
    into found, definitions
    from pg_event_trigger e
    join pg_proc p on p.oid = e.evtfoid
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app');
  if found is distinct from expected then
    raise exception E'event triggers on our functions differ from the migrations.\nexpected:\n%\nfound:\n%\ndefinitions:\n%',
      expected, found, definitions;
  end if;
end
$$;
