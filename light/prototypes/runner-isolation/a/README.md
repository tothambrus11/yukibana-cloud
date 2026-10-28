**Rejected on 2026-10-25 (E1).** Kept as the record of why: no HTTP cache or service worker for an opaque origin, so packs re-download every run and runners do not work offline; Chromium-specific worker quirks; a per-runner loader would break the pack contract. The code is in d2f873a.

# Runner isolation, option A: an opaque-origin sandbox

Concern R1: a runner is a module worker with the host page's origin, so a
program run in the cloud (or on a docs site) can `fetch('/…')` with the
page's cookies. Option A moves the runner into an
`<iframe sandbox="allow-scripts" srcdoc=…>`, which has an opaque origin and
needs no second origin. This directory is the smallest version of that which
still makes the comparison with option B real. It uses the JavaScript pack's
real, unmodified `runner.js`, including Mutate's nested workers.

```text
transport.js   RunnerTransport: inPageTransport (today) and sandboxTransport (option A)
host.html      the page side of a run session, reduced to what the measurement needs
serve.py       the host: one origin, a SameSite=Lax session cookie on path /, /whoami
measure.mjs    Playwright: the experiment's criteria 1 to 5, host with and without COOP/COEP
```

```sh
python3 serve.py --packs ../../../app/static/packs --port 8111 &   # the JavaScript pack built
HOST=http://127.0.0.1:8111 PLAYWRIGHT_CORE=…/playwright-core node measure.mjs --runs 20
```

## The interface

```ts
type ToRunner = { type: 'run' | 'test' | 'mutate'; files; entry; args?; options? }  // no stdin
interface RunnerConnection {
  send(m: ToRunner): void;              // queued while the transport starts
  input(line: string | null): void;     // answers a `stdin` request; null is end of file
  terminate(): void;                    // the runner and every worker it started
  ready: Promise<{ stdin: boolean }>;
}
interface RunnerTransport { name: string; open(pack, receive: (m: FromRunner) => void): RunnerConnection }
```

The interface has one change from the contract: **stdin belongs to the
transport**. The sandboxed frame is an out-of-process iframe in Chromium (it
is a CDP target of its own), so it is in another agent cluster, and a
SharedArrayBuffer made by the page cannot be posted into it. The frame
makes the buffer and writes each line the page sends with `input`. The
runner sees the contract's buffer as before. `FromRunner` gains
`transport-error`, the transport's sentence for "the runner did not start
or died", so the failure is never silent. With packs served without CORS
it reads: `The runner failed: Uncaught Error: Could not load
http://…/runner.js: TypeError: Failed to fetch dynamically imported module`.

## How it works

The page creates one hidden frame per transport and keeps it (20 ms to
create, median). For each runner it sends `yukibana/connect` to the frame
with two MessagePorts: a control port to the frame (the run message, stdin
lines, terminate) and an output port that the frame hands to the worker.
The frame starts the runner through a **trampoline**. That is the whole
cost of option A in code. No pack changes:

- `new Worker('http://host/packs/javascript/runner.js')` throws in an opaque
  origin (`SecurityError: … cannot be accessed from origin 'null'`).
- `new Worker(blobUrl, { type: 'module' })` **fails in an opaque frame**
  (an error event with no message, even for a one-line module; Chromium
  141). A `data:` module worker starts, but has a fresh opaque origin and
  `crossOriginIsolated === false`. SharedArrayBuffer still works there, but
  the C++ runner's `poll_oneoff` checks the flag and would busy-wait.
- So the trampoline is a **classic blob worker** that `import()`s the
  runner. It keeps the frame's origin and its isolation, and the runner keeps
  its own `import.meta.url`, so pack-relative URLs work. Messages that arrive
  before the module is evaluated are held and dispatched again in order.
- The trampoline patches `Worker` in that worker, so Mutate's
  `new Worker(import.meta.url)` is trampolined as well (and `importScripts`
  for classic workers such as Emscripten pthreads; untested, as the C++
  pack is not built here). It also patches `postMessage` to write to the
  output port, which skips the frame's thread, and coalesces consecutive
  stdout and stderr messages. A batch is flushed before any other message,
  after 4 ms, at 64 KiB, or when the worker yields.

## Measured

Chromium 141 (Playwright 1194), headless, 4-core container, localhost,
20 runs each, medians. "Cold" is a new runner per run, as the app does.
"Warm" opens the runner 300 ms before Run, like the app's spare runner.

| criterion | host isolated (COOP/COEP) | host not isolated |
| --- | --- | --- |
| 1. `fetch(host + '/whoami')`, also with `credentials: 'include'` | **no cookie sent** (server saw `Cookie: null`, `Origin: null`, `Sec-Fetch-Site: cross-site`), response unreadable (TypeError) | same |
| 1. relative `fetch('/whoami')` | TypeError (base is `blob:null/…`), never sent | same |
| 1. `document.cookie`, `localStorage`, `indexedDB`, `caches` | no document, none, SecurityError, absent | same |
| 1. control: in-page worker | cookie sent on 4 of 4 requests, secret read in 3 | same |
| 2. Mutate on the sample (nested workers) | pass, score 77.78, 0.5 s (in-page 0.4 s) | pass |
| 3. stdin, two lines through `prompt()` | pass, runner `crossOriginIsolated: true` | end of file, as in-page |
| 3. `allow="cross-origin-isolated"` on the iframe | required: without it the frame is not isolated | n/a |

