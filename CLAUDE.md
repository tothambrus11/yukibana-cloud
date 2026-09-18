# Working on Yukibana Cloud

Courses hold editions, editions hold projects, students submit to projects.
The cloud is a registry: it holds identities, enrolment, released archives
and submissions, and transforms nothing. The database decides who may do
what; the Worker asks it, as the person asking; the pages show what came
back. The CLI (`cli/`) is where a course repository becomes the two archives
a release is made of, on a teacher's machine or in their CI. `README.md`
says how to run it and `docs/design.md` says why the model is what it is.
This file is how the code is written.

## The one rule about the database

**The database changes only through a file in `supabase/migrations/`.** Not
the dashboard, not the SQL editor, not `psql` against production, not a
generated diff. A function, a policy, a grant, an index, a role: each is a
migration, written by hand, reviewed like code, applied by the deploy
workflow with `supabase db push`, and never edited after it has been pushed.

Consequences, so nobody has to rediscover them:

* There are no declarative schema files and `supabase db diff` never
  generates a migration here. The only use of the diff engine is
  `.github/workflows/drift.yml`, which fails nightly if production differs
  from the migrations. Anything it prints is either reverted or written down.
* A migration is a plain SQL file whose comments say why, not what. It runs
  inside one transaction, starts by bounding `lock_timeout` and
  `statement_timeout`, and is linted by squawk (`npm run db:lint`) before it
  runs anywhere.
* Migrations only ever add. To change a function, `create or replace` it. To
  change a policy, drop it and create it (pg-delta cannot follow `alter
  policy`, and neither can a reviewer). To remove a column, first stop reading
  it, deploy, then drop it in a later migration.
* Passwords and per-environment values are not migrations: `ops/bootstrap.sql`
  sets them at deploy time from secrets. Seeds (`supabase/seeds/`) run only on
  `supabase db reset`, so they exist locally and in CI and nowhere else.
* The first admin is `app.bootstrap_admin`, run by an operator, once. There is
  no way to become admin through the app.

## Authorisation lives in Postgres

Every table has row level security and no grant it does not need. Every rule
about who may see or do something is a policy or a `security definer`
function in a migration, and nowhere else: the Worker never re-decides it.

* **The Worker connects as `yukibana_app`**, a role that owns nothing,
  inherits nothing and cannot bypass RLS. Every query runs inside
  `asUser(sql, claims, …)` or `asPublisher(sql, …)` in `app/src/lib/server/db.ts`,
  which become `authenticated` (with the verified JWT's claims) or
  `yukibana_publisher` for the length of one transaction. A query outside
  them fails with "permission denied". That is the point.
* **`security definer` functions are the writes.** `app.enrol`,
  `app.create_edition`, `app.set_platform_role` and the rest check the caller
  themselves, write, and leave an `audit_log` row in the same transaction.
  Tables those functions write have no insert grant for `authenticated`.
* **Claims come from the JWT and nowhere else.** `claims.ts` says what reaches
  `request.jwt.claims`; hooks verify the token against the Auth server's
  keys before anything reads it.
* **A policy that reads its own table through a helper.** `app.role_in`,
  `app.shares_edition` and `app.current_starter` are `security definer` so a
  policy on `enrollment` does not recurse into itself, and so a student's
  policy on `app_user` sees who shares their edition rather than only
  themselves.
* **`set search_path = ''` on every function, and therefore no citext.**
  With an empty search path the extension's `=` is not visible and citext
  compares as case-sensitive text without a word of warning. Addresses and
  logins are lowercased on write and compared lowercased.
* **A project token is a hash and two functions.** The secret is shown once
  and never stored; the Worker hashes what it receives. `yukibana_publisher`
  can call `app.project_for_token` and `app.publish_release_with_token` and
  has no table grant at all: a request with a token can publish to the one
  project the token names and read nothing. A table grant for that role is
  a bug.

Every policy has a pgTAP test in `supabase/tests/`, and the tests are written
as negatives: the student who cannot read a classmate's submission, the
assistant who cannot enrol, the owner who cannot move a project to another
edition. Negative tests are the only ones that catch a policy accidentally
widened. `npm run db:test` runs them against the local stack; CI runs them on
every push, after rebuilding the database from empty.

## Everything is TypeScript, and the types say what the code means

`app/` is SvelteKit on the oxc/rolldown toolchain (rolldown-vite, oxlint
type-aware, Vitest, svelte-check, TypeScript 6 `strict` with
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`), deployed as one
Cloudflare Worker with `adapter-cloudflare`.

* **Ids carry their table.** `ProjectId`, `EditionId`, `SubmissionId` and the
  rest in `ids.ts` are branded strings. A string becomes one in two places:
  `uuidOf` at a boundary, which checks the shape, and `trustId` for a value
  the database returned. A `ProjectId` where an `EditionId` was expected is a
  compile error, not an empty page.
* **Untyped input is trusted in one place, named so it can be grepped.**
  `configOf` reads `platform.env`; `text(form, name)` reads a form; the
  CLI's `parseConfig` reads `yukibana.json`. Each checks and names what is
  wrong. `any` does not appear; `unknown` at a boundary, narrowed at
  once, does.
* **What decides something is pure and in a `lib`.** In the CLI, the tar
  reader, the glob matcher and the release plans are functions of bytes and
  strings, tested as tables; the commands do the I/O. In the app,
  `src/lib/server` does I/O around the database and the bucket, and
  `src/routes` shows what came back and holds no rules.
* **The bucket is an interface.** `Bucket` in `storage.ts` has one
  implementation, S3, which is R2 in production and RustFS locally. The
  database holds keys, never URLs.
* **Nothing fails silently.** `report(where, what)` from the module that
  found out; a release or submission whose row is refused deletes its
  objects and says so; the CLI exits non-zero with every problem named.

## Contract documentation

Every exported function, type and field says what it promises, in a `/** */`
block, in prose: what a caller may rely on, what it must not, which unit,
what null means, why the awkward thing is the way it is. Migrations do the
same in `--` comments. Where a decision was a mistake once, the comment says
so; the bugs are the documentation people read.

## Everything is tested, and tested for real

* `app/tests/` and `cli/tests/` are the unit suites, no services.
* `app/tests/integration/` drives the real server modules against the local
  stack: Postgres through `yukibana_app`, the bucket over S3, releases by
  token and by owner, submissions. It runs with `npm run test:integration`
  and in CI.
* `supabase/tests/` is pgTAP. `supabase/seeds/10_test_helpers.sql` gives it
  `tests.create_user`, `tests.authenticate` and lookups that see through RLS.
* The fixture repository `cli/tests/fixtures/repo.tar.gz` is a real pax
  tarball with a wrapper directory, a global header, a long path and a hidden
  test, because that is what `git archive` and GitHub produce. CI also
  unpacks it and runs `yukibana check` over it.
* A test's name is a sentence about the product, not about the function.

## Before you push

`npm run check` at the root: lint, typecheck, unit tests. With the stack
running: `npm run db:lint`, `npm run db:reset`, `npm run db:test`,
`npm run test:integration`. CI runs all of it, plus the devcontainer build,
and `main` deploys only after CI is green: migrations, bootstrap, settings,
Worker, in that order.
