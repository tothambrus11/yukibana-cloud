# A course page with graded exercises

The use case: an interactive programming **course**, one lesson page of
graded exercises that run in the student's browser. Each exercise has its
instructions, a starter file in an editor, **Run** with standard input,
**Check**, which runs hidden tests and turns their report into a pass/fail
checklist, and **Show solution**, the model solution as a diff of what the
student wrote. A progress bar across the top counts the exercises passed;
it, the checklists' scores and every draft are kept in `localStorage`, so
a reload or a later visit picks up where the student was.

The lesson has one exercise per language, each tested the way that
language is tested for real, so the hidden files are what a grader would
run too:

| Exercise | Language | Tests | Report read |
|---|---|---|---|
| The most frequent words | Python | pytest (`tests/test_words.py`) | pytest `-v` |
| Run-length encoding | JavaScript | `node:test` with two fast-check properties | Node's spec reporter |
| Roman numerals | Rust | `#[test]`s in `tests/roman.rs`, as `cargo test` runs them | libtest |
| Counting bits | C++ | GoogleTest (`tests/bits_test.cpp`) | GoogleTest |
| Balanced brackets | Swift (**untested**, see below) | XCTest (`Tests/BracketsTests.swift`, `@testable import App`) | XCTest |

**Swift is untested.** The Swift exercise has never been compiled or run:
no machine this was built on had the Swift pack (`light/packs/swift`,
`./build.sh`, needs about 5 GB of disk for the toolchain it downloads), and
CI does not build it. Its files follow the Swift pack's README and its
report reader is tested on the format that README documents, but until
`node test.mjs` has passed with `light/app/static/packs/swift` installed,
treat the Swift exercise as a draft, not as a working language.

Built with Svelte 5 and Vite (no SvelteKit: a course page is one page), on
the embeddable packages of `light/modules`, imported by name as another
site would import them.

```sh
npm ci
PACKS=/path/to/packs npm run dev   # http://localhost:5173 (default PACKS: light/app/static/packs)
npm run check                      # svelte-check (components and .ts, strict), and vite.config.ts
npm run build && npm test          # unit tests (reports, diff, progress, the lesson) and the bundle fixtures
npm run build && npm run test:e2e  # the page in Chromium with the installed packs (PACKS too)
```

## What of Yukibana it uses

| Package | For |
|---|---|
| `@yukibana/core` | one `createInstance` for the page, over the five languages; `availability` (Run and Check are enabled, or say why not), `perform`; `Project`, `snapshotOf`, `EditorPort` |
| `@yukibana/std` | the `run` and `test` tokens (a Check is `test` with the hidden files added to the snapshot); `packLanguage`; `PackHost` |
| `@yukibana/runtime` | the page's one `RunnerPool` (`workerTransport`, `PackLocator.unpinned`), `RunHandle.input` and `endInput` for standard input, `RunState` for the status line |
| `@yukibana/protocol` | `Requires` (cross-origin isolation for stdin), `TestReport` and `TestOutcome` |
| `@yukibana/lang-python`, `-javascript`, `-rust`, `-cpp`, `-swift` | each language's spec and providers; each body only by `import()`, which nothing on the page asks for |
| `@yukibana/monaco` | `monacoPort`, Monaco as the core's `EditorPort` |
| `@yukibana/editors/textarea` | the textarea every editor is until Monaco arrives, and stays on a phone |

## How it is put together

```text
src/main.ts                  makes the store and mounts <App>
src/App.svelte               the lesson: masthead, sticky <ProgressBar>, one <Exercise> per exercise, theme
src/components/
  Exercise.svelte            one exercise: instructions, <Editor>, stdin, Run / Check / Stop,
                             output, <Checklist>, Show solution (<DiffView>), Use the solution, Reset
  Editor.svelte              a textarea at once; Monaco, by import(), once the editor is near the
                             screen, unless the browser is a phone (or ?editor=textarea)
  Checklist.svelte, DiffView.svelte, ProgressBar.svelte
src/lib/
  course.svelte.ts           the store: one PageHost (one pool), one Instance of every exercise's
                             language, the progress kept in localStorage; setCourse / getCourse
  exercise.svelte.ts         one exercise's session: Run, Check, Stop through the course's instance,
                             and what they show (status, output, checklist, verdict)
  host.ts                    the host the instance borrows (as two-up's): pool, packs, runners' needs
  languages.ts               per language: package, body loader, Monaco grammar, report format
  exercises.ts               the lesson: instructions, starter, solution, support files, hidden tests,
                             checks
  report.ts                  a test run's report read as a checklist, per framework (pure)
  diff.ts, progress.ts, inline.ts, status.ts, theme.svelte.ts, editor.ts, monaco-editor.ts
```

```text
<Exercise> python ─┐                               ┌─ python runner worker
<Exercise> js     ─┤                               ├─ javascript runner worker
<Exercise> rust   ─┼── one Course ── one Instance ── one RunnerPool ─┼─ rust runner worker
<Exercise> c++    ─┤      (store)    (5 languages)                    ├─ cpp runner worker
<Exercise> swift  ─┘                                                  └─ swift runner worker
```