Latency, ms (added against in-page in brackets):

| | in-page | A, relayed by the frame | A, own port | **A, own port, batched** |
| --- | --- | --- | --- | --- |
| isolated, cold: first output | 13.2 | 19.6 (+6.4) | 21.2 (+8.0) | **18.7 (+5.5, +42%)** |
| isolated, cold: 1000 lines, start to exit | 18.4 | 38.7 (+20.3) | 36.6 (+18.2) | **20.3 (+1.9, +10.4%)** |
| isolated, cold: 1000 lines after the first | 5.3 | 19.8 | 13.4 | **0.1** |
| isolated, warm: first output | 7.2 | 7.6 | 7.6 | **7.8 (+0.6, +8.7%)** |
| isolated, warm: 1000 lines | 12.6 | 31.8 | 21.0 | **9.2 (−3.4)** |
| not isolated, cold: first output | 12.9 | 19.3 | 19.5 | **17.7 (+4.8, +37%)** |
| not isolated, cold: 1000 lines | 17.6 | 38.4 | 29.6 | **19.1 (+1.5, +8.2%)** |
| not isolated, warm: first output | 7.5 | 8.7 | 7.5 | **8.2 (+0.6, +7.9%)** |

Downloads (the server counts what it sends; packs are `max-age=3600`):

| | in-page | sandbox |
| --- | --- | --- |
| `runner.js` per cold run | 0 (HTTP cache) | 1 |
| `typescript-6.0.3.js` (3.6 MB) over 3 TypeScript runs | 1 | 3 |
| one Mutate of a 2-file project, again | `runner.js` 0, Stryker 0 | `runner.js` 4 (one per mutant worker), Stryker (2.2 MB) 1 |

Lines of transport code (no comments or blank lines): shared 12, in-page
30, sandbox 211. The sandbox count includes the `relay` and `batch` switches
that exist only for this measurement, about 15 lines.

## Verdict on the experiment's rule

Criteria 1 to 3 pass, with and without isolation, and option A needs no
second origin. It does **not** stay within 10% on cold run start: it adds
+5.5 ms (+42%) isolated and +4.8 ms (+37%) not isolated, on a 13 ms
localhost baseline. The 1000-line burst stays within 10% only because of
batching (+10.4% isolated, which is just over; +8.2% not isolated). With a
runner started ahead (the app's `keepWarm` spare), both stay within 10%:
+0.6 ms start, and the burst is faster than today's. Read strictly, A loses
on (4) unless every language keeps a spare runner. Batching is not specific
to A: in-page and B would get the same speed-up from it, which would also
lower the baseline.

## Downsides found

1. **No HTTP cache and no service worker for anything the runner loads.**
   Chromium does not reuse its HTTP cache for requests from an opaque origin.
   The app's service worker controls the app's documents, not an opaque
   frame. So every run fetches `runner.js` again, every TypeScript run
   fetches `typescript.js` (0.8 MB br), every Mutate fetches Stryker and
   one `runner.js` per mutant worker, and **runners stop working offline**.
   On localhost this costs milliseconds. On a real network, with Pyodide
   (4.5 MB), the C++ toolchain (12 MB) or Miri (30 MB) fetched on every run,
   it decides the matter. The fix is that the page fetches pack files
   (through its cache and service worker) and hands the frame their bytes.
   That covers `fetch` with a shim, but not `import(url)` and not
   `new URL(file, import.meta.url)` resolution in the packs. Every runner
   would need a loader indirection. Not built.
2. **Hosting**: packs need `Access-Control-Allow-Origin: *`, because the
   opaque worker loads them in CORS mode, and
   `Cross-Origin-Resource-Policy: cross-origin` or CORS under COEP. Worker
   scripts need COEP, which Light already sends. Without CORS the runner
   fails, and it says so. The host page needs COOP/COEP for stdin, as today,
   and the iframe needs `allow="cross-origin-isolated"`. No second origin,
   no DNS, no certificate. For a docs site or the cloud: one header on
   `/packs/**`.
3. **Platform quirks the design rests on**: blob module workers fail in
   opaque frames, `data:` workers lose isolation, and the frame is out of
   process. These were measured in Chromium only. Firefox and Safari are
   untested, and the trampoline relies on classic workers' `import()`.
4. **Monkey-patching in the runner's global**: `Worker` and `postMessage`
   are replaced in the runner's worker, where the user's program runs too.
   The program can see this. It gains nothing it could not do before, since
   posting to the page is what a runner does.
5. **Requests still leave the sandbox**, without credentials: a no-cors
   `POST` reached `/whoami` with `Origin: null` and no cookie. Any endpoint
   that acts on an unauthenticated request is as reachable as it is from any
   web page. The cloud's writes need the session, so this is no worse than
   the open web.
6. **Each worker's trampoline blob URL is never revoked**: about 3 KB per
   worker, one per mutant.
7. **Not covered**: the LSP workers (the WorkerFactory) still run on the host
   origin, as the decision says. Preview already has its own sandboxed frame
   and could share this one. C++ pthreads in the frame are not tested.

## For a Hylo-style playground on a static docs site

One origin; `Access-Control-Allow-Origin: *` on the packs; COOP/COEP on
the page only if programs read stdin. Offline does not work, and every
run downloads the runner again, until the packs load through a loader the
page can serve (downside 1).
