# Deploying Yukibana Cloud

One Supabase project (Postgres and Auth), one Cloudflare Worker, one R2
bucket. Everything below fits the free tier of both, with one caveat: R2 asks
for a payment method before it will turn on, even though the 10 GB allowance
is genuinely free.

After the first setup, deploying is `git push` to `main`, and two things
answer it:

* **Cloudflare Workers Builds** is connected to this repository and builds
  and deploys the Worker;
* the **Database** workflow in GitHub Actions applies migrations, runs the
  per-environment bootstrap and pushes the Supabase settings.

They run side by side, so neither guarantees the other's order. What keeps
the site up is the rule that migrations only ever add: an old Worker against
a new schema is fine. The other direction is not, so when a change needs
both, push it twice: the migration first, the code that reads it after.

## 1. Supabase

From the project dashboard, collect four things.

| What | Where |
| --- | --- |
| Project ref | The first label of the API URL, `https://<ref>.supabase.co` |
| Publishable (anon) key | Settings → API |
| **Session pooler** connection string | Connect → Session pooler, port 5432 |
| **Direct** connection string | Connect → Direct connection, port 5432 |

Both connection strings, and which goes where, matter:

* the **session pooler** string is what GitHub Actions uses. A direct
  connection resolves to IPv6 only, and GitHub's runners have no IPv6, so
  every database step would fail to connect. The pooler is IPv4 on every plan;
* the **direct** string is what Hyperdrive uses. Hyperdrive is the pool, so
  pooling it twice is what you are avoiding.

Percent-encode the password inside the pooler string if it contains anything
outside `A-Za-z0-9._~-`. The Supabase CLI rejects a string that is not encoded.

Then create a **GitHub OAuth App** for login, at GitHub → Settings →
Developer settings → OAuth Apps → New. The callback URL is
`https://<ref>.supabase.co/auth/v1/callback`. Keep the client id and secret.
This is an OAuth App, not a GitHub App: the registry reads no repositories.

Nothing else is configured by hand. The deploy workflow pushes the auth
settings from `supabase/config.toml`, and the schema comes from the
migrations. The dashboard is read-only from here on; `drift.yml` fails
nightly if something is changed there.

## 2. Cloudflare

**Enable R2** (dashboard → R2). It asks for a payment method; the free tier
is 10 GB of storage, 10 million reads a month and no egress charges.

**Create the bucket**, named `yukibana-cloud`, the same name local development and CI use.

**Create an R2 API token** (R2 → Manage API tokens → Create), with Object
Read & Write on that bucket. It prints an Access Key ID and a Secret Access
Key: those are the S3 credentials the Worker uses. The same page shows the
S3 API endpoint, `https://<account id>.r2.cloudflarestorage.com`.

**Create the Hyperdrive config**, from a checkout:

```bash
npx wrangler hyperdrive create yukibana-cloud --connection-string="<DIRECT connection string>"
```

It prints an id. Hyperdrive is on the free plan, with 100,000 queries a day.

**Point Workers Builds at this repository**, if it is not already: the
Worker → Settings → Builds. Because the app is one package of several, set

Cloudflare's defaults are what this repository is arranged for, so leave the
root directory empty: `wrangler.jsonc` sits at the root, `npm run build`
there builds the app, and `npx wrangler deploy` deploys it. An earlier
layout kept the Worker's configuration under `app/`, and Cloudflare's build
failed with "could not detect a directory containing static files", which is
what wrangler says when it is run somewhere with no configuration to find.

Note the account id from the dashboard sidebar: it is the first label of the
R2 S3 endpoint, and one of the four values below.

## 3. Fill in the four placeholders

`node scripts/check-production-config.mjs` names them and where each lives;
the deploy workflow runs it first and refuses to deploy while any remain.

| Placeholder | Value |
| --- | --- |
| `REPLACE_ME_PROJECT_REF` | the Supabase project ref |
| `REPLACE_ME_HYPERDRIVE_ID` | the id `hyperdrive create` printed |
| `REPLACE_ME_WORKERS_SUBDOMAIN` | your workers.dev subdomain, so the app is at `https://yukibana-cloud.<subdomain>.workers.dev`, or the custom domain instead |

They are in `wrangler.jsonc` at the repository root (production values,
because that is what is deployed and what a diff should show) and `supabase/config.toml` (under
`[remotes.production]`, which is what `config push` applies to the project;
everything above that block stays local). Commit the result.

## 4. Worker secrets