Each exercise names its runs by its id in the pool, so a Run of one
exercise never stops another's, a Check replaces the same exercise's Run,
and two exercises of one pack wait for each other rather than start two
runners of it.

**How a Check becomes a checklist.** No pack's runner sends the
machine-readable `test-report` yet (protocol/runner.ts reserves it), and
the exit code is the verdict. So `report.ts` reads what the student reads,
each framework's per-test lines with the colours removed, and the reason
of each failure (pytest's short summary, Node's failing-tests section and
fast-check's counterexample, libtest's panic, GoogleTest's failed
expectation, XCTest's assertion). A `test-report`, when a runner sends
one, wins over the text. Either way an exercise passes only when the run
exits 0 and every check the exercise lists passed (`verdictOf`); a test
nobody expected still shows, under its own name. The unit tests read real
reports of the starters (`tests/fixtures`, recorded from the packs), and
Swift's written from the Swift pack's XCTest format.

## What it checks

`npm test`: the five report readers over real reports, the checklist's
matching and verdict, the diff and its hunks, progress kept and read back
from storage that throws or holds an older shape, and the lesson's data
(every check names a hidden test, Run's entry is in the project, the
instructions' code spans pair up). And from the build
(`tests/bundle.test.mjs`): a first load runs at most 1% more script than
`bundle-budget.json` records and none of Monaco, `@yukibana/monaco`, a
language's body or a compiler; no module is in two chunks (five
languages, one core, std and runtime); Monaco is one chunk, imported
lazily.

`npm run test:e2e` (`test.mjs`), in Chromium, for every exercise whose pack
is installed: the page is cross-origin isolated; it has one instance of all
five languages and one pool; nothing starts a runner before the first Run
or Check; the first editor turns into Monaco once on screen; the
starter's Check passes exactly the checks it should, gives every failure
its reason and sets the badge to the score; Show solution draws a diff,
Use the solution then Check passes every check and marks the exercise
passed; Run with the standard input prints exactly what the program should;
two exercises of different packs check at once; there are never two
runners of one pack; the progress bar counts the passed exercises; after a
reload the progress, badges and drafts are back; the theme switches the
page and Monaco; and on a phone (390 px, touch) the editor is the textarea,
no Monaco is fetched, what is typed is what Check tests, and nothing
scrolls sideways. An exercise whose pack is not installed is skipped and
the test says so (Swift's pack has never been installed where this ran,
so Swift is always among them so far).

## Bundle

A first load runs **48.8 KB of script, gzip** (`bundle-budget.json`, 48,771
B at level 9), plus 3.6 KB of CSS: Svelte's client runtime and the page's
components, the lesson's text and files, core, std, the runtime's pool and
transport, the textarea editor, and the five languages' specs and
providers (lang-cpp's availability rules are most of that, as in two-up).
What loads later:

* **Monaco**, 696 KB gzip with its CSS (14 KB) and `@yukibana/monaco`'s
  port and the five grammars: one chunk, imported the first time an editor
  comes within 400 px of the screen, and never on a phone. Its editor
  worker (304 KB) starts with the first Monaco editor.
* **The compilers and runtimes**, which are the packs': fetched by each
  pack's runner worker at its first Run or Check (Pyodide and pytest,
  rustc, clang and GoogleTest, swiftc and XCTest), from the packs'
  own URLs, never bundled.
* **Each language's body** (its sample project and settings), a chunk of
  1 to 3 KB each that this page never asks for.

## Hosting the packs, and the headers

The packs are static files, served under `packs/` beside the page
(`<page>/packs/<pack>/runner.js`); `PackLocator.unpinned` reads them
there. In dev and preview `vite.config.ts` serves `$PACKS` (default
`light/app/static/packs`, where Light's app installs them) under `/packs/`;
nothing is copied or linked into this directory. A real site copies the
packs it uses (here `python`, `javascript`, `rust`, `cpp`, `swift`) from a
Light build into its static root, or proxies `/packs/` to a packs host on
the same origin (the runners' needs say `sameOriginPacks`), serving
`.wasm` as `application/wasm` and, where it can, the `.br` or `.gz` files
the packs ship beside each large file.

Every response of the page and of the packs needs

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

so the page is cross-origin isolated: standard input is a
SharedArrayBuffer the program reads while the page writes. Dev and preview
send both (`vite.config.ts`), and so does `test.mjs`'s server. Without them
every exercise still runs and checks, and a program reading stdin reads end
of file at once (the runtime says so in the output).

## Not done

* No language server: Monaco highlights, and nothing more (DESIGN.md
  section 17 says what binding one takes).
* Swift is untested (above): its files follow the Swift pack's README
  (XCTest discovery, `@testable import App`, `main.swift` left out of a
  test run), and nothing has compiled them.
* CI (`light-ci.yml`, job `svelte-course-example`) type-checks, builds,
  runs the unit tests and bundle fixtures, and runs `test.mjs` with the
  JavaScript pack only, the one pack that workflow builds; Python, Rust,
  C++ and Swift run end to end only where their packs are installed.
