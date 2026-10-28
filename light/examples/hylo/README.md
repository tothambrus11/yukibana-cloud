# Hylo snippets on one page

A documentation page of ten Hylo snippets, each with its own Run, Stop,
status line and output, running Hylo's own compiler
([@hylo-lang/hylo-wasm](https://www.npmjs.com/package/@hylo-lang/hylo-wasm))
through Yukibana's runtime. It is step HY1 of the architecture plan: the
proof that a host which bundles its own runner, as the Hylo site does, can
use `@yukibana/protocol` and `@yukibana/runtime` as they are, and the
sign-off that made the run API 0.x-stable (`light/modules/runtime/README.md`,
"Stability").

```sh
npm ci
npm run dev                      # http://localhost:5173
npm run check                    # TypeScript, strict, the modules' settings
npm test                         # the runner and the page in Node, workers stood in for
npm run build && npm run test:e2e   # the built page in Chromium, the real compiler
```

## How it is put together

```text
index.html, src/main.ts   the page: snippets as a docs site renders them
src/page.ts               one RunnerPool for the page; each snippet a handle, its panel its events
src/status.ts             the status line, a pure function of the run's state
src/source.ts             Hylo's runner as a host-built source, its needs written beside it
src/runner.worker.ts      the runner worker, bundled with ?worker; starts hylo-wasm's
                          compiler and program workers, bundled with ?worker beside it
src/hylo-runner.ts        the runner itself: protocol/runner.ts on one side, the two
                          hylo-wasm workers on the other
fixture.html, src/fixture the end-to-end test's page: the same runner, with a program
                          worker that reads input
```

```text
page ── RunnerPool ── runner worker ─┬─ compiler worker (hylo-wasm, loaded once)
                                     └─ program worker  (hylo-wasm, ended by Stop)
```

The page depends on `@yukibana/protocol` and `@yukibana/runtime` as
`file:` links to `light/modules`, and imports them by name, as the Hylo
site will. A link is not an install: the page's Vite, TypeScript and unit
tests set the `@yukibana/source` condition, so they read the modules'
sources and need no build, where the Hylo site installs the built tarballs
of a `light-modules-v*` release and sets nothing (`light/modules/README.md`,
Packages; step M9a checks a page that does).

## What the spike checks

In Node (`tests/page.test.mjs`, through the real pool and in-page transport)
and in Chromium with the real compiler (`tests/e2e.mjs`):

- ten snippets on a page create at most one compiler worker (the server
  counts every fetch of the compiler: one);
- running snippet 2 while snippet 1 runs never shows 1's output in 2's
  panel;
- cancelling a looping snippet keeps the compiler worker: Stop ends the
  program worker only, the runner answers `cancel` with a reusable `exit`
  (in Chromium the next snippet ran about 0.3 s after Stop), and the pool
  keeps it;
- a snippet waiting on stdin tells a queued snippet why it waits, and
  stopping it keeps the compiler worker.

The docs page is served without cross-origin isolation everywhere: by
`tests/e2e.mjs`, which serves it from an origin that sends no COOP/COEP
headers (as GitHub Pages serves the Hylo site), and by `npm run dev` and
`npm run preview`, which send them for every response but the docs page's.
Only `fixture.html`, whose reading program needs a SharedArrayBuffer, is
isolated. The runner declares that it needs no isolation, so that is the
page it is checked on: a page served isolated once hid a runner that named
the `SharedArrayBuffer` global, which a page that is not isolated does not
define, and failed every run there.

`tests/hylo-runner.test.mjs` covers the runner's own rules: diagnostics,
traps, a cancel while compiling, a compiler that does not load, requests it
does not serve.

## What the spike found

- **Today's Hylo programs neither print nor read.** hylo-wasm 0.0.9's
  standard library has no `print` and no input: a program says what it did
  by its exit code, and the runner shows that, with the compiler's
  diagnostics on standard error. So Hylo's runner declares that it needs
  nothing of the page (no cross-origin isolation), and the plan's stdin case
  could not be a real Hylo program. The runner nonetheless passes the
  page's input buffer to its program worker and relays streamed output and
  requests for input from it; `fixture.html` replaces hylo-wasm's program
  worker with one that reads (`src/fixture/program.worker.ts`) and then runs
  the real executable, so the case is checked in a browser through the
  same runner and the same nested workers. When Hylo can read, a program
  worker that streams is the only change.
- **hylo-wasm's program worker, not one of ours.** A program worker of our
  own could stream output and block on input, but Hylo programs have neither
  today, so it would be code with nothing to do; the upstream worker is
  used, and the stand-in shows the seam works for the day they have.
- **The compiler sits in its own worker, not in the runner's thread.** The
  runner only routes messages, so it can always read `cancel`: a cancel
  during a compile is answered at once and the late result dropped. A
  compiler in the runner's own thread would leave a cancel unread until the
  compile ended, and the pool would terminate the runner (and the compiler)
  after its one-second grace period for any compile slower than that.
- **No change to the runtime was needed.** Two things a host must know are
  now said in the runtime README: a run's first state arrives before the
  pool returns its handle, and a host-built source is keyed by its `worker`
  function.
