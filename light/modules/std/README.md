# @yukibana/std

The tokens any language of Yukibana Light may provide, and the helpers that
make a language's providers of them from its pack. Step 2 of
`../DESIGN.md`: run, test and mutate; step 4: debug, debug tests and
preview. Explore and export follow in later steps.

## Contract

* **No language.** It names no language id: a language package (for now,
  the app's `src/lib/providers`) says which tokens its language has and
  when they are available; `../boundaries.test.mjs` refuses a language id
  in its string literals.
* **Today's messages.** A provider made by `runProvider` sends its pack's
  runner the very message the app sent before (`runMessage`: `type`,
  `files`, `entry`, and `options` only when there are some), through the
  host's one `RunnerPool`, and returns the pool's `RunHandle`: the terminal
  sees the same events, early ones included.
* **The host lends the pool.** A provider makes no pool and no worker: its
  host (`RunHost`) has the page's pool, the pack locator and what the
  host's runners need, so every instance on a page shares runners.
* **The runner kept warm is the runner runs use.** `warm`'s provider
  (`warmProvider`) gives the source the language's run providers start
  from, and requires `run`; when to warm it is the host's choice.
* **A debugged run is a run.** A provider made by `debugProvider` sends
  the run message of its mode with the debugger's channel as `debug`, and
  nothing else changes; its session's `program` resolves with the
  runner's `debug` event, or null when the run ends without one.
* **A preview provider owns its worker.** `preview`'s session builds the
  page in a runner worker of its own, kept for as long as the session; the
  host shows the page and decides when to rebuild it.
* **No side effects.** Importing it defines seven tokens and does nothing
  else (`../tests/imports.test.mjs`).

| File | What |
|---|---|
| `language.ts` | `PackLanguage`: a `LanguageMeta` with the pack it runs on and the packs that one uses (checked pack ids), and its server's settings in its body |
| `debug.ts` | `debug`, `debugTest` (`Token<DebugInput, DebugSession>`), `debugTokenOf`, `debugMessage`, `debugProvider` |
| `preview.ts` | `preview` (`Token<PreviewInput, PreviewSession>`), `BuiltPage` |
| `run.ts` | `run`, `test`, `mutate` (`Token<RunInput, RunHandle>`), `tokenOf`, `RunInput`, `RunHost`, `sourceOf`, `runMessage`, `runProvider`; `warm` (`Token<null, SessionSource>`), `warmProvider` |

It may import core, runtime and protocol. Its tests are in
`../tests/std-run.test.mjs` and `../tests/std-debug.test.mjs`.
