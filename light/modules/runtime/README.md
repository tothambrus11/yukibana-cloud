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

## Allowed imports

Files of this module and of `@yukibana/protocol`, by relative paths ending
in `.ts` or by the package name. Never `monaco`, Svelte, dockview, `$app`,
`localStorage`, `document.documentElement` or a service-worker registration.
