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

## Files

* `paths.ts`: project paths (`pathProblem`, `parentOf`, `baseName`) and a
  workspace root that turns a path into a URI and back.
* `packs.ts`: `PackId`, `PackLocator` (`unpinned`, `pinned`, with
  `file`, `packInfo` and `stillCurrent`), pack.json and index.json readers,
  `WorkerFactory` (`moduleWorkerFactory`, `blobTrampolineFactory`,
  `factoryFor`), `SessionSource`, `sourceProblem` and `startWorker`.

## Allowed imports

Files of this module and of `@yukibana/protocol`, by relative paths ending
in `.ts` or by the package name. Never `monaco`, Svelte, dockview, `$app`,
`localStorage`, `document.documentElement` or a service-worker registration.
