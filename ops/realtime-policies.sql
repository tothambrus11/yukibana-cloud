-- Who may listen on Supabase Realtime, checked against production nightly
-- by .github/workflows/drift.yml.
--
-- The drift job's diff covers the `public` and `app` schemas only: the
-- `realtime` schema is Supabase's, and it changes every day (one partition
-- of `realtime.messages` a day), so diffing it would never be quiet. But
-- one rule of ours lives there: the policy that decides who may join which
-- topic (20261008110000_live_signals.sql). Clients also hold Supabase's
-- default insert grant on the table, harmless only while no insert policy
-- exists. So this checks the one thing that matters there, exactly: row
-- level security is on, and the table's policies are ours and nothing else.
-- Raises, and so fails the job, otherwise.

do $$
declare
  found text;
  expected constant text :=
    'listen_to_signals SELECT {authenticated} '
    || '((extension = ''broadcast''::text) AND (topic = ( SELECT realtime.topic() AS topic)) '
    || 'AND app.may_listen(( SELECT realtime.topic() AS topic)))';
begin
  if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'realtime' and c.relname = 'messages') then
    raise exception 'row level security is off on realtime.messages';
  end if;
  select coalesce(string_agg(policyname || ' ' || cmd || ' ' || roles::text || ' ' || coalesce(qual, '') || coalesce(' check ' || with_check, ''),
                             E'\n' order by policyname), '(none)')
    into found
    from pg_policies where schemaname = 'realtime' and tablename = 'messages';
  if found is distinct from expected then
    raise exception E'realtime.messages policies differ from 20261008110000_live_signals.sql.\nexpected:\n%\nfound:\n%', expected, found;
  end if;
end
$$;
