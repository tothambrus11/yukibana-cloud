# @yukibana/protocol

What crosses a boundary in Yukibana Light, as TypeScript types and pure
functions: the messages between the editor and a language server, between a
page and a runner, between a host and the runner frame, and what a pack
declares it needs from its host.

## Contract

* Types and pure codecs only: a function here is a function of its
  arguments, with no I/O, timers, globals or DOM. It runs the same in a
  page, a worker, the runner frame and Node, and `tsconfig.json` holds it
  to that: it checks protocol with the language alone and
  `platform.d.ts`, so a use of `document`, `window`, `fetch`, `process`
  or `Buffer` fails `npm run check`. The two that touch the world
  touch only what they are handed: `Connection` posts to the worker its
  caller gives it (it never creates one), and the stdin functions read
  and write the buffer they are given.
* What is received is read through a guard (`readFromRunner`,
  `isFromRunner`, `isPage`, `isFromPage`, `isLoadingProgress`, `isPartStatus`), never
  cast: a runner's messages come from the worker a user's program runs in.
* A message's shape changes only together with every side that sends or
  receives it; a field a receiver might not know is optional.
* It never names a pack. A pack's needs are data the pack ships
  (`requires.json`), and this module only reads and compares them.

| File | What |
|---|---|
| `connection.ts` | JSON-RPC 2.0 over a worker's `postMessage`, for a language server |
| `stdin.ts` | the standard input buffer: layout, `writeStdin`, `readStdin` (end of file answers one read, as at a terminal) |
| `runner.ts` | to and from a runner (the optional `cancel`, reserved `test-report`, the headless contract, options a pack defines and the protocol never reads), and a previewed page |
| `loading.ts` | download progress from any pack worker |
| `status.ts` | a language server's optional parts (`yukibana/status`, `isPartStatus`) and the app's settings for them (`yukibana/configure`) |
| `lsp.ts` | the Language Server Protocol's values (positions, diagnostics, edits, completions, symbols, …) that the editor integration converts, as types only, under the specification's names, so no module depends on `vscode-languageserver-protocol` |
| `requirements.ts` | what a pack's workers need from the page (`Need`, `Requires`, `parseRequires`, `needFor`), and why a page that lacks it refuses them (`protocolProblem`, `requirementProblem`, `requirementLimitation`, `PROTOCOL_MAJOR`); a session asks `protocolProblem`, then `parseRequires`, `needFor` and `requirementProblem`, so a newer pack is refused for its protocol before its needs are read |
| `platform.d.ts` | the platform types every host has under one name, the only ones protocol's own check knows |

Its tests are in `../tests/` (outside the module, which may not import
`node:test`): `node --test "light/modules/**/*.test.mjs"`, or
`npm run test:unit` in `light/app`.

## Allowed imports

Only files of this module, by relative paths ending in `.ts`. Nothing from
`runtime`, `monaco`, the app, npm or Node, so the packs' glue and the runner
frame can bundle it with nothing else.
