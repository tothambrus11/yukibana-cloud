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
  `isFromRunner`, `isPage`, `isFromPage`, `isLoadingProgress`), never
  cast: a runner's messages come from the worker a user's program runs in.
* A message's shape changes only together with every side that sends or
  receives it; a field a receiver might not know is optional.
* It never names a pack. A pack's needs are data the pack ships
  (`requires.json`), and this module only reads and compares them.

| File | What |
|---|---|
| `connection.ts` | JSON-RPC 2.0 over a worker's `postMessage`, for a language server |
| `stdin.ts` | the standard input buffer: layout, `writeStdin`, `readStdin` (sticky end of file), `rearmStdin` |
| `runner.ts` | to and from a runner (batched `output`, reserved `test-report`, the headless contract), and a previewed page |
| `loading.ts` | download progress from any pack worker |
| `requirements.ts` | what a pack's workers need from the page (`Need`, `Requires`, `parseRequires`, `needFor`), and why a page that lacks it refuses them (`requirementProblem`, `requirementLimitation`, `PROTOCOL_MAJOR`) |
| `platform.d.ts` | the platform types every host has under one name, the only ones protocol's own check knows |

Its tests are in `../tests/` (outside the module, which may not import
`node:test`): `node --test "light/modules/**/*.test.mjs"`, or
`npm run test:unit` in `light/app`.

## Allowed imports

Only files of this module, by relative paths ending in `.ts`. Nothing from
`runtime`, `monaco`, the app, npm or Node, so the packs' glue and the runner
frame can bundle it with nothing else.
