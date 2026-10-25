# @yukibana/runtime

Starting a pack's workers and keeping a session with them in a browser: where
a pack's files are, how its workers are created, the language server, run
and preview sessions and their states, and where a runner lives (an in-page
worker, or a frame on a separate packs origin for a host that holds
credentials).

## Contract

* Uses the platform's `Worker`, `fetch`, `URL` and, for the framed
  transport, an iframe. It has no editor, no UI framework and no storage of
  its own: what a host wants kept, it keeps.
* Importing it starts nothing and fetches nothing. A session downloads only
  when first used, and refuses a need its host cannot meet before any
  download, with a named reason.
* Workers come from the host (a `WorkerFactory`) or, for runners on a host
  with credentials, from the framed transport; a pack's workers are started
  from the pack's own URL and are never re-bundled.
* It never parses `yukibana.json`: a project's configuration is the app's,
  and arrives here as values.
* Nothing names a place as a constant. A workspace's root
  (`workspaceRoot`, paths.ts) and where a host's packs are (`PackLocator`,
  packs.ts) are values the host passes in: Light's app has one workspace at
  `file:///workspace/` and its packs unpinned beside the page; a docs page
  gives each snippet its own root and pins Light's packs to one build per
  page, read from `index.json` on first use.
* A session starts from a `SessionSource`: a served pack (its pack.json and
  the locator it came from) or a worker the host bundled itself, with its
  needs inline. Both are checked (`sourceProblem`) before anything starts.
* Where a runner lives is a `RunnerTransport`, never assumed: the in-page
  `workerTransport` for a host that holds no credentials, a frame on
  another site for one that does (still to come). Standard input and
  batching are the transport's, since a frame boundary lies between them
  and the session.
* A page's runners are shared through one `RunnerPool`: one runner per
  source (`maxConcurrent`, default 1), a `RunHandle` per run that gets
  only that run's events, re-runs that stop the previous run with
  `cancel` and keep the runner, other snippets `queued` with the run they
  wait for named. Warm runners only when the host asks (`warm`).

## Files

* `paths.ts`: project paths (`pathProblem`, `parentOf`, `baseName`) and a
  workspace root that turns a path into a URI and back.
* `packs.ts`: `PackId`, `PackLocator` (`unpinned`, `pinned`, with
  `file`, `packInfo` and `stillCurrent`), pack.json and index.json readers,
  `WorkerFactory` (`moduleWorkerFactory`, `blobTrampolineFactory`,
  `factoryFor`), `SessionSource`, `sourceProblem`, `sourceLimitation`
  and `startWorker`.
* `transport.ts`: `RunnerTransport`, `RunnerHandle` and `workerTransport`.
* `run-session.ts`: `RunSession` (one runner of one source and its run),
  `RunState`, `RunEvent`, `RunFailure`, and the silence and cancel
  timeouts.
* `run-pool.ts`: `RunnerPool` and `RunHandle`.

## Allowed imports

Files of this module and of `@yukibana/protocol`, by relative paths ending
in `.ts` or by the package name. Never `monaco`, Svelte, dockview, `$app`,
`localStorage`, `document.documentElement` or a service-worker registration.
