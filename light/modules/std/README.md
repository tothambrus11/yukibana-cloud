# @yukibana/std

The tokens any language of Yukibana Light may provide, and the helpers that
make a language's providers of them from its pack. Step 2 of
`../DESIGN.md`: run, test and mutate; step 4: debug, debug tests and
preview; step 5: explore; step 6: what the language packages share (the
spec a package describes a language with, levels, a Linux target's run
options, the views' kinds). Export follows in a later step.

## Contract

* **No language.** It names no language id: a language package
  (`../lang-<pack>`) says which tokens its language has and when they are
  available; `../boundaries.test.mjs` refuses a language id
  in its string literals.
* **Today's messages.** A provider made by `runProvider` sends its pack's
  runner the very message the app sent before (`runMessage`: `type`,
  `files`, `entry`, and `options` only when there are some), through the
  host's one `RunnerPool`, and returns the pool's `RunHandle`: the terminal
  sees the same events, early ones included.
* **The host lends the pool.** A provider makes no pool and no worker: its
  host (`RunHost`) has the page's pool, the pack locator and what the
  host's runners need, so every instance on a page shares runners. A host
  whose runner it built itself lends only the pool (`PoolHost`), and its
  provider (`runProviderFrom`) names that runner's source.
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
* **One explorer worker per pack, and no wait past an abort.**
  `explore`'s provider (`explorerProvider`) sends its pack's
  `explorer.js` today's `emit` message through the host's
  `ExplorerWorkers`, which starts one worker per pack on the page and
  stops it once every holder that asked has let it go; its answer settles
  as soon as the perform's signal is aborted (`dropped`), since
  explorer.js drops the answer to a request replaced while it compiled. A
  host aborts a view's request when it makes a newer one. The workers and
  the provider's body are loaded at the first request
  (`explore-workers.ts`); an answer that is not what the contract says is
  `broken`, naming the field.
* **No side effects.** Importing it defines eight tokens and some plain
  data (the shared toggles) and does nothing else
  (`../tests/imports.test.mjs`); the explorer workers' code is not even
  loaded until a request needs it.

| File | What |
|---|---|
| `language.ts` | `PackLanguage`: a `LanguageMeta` with the pack it runs on and the packs that one uses (checked pack ids), and its server's settings and configuration files in its body; `PackLanguageSpec`, a language package's plain description of one, and `packLanguage`, which checks it; `PackageLanguage<H>`, a spec and its providers; `PackHost` |
| `explore-views.ts` | `exploreView` (a kind's title, short form and noun), `exploreToggle`, and the toggles more than one language offers (`demangleToggle`, `DIRECTIVES_TOGGLE`, `libraryToggle`, `optimizeToggle`) |
| `levels.ts` | `OptimizationLevel`, `defaultLevel`, `LevelChoice`, `savedLevel`, `levelProperty` (a level saved with the project) |
| `linux.ts` | `TargetId`, `TARGET_SHORT`, `RunOptions`, `DEFAULT_RUN_OPTIONS`, `runOptionsOf`, `runOptionsProperty`, `describeRunOptions` |
| `read.ts` | `valueOf` (a property's value as a build uses it), `always`, `NO_PROPERTIES` |
| `debug.ts` | `debug`, `debugTest` (`Token<DebugInput, DebugSession>`), `debugTokenOf`, `debugMessage`, `debugProvider` |
| `explore.ts` | `explore` (`Token<EmitInput, Promise<EmitResult>>`), `ViewKind` and `viewKind`, `LanguageViews`, `ExploreView`, `ExploreToggle`, `viewIn`, `defaultOptions`, `ExploreHost`, `ExploreHolder`, `pageExplorers`, `explorerProvider` (an `ExplorerProvider`: its views and its `release`), `isExplorerProvider` |
| `explore-workers.ts` | loaded lazily: `ExplorerWorkers` (with `pagePlatform`), `resultOf`, `explorePerform` |
| `preview.ts` | `preview` (`Token<PreviewInput, PreviewSession>`), `BuiltPage` |
| `run.ts` | `run`, `test`, `mutate` (`Token<RunInput, RunHandle>`), `tokenOf`, `RunInput`, `PoolHost`, `RunHost`, `sourceOf`, `runMessage`, `runProviderFrom`, `runProvider`; `warm` (`Token<null, SessionSource>`), `warmProvider` |

It may import core, runtime and protocol. Its tests are in
`../tests/std-run.test.mjs`, `../tests/std-debug.test.mjs` and
`../tests/std-explore.test.mjs`.