Three, set once. The Worker already exists, so this works before the first
deploy. From the repository root, after `npx wrangler login`:

```bash
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put S3_ACCESS_KEY_ID
npx wrangler secret put S3_SECRET_ACCESS_KEY
```

They are not in the deploy workflow: a secret that is re-pushed on every
deploy is a secret that is in CI's environment on every deploy.

## 5. Repository secrets

GitHub → Settings → Secrets and variables → Actions.

| Secret | Value |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | a personal access token, from the Supabase dashboard |
| `SUPABASE_PROJECT_REF` | the project ref |
| `SUPABASE_DB_URL` | the **session pooler** connection string, percent-encoded |
| `SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID` | the OAuth App's client id |
| `SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET` | the OAuth App's secret |
| `APP_DB_PASSWORD` | a password you generate for the `yukibana_app` role |
| `FIRST_ADMIN_EMAIL` | the address your GitHub account reports as primary |

No Cloudflare credentials: Workers Builds deploys the Worker with its own
connection to this repository, and the Database workflow never touches it.

These go on the **Secrets** tab, as **repository** secrets. GitHub has four
stores that look alike in the interface and are not the same thing, and the
Database workflow can read exactly one of them:

| Where | Readable here |
| --- | --- |
| Actions, Secrets tab, repository secrets | yes |
| Actions, Secrets tab, on the environment named `default` | yes, the workflow declares it |
| Actions, Variables tab | no, a different store, and not masked in logs |
| Dependabot secrets | no, a different store |

The workflow names an environment called `default`, so either place works.
Put them on the Secrets tab in whichever you use: a variable is printed in
plain text in run logs, and `SUPABASE_DB_URL` carries the database password.

A secret that is set shows up as `***` in a run's environment listing; one
that is blank there does not exist as far as the job is concerned. Until the
production configuration in step 3 is filled in, the workflow stops with a
notice rather than failing, because nobody has pointed the repository at an
environment yet. Once it is filled in, a missing secret fails the run and
names itself.

`APP_DB_PASSWORD` is yours to invent: `ops/bootstrap.sql` sets it on the
connection role every deploy, so it never appears in a migration.

## 6. Deploy, log in, deploy again

Push to `main`, or run the Database workflow by hand. It will check the
placeholders are gone, list and apply pending migrations, run
`ops/bootstrap.sql`, and push the Supabase settings; Cloudflare builds and
deploys the Worker alongside it.

`ops/bootstrap.sql` sets the connection role's password and then tries to
promote the first admin. On a brand-new project it finds nobody to promote
and says so, because an account only exists once someone has logged in. So
**open the app, log in with GitHub, and run the workflow again**. The second
run promotes you, and every run after that is a no-op.

You are then an admin: `/admin` grants `teacher` to anyone who has logged in
once, and a teacher creates courses, editions and projects.

## Afterwards

The migrations in this repository have been applied to the production
project as of 2026-09-18, so the ledger there records them. From that point
a migration that has run is frozen: every change is a new file, including a
change to something only ever deployed once. CLAUDE.md says the same thing;
this is the date it started being true.


Everything else is in the app. A teacher creates a course, an edition,
enrols by address, and creates a project. Publishing a release is
`docs/yukibana-json.md`: `yukibana build` and an upload, or a token and the
GitHub Action in the course repository.

## When something goes wrong

**"failed to connect" in a database step.** `SUPABASE_DB_URL` is the direct
connection string rather than the session pooler one. See step 1.

**The deploy refuses with a list of placeholders.** Step 3, and commit.

**Login redirects to localhost.** `[remotes.production]` in
`supabase/config.toml` still has the placeholder subdomain, or the deploy has
not pushed the settings yet. The pushed values are printed by the "Supabase
settings, before" step of the last deploy.

**A submission is rejected but a small one works.** The Worker hashes each
upload, and the Workers free plan allows about 10 ms of CPU per request.
Source archives are kilobytes and fine; a student who tars up `target/` can
exceed it. The fix is to have the client send its own SHA-256 and let R2
verify it, not a paid plan.

**The Cloudflare build fails on the Hyperdrive id.** The placeholders in
step 3 are not filled in, or `hyperdrive create` has not been run. The build
failing is the intended outcome: a Worker deployed with a placeholder id
starts and then fails every request that touches the database.

**Nightly Drift failed.** Something changed the database outside a migration.
The job prints the difference; either revert it in the dashboard or write it
down as a migration.
