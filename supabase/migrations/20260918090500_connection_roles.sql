-- The roles the Worker connects as.
--
-- `yukibana_app` owns nothing, inherits nothing and can bypass nothing. All it
-- can do is become `anon`, `authenticated` or `yukibana_builder` for the
-- length of a transaction, which is what app/src/lib/server/db.ts does for
-- every request. A query that forgets to set a role fails with "permission
-- denied" instead of answering as `postgres`; that is the whole point of the
-- role.
--
-- Passwords are not here: migrations are committed, and a password is not.
-- `ops/bootstrap.sql` sets them from secrets at deploy time, and the local
-- seed sets a throwaway one.

-- Supabase runs each migration in one transaction; these bound how long it
-- may wait for a lock or run, so a deploy that would block the site fails
-- instead, and is retried when the table is quiet.
set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'yukibana_builder') then
    create role yukibana_builder nologin nobypassrls noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'yukibana_app') then
    create role yukibana_app login nobypassrls noinherit;
  end if;
end
$$;

grant anon, authenticated, yukibana_builder to yukibana_app;

-- The builder: reads what it needs to fetch a repository, writes build rows,
-- and remembers deliveries. Nothing about people, nothing about submissions.
grant usage on schema public, app to yukibana_builder;
grant select on public.project, public.github_installation to yukibana_builder;
grant update (github_repo_full_name) on public.project to yukibana_builder;
grant select, insert, update on public.project_build to yukibana_builder;
grant select, insert on public.github_delivery to yukibana_builder;
grant update (removed_at) on public.github_installation to yukibana_builder;

-- Its policies: everything it has a grant for, since it only ever runs the
-- code in app/src/lib/server/build.ts, never a person's request.
create policy builder_project        on public.project             for select to yukibana_builder using (true);
create policy builder_project_update on public.project             for update to yukibana_builder using (true) with check (true);
create policy builder_installation   on public.github_installation for all    to yukibana_builder using (true) with check (true);
create policy builder_build          on public.project_build       for all    to yukibana_builder using (true) with check (true);
create policy builder_delivery       on public.github_delivery     for all    to yukibana_builder using (true) with check (true);

-- `anon` can reach nothing: every route that touches the database requires a
-- session, and the grant list above never names it. Usage on the schemas is
-- kept so a forgotten grant shows as "permission denied for table", which
-- names the table, rather than "for schema", which does not.
