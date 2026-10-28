-- Supabase's "automatically enable RLS on new tables" setting, written down.
--
-- Turning that setting on in the dashboard created, in production, the
-- function below and the event trigger `ensure_rls` that runs it after every
-- CREATE TABLE, CREATE TABLE AS and SELECT INTO: a new table in `public`
-- gets row level security switched on even if its migration forgot to. The
-- nightly drift job found the function (the trigger is in no schema, so its
-- diff could not see that; ops/event-triggers.sql checks it now), and
-- CLAUDE.md allows the database to change only through a migration, so here
-- it is, the same in production, in CI and on a laptop.
--
-- It changes nothing about how tables are written here: every migration
-- still enables row level security on its own tables, explicitly, and gives
-- them their policies. This is the net under that rule, not a replacement
-- for it: a table it catches has RLS on and no policy, so it refuses every
-- row to `authenticated`, which fails closed.
--
-- The function is Supabase's text exactly as pg_get_functiondef printed it
-- from production (ops/event-triggers.sql compares a hash of it), so
-- `create or replace` changes nothing there. Its errors are caught and only
-- logged: a table it cannot alter must not make the DDL that created it
-- fail. The trigger already exists in production, so it is created only
-- where it does not. Nobody calls an event trigger function directly, so no
-- role needs to execute it; production had the default grant to PUBLIC.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;

do $$
begin
  if not exists (select from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
  end if;
end
$$;
