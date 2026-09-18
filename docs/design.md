# Yukibana Cloud: design

2026-09-18. The decisions behind the schema and the service, and what was
deliberately left out of the first version.

## Scope

Courses, their editions, the projects in an edition, and the submissions to
a project. Staff enrol students by address, connect a GitHub repository to a
project, and read what students submit. Students see the editions they are
in, download a project's starter after its date, and submit versions of
their solution.

Out of the first version, each because it adds a surface the roster and
grading integrations would later have to fight:

* invitation emails, tokens, accept/decline: enrolment is silent, the
  edition is simply there at first login;
* self-service joining;
* grading, feedback, plagiarism checks, team submissions, a late window;
* running anything a student submitted.

## Constraints

1. **Enrolment is independent of the account.** Staff enrol by email address,
   before or after that person has ever logged in. Both orders work: an
   address that already belongs to an account links on the spot; an unknown
   address links at that person's first confirmed login.
2. **Authorisation lives in Postgres.** Policies and `security definer`
   functions decide everything. The Worker runs every query as the caller,
   so the policies are the application's rules, not a second copy of them.
3. **No bulk address exposure.** A student never reads another person's
   address; staff read the roster of their own editions only.
4. **A roster feed is the forcing function.** Every table is judged by how
   cleanly a school's SIS could later drive it. `enrollment.source` says
   which rows a sync owns.
5. **Submissions are append-only.** No update or delete path exists.
6. **The schema changes only through migrations.** See CLAUDE.md.

## The model

**Course → edition → project → submission.** A course is a name that groups
editions; nearly everything hangs off an edition. A new edition is a copy of
the previous one (`app.duplicate_edition`): projects and staff come along,
students and dates do not. A project belongs to one edition; reusing an
assignment next year is duplicating the edition, not sharing the project,
because a shared project would need its own access control and would show
every teacher every other teacher's hidden-test configuration.

**Two role dimensions.** `app_user.role` is the platform role (`user`,
`teacher`, `admin`): a teacher creates courses and editions, an admin makes
teachers. `enrollment.role` is the role in one edition (`student`,
`assistant`, `owner`). An admin is not implicitly staff of anything: to see
an edition they enrol in it, and it shows in the roster. The first admin is
`app.bootstrap_admin`, run by an operator.

**One `enrollment` table, not invitation plus membership.** A row with
`user_id` null is an address staff enrolled that has not logged in yet. The
trigger on `auth.users` fills it in when the address is confirmed. Roster
feeds produce exactly (edition, address, role), so one table upserts against
them. Removing someone is a delete whether or not they ever logged in.

**Identity is GitHub's, via Supabase Auth.** The address GitHub reports as
primary and verified is what enrolment matches on. There is no password path
and no magic link. An institutional OIDC provider later changes the login
screen and nothing else, because `auth.users.id` is the identity either way.
Until then, students are told which address to make primary on GitHub, and
the roster shows who has and has not linked.

**No `user_contact` table.** Earlier drafts split addresses out of the
profile to keep bulk reads from harvesting them. Supabase already holds the
verified address in `auth.users`, which no API role can read, and staff see
the addresses they enrolled in `enrollment`. The split protected nothing.

**Draft until dated.** `project.available_after` null means students cannot
see the project. Only a set date publishes it. `deadline` null means none;
past it, submissions are refused. A late window is a future column, not a
reinterpretation.

**Submissions.** The body goes through the Worker as one request, not a
presigned upload: the server computes the size and SHA-256 itself, stores
the object, then inserts the row inside the student's policies. A refused
row deletes the object. Every version is a row; `submitted_at` is
trigger-forced, as is `author_id`.

**Ids are UUIDv7**, from `app.uuidv7()` in the first migration. Sequential
integers leak volume and order even through RLS; random uuids scatter an
index. Postgres 18 has this built in and Supabase runs 17, so it is written
down rather than waited for.

**Addresses and logins are lowercased text, not citext.** Every function
here runs with `set search_path = ''`, and there citext's `=` is invisible:
Postgres falls back to text equality without a word, and a role change for
`Early@Example.com` found no row. Lowercase on write, compare lowercase.

## The GitHub side

A GitHub App, installed by the teacher on the repositories they choose. The
Worker mints a JWT with the App's key, trades it for an installation token,
and reads the repository with that. No personal token is stored.

Every push to the project's branch is a delivery to the webhook, checked by
signature over the raw bytes and deduplicated by delivery id. The build runs
after the response (Workers' `waitUntil`) and never throws: it ends as a
`project_build` row that says `succeeded` with two objects, or `failed` with
a reason a teacher can act on. Students never read that table (its log may
name the hidden paths); `app.current_starter` hands them the key and nothing
else.

Two objects per build: the **snapshot** (the repository as fetched, hidden
tests included, for grading later, and reproducible even if the repository
is force-pushed or the App uninstalled) and the **starter** (unwrapped into
a folder named after the slug, minus history, CI, build output and whatever
`yukibana.json` hides, plus a copy of that file without the hidden list and
with the project id).

The transformation is a pure function of the archive (`app/src/lib/starter.ts`),
tested against a fixture that is a real pax tarball. For now it is path
filtering; the rule that hidden tests must be auto-discovered exists because
deleting a file a manifest names leaves a starter that does not build, and
rewriting `Cargo.toml` or `build.sbt` is the per-kind step the code will grow
when a course needs it.

## Where the bytes live

The one storage adapter speaks S3: R2 in production (zero egress, a free
allowance that a course does not exceed), RustFS locally and in CI. The
database holds object keys, never URLs, so changing provider is three
variables and an `rclone` copy. Downloads are presigned URLs good for a
minute, minted only after the caller's policies returned the row: a URL is
a bearer token and outlives the permission that made it, which is why it is
short.

## The local stack and CI

Adopted from `tothambrus11/supabase-experiment`: the Supabase CLI as a
pinned dev dependency, a devcontainer that drives the host's Docker daemon
with the workspace mounted at its host path (so the CLI's bind mounts
resolve), `host.docker.internal` for the services, a preflight script that
probes whether a machine can run this, a smoke test, and two workflows: the
stack on a VM runner, and the devcontainer built so a broken one fails a PR.
Added: the bucket as a compose file beside it, the pgTAP suite, the
integration suite, squawk over migrations, the deploy and drift workflows.

## Open questions

* **Which address will students' GitHub accounts report?** If many use a
  personal primary address, enrolment by GitHub login is the next matching
  key (`app_user.github_login` already exists); it would be a second nullable
  column on `enrollment`, not a redesign.
* **Retention.** Addresses and submission bodies are personal data. Cascading
  deletes from `auth.users` would erase graded work; the schema restricts
  instead, and bucket lifecycle rules must agree with whatever the database
  does. Decide with the institution.
* **Late submissions.** Refused today. A `late_until` column and a flag on
  the row is the likely shape.
* **Validating starters.** The obvious next check is that a starter builds:
  `cargo check` after the hidden tests are gone. That needs a sandbox with a
  toolchain, which a Worker is not: GitHub Actions in this repository via
  `repository_dispatch`, or a container service. Same sandbox as autograding.
