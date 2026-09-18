-- The roles the Worker connects as.
--
-- `yukibana_app` owns nothing, inherits nothing and can bypass nothing. All it
-- can do is become `anon`, `authenticated` or `yukibana_publisher` for the
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
  if not exists (select 1 from pg_roles where rolname = 'yukibana_publisher') then
    create role yukibana_publisher nologin nobypassrls noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'yukibana_app') then
    create role yukibana_app login nobypassrls noinherit;
  end if;
end
$$;

grant anon, authenticated, yukibana_publisher to yukibana_app;

-- The publisher: what a request carrying a project token may do, which is
-- exactly two functions. No table grants at all: it cannot read a project,
-- a person or a submission, only turn a valid token hash into a release.
grant usage on schema app to yukibana_publisher;
grant execute on function app.project_for_token(bytea) to yukibana_publisher;
grant execute on function app.publish_release_with_token(bytea, text, text, text, bigint, bytea, text, bigint, bytea)
  to yukibana_publisher;

-- `anon` can reach nothing: every route that touches the database requires a
-- session or a token, and the grant list above never names it.
