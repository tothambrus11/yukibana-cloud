# @yukibana/std

The tokens any language of Yukibana Light may provide, and the helpers that
make a language's providers of them from its pack. Step 2 of
`../DESIGN.md`: run, test and mutate; step 4: debug, debug tests and
preview; step 5: explore; step 6: what the language packages share (the
spec a package describes a language with, levels, a Linux target's run
options, the views' kinds); step 9: export, what a language gives a
downloaded project.

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
* **One test only where the runner selects.** `testCase` and
  `debugTestCase` send a test run's message with `test` (and, for the
  second, `breakOnFailure`), fields a runner that does not know them
  ignores by running every test. So they are tokens of their own, which a
  language provides only when its runner honours them, and which a host
  offers ("Run test", "Debug test") only where they are available. "Stop
  on failed assertion" is a third, `failureStop`, which requires
  `debugTestCase` and answers how the runner stops (function breakpoints
  or exception filters, which the host's debugger sets): a language can
  debug one test without it, and the host hard-codes no way of stopping.
  With neither field set, their messages are Test's
  and Debug tests' exactly. Where the tests are is `findTests`, which
  requires `testCase`: a file's tests, each with the selector that runs it
  and its lines, found from the snapshot alone by a body loaded on the
  first request. A package gives these from an entry of its own
  (`/single-test`, a `LanguageSingleTest` for each language whose runner
  selects), not from `providers`, so that a host that runs whole projects
  only (an embed) carries none of them.
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
* **A download is the host's, made of the languages' parts.** A
  language's providers of `exportBuild` (one per build system, keyed by
  its id, the usual one first) and `exportTooling` (its tools) are made by
  `exportProviders` over the language's export body, which they import on
  their first perform; whether a build system can build a project is its
  provider's `available`, read without loading it. The keys are a type
  parameter: a spec naming a build system its body lacks does not compile. A package gives them
  from an entry of its own (`/download`, a `LanguageDownloads` for each
  of its languages), not from `providers`, so that a host that downloads
  nothing (an embed) carries none of them. The README, the
  .gitignore, the CI services and the dev container are the host's to
  compose over them. What the bodies share (environments, steps,
  Spotless) is `@yukibana/std/export-kit`, which std's index does not
  import.
* **No side effects.** Importing it defines thirteen tokens and some plain
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
| `debug.ts` | `debug`, `debugTest` (`Token<DebugInput, DebugSession>`), `debugTokenOf`, `debugMessage`, `debugProvider`; `debugTestCase` (`Token<DebugTestCaseInput, DebugSession>`), `debugTestCaseMessage`, `debugTestCaseProvider`; `failureStop` (`Token<null, FailureStop>`), `failureStopProvider` |
| `export.ts` | `exportBuild` (`Token<null, BuildSystem, 'many'>`), `exportTooling` (`Token<null, LanguageTooling>`), the CI model (`Environment`, `Extra`, `Step`, `JobSpec`, `LocalCheck`, `BuildCi`), `ExportProject`, `LanguageExport`, `ExportBuildSpec`, `exportProviders`, `LanguageDownloads` |
| `export-kit.ts` (`@yukibana/std/export-kit`) | What the language packages' export bodies share: `withExtra`, `env`, `sources`, `trackedFiles`, `steps`, `testJob`, and Spotless (`spotlessJob`, `spotlessMaven`, `spotlessGradle` and its pins) |
| `explore.ts` | `explore` (`Token<EmitInput, Promise<EmitResult>>`), `ViewKind` and `viewKind`, `LanguageViews`, `ExploreView`, `ExploreToggle`, `viewIn`, `defaultOptions`, `ExploreHost`, `ExploreHolder`, `pageExplorers`, `explorerProvider` (an `ExplorerProvider`: its views and its `release`), `isExplorerProvider` |
| `explore-workers.ts` | loaded lazily: `ExplorerWorkers` (with `pagePlatform`), `resultOf`, `explorePerform` |
| `tests.ts` | `findTests` (`Token<FindTestsInput, readonly FoundTest[]>`), `TestFinder`, `findTestsProvider`, `testAt`, `LanguageSingleTest` |
| `preview.ts` | `preview` (`Token<PreviewInput, PreviewSession>`), `BuiltPage` |
| `run.ts` | `run`, `test`, `mutate` (`Token<RunInput, RunHandle>`), `tokenOf`, `RunInput`, `PoolHost`, `RunHost`, `sourceOf`, `runMessage`, `runProviderFrom`, `runProvider`; `testCase` (`Token<TestCaseInput, RunHandle>`), `testCaseMessage`, `testCaseProvider`; `warm` (`Token<null, SessionSource>`), `warmProvider` |

It may import core, runtime and protocol. Its tests are in
`../tests/std-run.test.mjs`, `../tests/std-debug.test.mjs`,
`../tests/std-test-case.test.mjs`, `../tests/cpp-test-cases.test.mjs`
(`findTests` and `testAt`, through C++'s) and
`../tests/std-explore.test.mjs`.
