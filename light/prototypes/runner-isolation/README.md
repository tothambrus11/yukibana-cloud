# Runner isolation (experiment E1)

**The question.** A pack's runner is a module worker of the page, so a
program runs on the page's origin. Light's own app holds no credentials, so
that costs nothing there. yukibana-cloud does hold them: its session cookies
are set on path `/` (`app/src/lib/server/session.ts`). So a submitted
program that a teacher runs could `fetch('/…')` as the teacher, and its
same-origin requests would also pass an Origin check. It could enrol
students, set platform roles or publish a release. Where should a runner
live on a host that holds credentials, and what does that cost?

**Outcome: option B** (`b/`), a hidden iframe on a dedicated packs origin
that is a **different registrable domain** from the host. It is the design
the rest of Light builds on. **Option A** (`a/`), an opaque-origin
`srcdoc` sandbox, was rejected. Only its README is kept on this branch, as
the record of why. Its code is in commit `d2f873a`.

## The criteria

1. **Security.** A program's requests to the host carry no session and
   read nothing back.
2. **Test and Mutate.** The JavaScript pack's runner works unmodified,
   nested workers included (Mutate starts one worker per mutant).
3. **stdin.** `prompt()` still reads lines when the host is cross-origin
   isolated.
4. **Latency.** Run start and a 1000-line burst stay within 10 % of the
   in-page worker.
5. **Cost.** Lines of code, and what the hosting must provide.

Both prototypes put the same seam in front of the runner, a
`RunnerTransport` (`b/transport.d.ts`). The in-page worker of today is one
implementation of it, and the candidate is the other.

## Measured

Chromium 141, headless, on a 4-core container, localhost. The details and
the method are in each option's README.

| | A: opaque `srcdoc` sandbox | B: frame on a packs origin |
|---|---|---|
| 1. Lax session sent to the host | never (`Origin: null`, no cookie) | never if the packs origin is **another site**; with `credentials: 'include'` and a no-cors POST if it is only a subdomain (same-site) |
| 1. response readable | never | never |
| 1. SameSite=None cookie sent | never | yes, even cross-site, so the cloud's cookies must stay Lax or Strict |
| 1. storage the program can write | none (opaque origin) | the packs origin's Cache Storage and IndexedDB, so that origin must never serve packs from storage |
| 2. Test / Mutate | pass / 77.78 % | pass / 77.78 % (the same as in-page and as real Stryker) |
| 3. stdin | works; the `SharedArrayBuffer` must be made in the frame | works; the `SharedArrayBuffer` must be made in the frame |
| 3. without host isolation, or without `allow="cross-origin-isolated"` | end of file | end of file |
| 4. cold run start, isolated | +5.5 ms (+42 %) on 13.2 ms | +0.4 ms on 15.6 ms (frame kept); a new frame per run costs about 20 ms more |
| 4. 1000-line burst, batched | +1.9 ms on 18.4 ms start-to-exit (+10.4 %) | +1.5 ms on a 4.8 ms burst; +2.7 ms (+14 %) of total |
| 4. 1000-line burst, unbatched | +18.2 to +20.3 ms | +15 ms (about 15 µs per message) |
| 4. warm runner start | +0.6 ms | (not measured separately; start is already +0.4 ms) |
| downloads | no HTTP cache, no service worker: `runner.js` on every run, `typescript.js` on every TypeScript run, Stryker and one `runner.js` per mutant on every Mutate; **no offline** | the ordinary HTTP cache of the packs origin |
| code beyond in-page | 211 lines | 116 lines |
| platform quirks relied on | blob module workers fail in an opaque frame; `data:` workers lose isolation; a classic-blob `import()` trampoline that patches `Worker` and `postMessage`; Chromium only | none: the frame runs `new Worker(url)` as the page does today |

Batching is not specific to either option: in both, consecutive stdout and
stderr lines from one task travel as one message, and the in-page
transport would gain the same speed-up.

### What the hosting must provide

| | A | B |
|---|---|---|
| a second origin | no | **yes, a separate registrable domain** (DNS, TLS, deploy) on a host that can set headers (not GitHub Pages) |
| on the packs | `Access-Control-Allow-Origin: *`, and CORP cross-origin or CORS under COEP | COEP `require-corp` on `run-frame.html`, `frame.js` and every pack file a worker loads |
| on the frame | (none, it is `srcdoc`) | `run-frame.html`: CORP `cross-origin`, and `Content-Security-Policy: frame-ancestors <hosts>` with the same list in `frame.js` |
| on the host page | COOP + COEP for stdin, and the iframe's `allow="cross-origin-isolated"` | the same |
| on cookies | none | the host's session cookies Lax or Strict, never None; no cookies on the packs origin |
| on storage | none | no service worker and no Cache Storage or IndexedDB-backed serving of packs on the packs origin |

## Why B

A passes the security criterion without a second domain, which is its one
real advantage. It loses on what a course platform cannot work around. An
opaque origin gets no HTTP cache and no service worker in Chromium, so a
pack is downloaded again on every run. Pyodide is 4.5 MB, the C++
toolchain 12 MB and Miri 30 MB, and runners stop working offline. The fix
would be a loader that hands the frame the bytes of each pack file. That
covers `fetch`, but not `import(url)` or `new URL(file, import.meta.url)`,
which the pack contract (`light/packs/CONTRACT.md`) promises packs. Every
runner would need to change. A also rests on Chromium-only worker
behaviour that Firefox and Safari were never tested against.

B costs a second registrable domain and a short list of headers. In
return, packs stay unmodified, are HTTP-cached and keep working offline. It
adds no measurable run-start latency once its frame is kept across runs.

## Where this goes

* The modular architecture plan (revised 2026-10-25), **H9**: user code
  never runs on a credentialed origin. Light's app and static docs sites
  keep the in-page `workerTransport`. A host that holds credentials, such
  as yukibana-cloud, runs its runners only through `framedTransport` on a
  packs origin that is a different registrable domain. The rule that the
  cloud's cookies stay Lax or Strict is step **CK1**.
* Step **M3** takes `b/transport.d.ts` as the starting shape of
  `RunnerTransport` and `workerTransport` in `light/modules/runtime/`.
  stdin belongs to the transport (`handle.input(line | null)`), and output
  is batched per task.
* Step **M10** turns `b/framed.js`, `b/frame.js` and `b/run-frame.html`
  into `runtime/frame-transport.ts`, `protocol/frame.ts` and
  `light/frame/`, with `allowed-ancestors.json` as the one allowlist. It
  adds the credential negatives that `b/measure.mjs` checks here.

## Files

* `b/`: option B, the whole prototype. Run it with `b/README.md`.
* `a/README.md`: option A's measurements and downsides. The code is in
  commit `d2f873a`.
