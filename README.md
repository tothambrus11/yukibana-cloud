# Yukibana Cloud

Course projects and the work students submit for them, for a computer science
programme. A teacher connects a GitHub repository; every push builds a starter
archive with the hidden tests removed; students download it after the
project's date and submit their solution as a `.tar.zst`; staff read the
submissions. `docs/design.md` says why it is shaped the way it is,
`docs/yukibana-json.md` is the contract a course repository follows, and
`CLAUDE.md` is how the code is written.

| | |
| --- | --- |
| Postgres and Auth | Supabase. The schema is `supabase/migrations/`, applied by the deploy workflow and by nothing else. |
| The app | SvelteKit in `app/`, one Cloudflare Worker, Postgres through Hyperdrive as a role that can bypass no policy. |
| Files | Cloudflare R2 over S3 in production, RustFS over S3 locally. The database holds keys. |
| Login | GitHub, through Supabase Auth. |

## Start

Open the folder in VS Code and "Reopen in Container", or headless:

```bash
npx @devcontainers/cli up --workspace-folder .
npx @devcontainers/cli exec --workspace-folder . npm run smoke
```

The devcontainer runs the Supabase stack and the bucket as sibling containers
on the host's Docker daemon (docker-outside-of-docker). First start pulls a
few gigabytes of images; after that it is seconds. Without a devcontainer, on
a machine with Docker and Node 22:

```bash
cp .env.example .env            # GitHub OAuth App for local login (optional to start)
npm run install:all
npx supabase start && npm run storage:start
npm run dev:vars                # app/.dev.vars from what the stack reports
npm run dev                     # http://127.0.0.1:5173
```

Log in with GitHub, then make yourself the admin of the local database:

```bash
npm run local:admin -- you@example.com
```

## Daily use

| | |
| --- | --- |
| `npm run dev` | the app, against the local stack |
| `npm run check` | lint, typecheck, unit tests: the fast half of CI |
| `npm run smoke` | is the stack reachable from here? |
| `npm run db:reset` | rebuild the local database from every migration, then the seeds |
| `npm run db:test` | the pgTAP suite |
| `npm run db:lint` | squawk over the migrations |
| `npm run test:integration` | the server modules against the real stack |
| `npx supabase migration new <name>` | a new, empty migration to write by hand |
| `npx supabase stop` | stop the stack (keeps your data; `--no-backup` does not) |

## URLs

Same stack, two addresses: a devcontainer and the Supabase containers are
siblings, so they do not share a "localhost". `npx supabase status` prints
whichever is right for where you run it, and `.dev.vars` is written the same
way.

| | From the host browser | From inside the devcontainer |
| --- | --- | --- |
| API / Auth | http://localhost:54321 | http://host.docker.internal:54321 |
| Studio | http://localhost:54323 | — |
| Postgres | `localhost:54322` | `host.docker.internal:54322` |
| Bucket (S3) | http://localhost:9000 | http://host.docker.internal:9000 |
| The app | http://localhost:5173 | http://127.0.0.1:5173 |

## GitHub

Two GitHub objects, per environment:

* **An OAuth App** for login (Settings → Developer settings → OAuth Apps).
  Callback URL: `<API URL>/auth/v1/callback`. Its id and secret go in `.env`
  locally and in the deploy secrets in production.
* **A GitHub App** for reading course repositories (Settings → Developer
  settings → GitHub Apps). Permissions: Contents read, Metadata read.
  Subscribe to the `push` event. Webhook URL: `<app URL>/api/github/webhook`
  with a secret. Setup URL: `<app URL>/github/setup`, "redirect on update"
  on. Its id, slug, private key and webhook secret are the Worker's
  `GITHUB_*` values (`app/.dev.vars.example`). Locally, a tunnel to port 5173
  gives the webhook somewhere to go; without one, "Rebuild now" on a project
  page builds on demand.

A teacher connects a repository from the project page: GitHub asks them to
install the App on it, sends them back, and they pick it. The repository must
carry a `yukibana.json` (`docs/yukibana-json.md`).

## Deploying

`main` deploys after CI passes (`.github/workflows/deploy.yml`): migrations,
then `ops/bootstrap.sql` (role passwords and the first admin, from secrets),
then `supabase config push`, then the Worker. The secrets it needs are listed
at the top of that file. A nightly job (`drift.yml`) fails if production
differs from the migrations, which is how "the dashboard is read-only" is
enforced rather than hoped for.

One-time Cloudflare setup: `wrangler hyperdrive create yukibana
--connection-string=<the Supabase direct connection string>` and its id into
`app/wrangler.jsonc`; an R2 bucket and an API token with read/write on it;
`wrangler secret put` for each Worker secret named in `app/.dev.vars.example`.

## Other environments

```bash
./scripts/preflight.sh
```

probes the real Docker daemon and says whether this setup can work there. The
decisive check is whether the workspace path is valid on the daemon's host,
which is why `devcontainer.json` mounts the workspace at its host path, and
why this breaks inside a GitHub Actions `container:` job. CI runs the stack
directly on a VM runner (`ci.yml`) and, separately, builds the devcontainer
so a broken one fails a PR (`ci-devcontainer.yml`).
