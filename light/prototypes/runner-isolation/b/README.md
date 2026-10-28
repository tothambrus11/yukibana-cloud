# Runner isolation, option B: a frame on a packs origin

Concern R1: a pack's runner is a module worker of the page, so a program
runs on the page's origin. On the cloud, where the session is a cookie on
path `/`, a student's program that a teacher runs could `fetch('/…')` as
the teacher. Option B moves the runner into a hidden iframe served from a
second origin, the **packs origin**. The frame starts the runner with
`new Worker(url)`, as the page does today, and relays the contract's
messages over a `MessageChannel`. Option A (an opaque-origin sandboxed
`srcdoc` frame) is built separately, in `../a/`.

This is a prototype for the comparison. It does not change the app: Light
keeps the in-page worker, because it holds no credentials.

## Files

| file | what |
|---|---|
| `transport.d.ts` | `RunnerTransport` / `RunnerHandle`, the seam M3's RunSession would run over, plus the frame protocol |
| `stdin.js` | the contract's stdin buffer, shared by both transports |
| `in-page.js` | the baseline: the runner as a worker of the page (Light today) |
| `framed.js` | option B, host side: loads the frame, hands it a port, relays |
| `frame.js`, `run-frame.html` | option B, frame side, served from the packs origin |
| `host.html` | the host page, standing in for the cloud |
| `serve.py` | both origins, with a session cookie on the host and `/whoami` |
| `measure.mjs` | Playwright: every criterion below, with checks |

```sh
node measure.mjs --packs ../../../app/static/packs   # javascript pack built; starts serve.py itself
npx tsc -p .                                       # strict check of the JSDoc-typed transport
```

## The API shape this forces

The app cannot pass the stdin `SharedArrayBuffer` any more. An isolated page
and a cross-origin frame are separate agent clusters. A buffer posted from
one to the other arrives as a `messageerror` (measured). So the buffer is
created where the runner lives, and the session answers input through
`handle.input(line | null)`. `ToRunner` therefore has no `stdin`, and the
transport adds it. Everything else in run.svelte.ts maps one to one:
`new Worker` becomes `transport.start(pack)`, `postMessage` becomes
`send`, and `onmessage`, `onerror` and `terminate` stay. That includes the
spare and warm runners: the frame keeps any number of runners by id.

## Measured

Chromium 141 (Playwright 1.56), headless, on a 4-core container. Both
origins are served by `serve.py`. "coi" means the host sends COOP and COEP;
"plain" means it sends neither.

### 1. Security: a program fetching the host's `/whoami`

The host sets `sb-access-token` (SameSite=Lax, as @supabase/ssr sets it)
and a SameSite=None test cookie. The program makes four requests:
`fetch` with the defaults, `credentials: 'include'`, `mode: 'no-cors'`
with credentials, and a no-cors form `POST` with credentials.

| | Lax session sent | response readable | None cookie sent |
|---|---|---|---|
| in-page (control), any setup | all 4 | all 4 | all 4 |
| **framed, cross-site** (127.0.0.1 vs localhost), coi and plain | **none** | **none** | include, no-cors, POST |
| framed, **same-site** (app.yukibana.localhost vs packs.yukibana.localhost) | include, no-cors, **POST** | none | include, no-cors, POST |

Also measured, for every framed setup:

* In the worker, `document`, `localStorage` and `cookieStore` are
  `undefined`.
* In the frame document, `document.cookie` is `''` and `localStorage` is
  empty.

Criterion 1 passes **only if the packs origin is a different site** (a
different registrable domain) from the host. `packs.yukibana.dev` beside
`yukibana.dev` is same-site. The Lax cookie then rides along with
`credentials: 'include'` and with a no-cors POST. The response stays
unreadable, but a write by GET or by POST lands as the teacher.
SvelteKit's CSRF check would refuse that cross-origin form POST. It would
not refuse a GET with side effects or a JSON endpoint that skips the
check. A SameSite=None cookie on the host is sent even cross-site, so the
cloud's cookies must stay Lax or Strict.

### 2. Test and Mutate (nested workers)

In both coi and plain, Test passes (4 pass, 0 fail). Mutate scores
**77.78 %**, the same as in-page and as real Stryker. It took 0.5 to 0.7 s,
and its mutants ran in workers that the runner started inside the frame.
Nothing in the javascript pack changed: `import.meta.url`, `new
Worker(import.meta.url)`, the `blob:` module URLs and the lazy fetches of
`stryker-10.1.1.js` and `strip.js` all work, because the frame is an
ordinary origin.

### 3. stdin

* **coi:** the frame is cross-origin isolated (it has
  `allow="cross-origin-isolated"`), so the runner has `SharedArrayBuffer`.
  Two `prompt()` lines read `Ada` and `36`.
* **plain:** the frame cannot be isolated when its top page is not.
  `prompt()` returns `null` (end of file), as it does in-page without
  isolation.

### 4. Latency (ms, median [p25, p75] of 20 interleaved runs)

"start" is the time from `start()` to the first stdout of
`console.log('hello')`. "burst" runs from the first to the last of 1000
`console.log` lines, then exit. "total" runs from `start()` to the exit of
the burst program.

| coi | start | burst | total |
|---|---|---|---|
| in-page | 15.6 [14.7, 17.0] | 4.8 [4.5, 5.4] | 19.8 [18.7, 21.5] |
| framed | 16.0 [15.2, 16.5] | 20.5 [18.9, 23.1] | 36.9 [35.5, 38.7] |
| framed, `?batch` | 15.5 [15.1, 16.7] | 6.3 [5.0, 7.0] | 22.5 [21.4, 24.9] |
| framed, new frame per run | 37.6 [34.8, 40.6] | | |

| plain | start | burst | total |
|---|---|---|---|
| in-page | 14.4 [13.6, 16.4] | 4.6 [4.4, 5.4] | 19.0 [17.6, 19.6] |
| framed | 13.9 [13.6, 14.9] | 19.6 [18.7, 20.8] | 33.8 [32.9, 35.6] |
| framed, `?batch` | 15.3 [14.6, 15.7] | 6.0 [5.6, 6.5] | 21.5 [20.2, 23.3] |
| framed, new frame per run | 32.7 [31.7, 35.9] | | |

* **Run start:** the frame adds nothing measurable (+0.4 ms coi, −0.5 ms
  plain), as long as the frame is kept. A new frame for each run adds
  about 20 ms.
* **1000-line burst:** relaying each message as it comes costs about
  15 µs per message, so the burst is 4.3 times slower (+15 ms). With
  `?batch`, the frame relays whatever arrived within one task as one port
  message. The burst is then +1.5 ms (131 %), and start is unchanged. A
  real implementation would batch.
* Measurement mistake, fixed: an earlier run showed starts of 55 ms instead
  of 15 ms on most runs, framed and in-page alike. The cause was Nagle's
  algorithm plus delayed ACK in `serve.py` on kept-alive connections.
  `disable_nagle_algorithm` fixed it. `measure.mjs` prints the share of
  fast starts so that a relapse shows up.

### 5. Code and hosting

Lines without blanks or comments:

| file | lines |
|---|---|
| `framed.js` | 65 |
| `frame.js` | 46 |
| `run-frame.html` | 5 |
| **option B beyond in-page** | **116** |
| `in-page.js`, for comparison | 36 |
| `stdin.js`, shared | 16 |
| `transport.d.ts`, types | 37 |

The 116 lines include about a dozen for the optional batching.

What the hosting must provide. Each item was measured by serving the frame
without it, on an isolated host:

| requirement | without it |
|---|---|
| a **second site**, a separate registrable domain, not a subdomain | the session cookie is sent (see 1) |
| `run-frame.html`: `Cross-Origin-Resource-Policy: cross-origin` | the frame is blocked; `framedTransport` times out and says why |
| `run-frame.html`: `Cross-Origin-Embedder-Policy: require-corp` | the frame is blocked |
| `frame.js` and every pack file a worker loads: `COEP: require-corp` | the frame loads, but "the runner failed to load" |
| `<iframe allow="cross-origin-isolated">` on the host | it runs, but stdin is end of file |
| host page: COOP + COEP (as Light already sends) | stdin is end of file, for in-page too |
| `run-frame.html`: `Content-Security-Policy: frame-ancestors <hosts>`, and the same list in `frame.js` | nothing breaks; any site could drive the frame |
| no cookies on the packs origin, ever | (not measured) |

## Downsides found

* **A second domain, not a subdomain.** This is the main cost. Same-site
  does not protect a SameSite=Lax session (measured above). The cloud
  needs something like a separate `yukibana-usercontent.dev`: a second
  zone, a second Worker route or bucket, with its own TLS and DNS. A docs
  site that wants runnable snippets needs the same, or must use the
  cloud's packs domain and be on its allowlist.
* **The allowlist lives in two places**: the header and `frame.js`. Every
  host that embeds the frame (the cloud, each docs site, local dev) must
  be listed and redeployed. The alternative is `frame-ancestors *`. The
  frame holds nothing, so that is defensible, but then any site can run
  code on the packs origin.
* **The packs origin's storage belongs to every program.** In the frame,
  the probe could write Cache Storage (`caches.put` of a fake
  `packs/javascript/runner.js`) and open IndexedDB. So the packs origin
  must never serve from storage a program can write. A service worker
  there that caches `/packs/**`, as Light's does on its own origin, could
  be poisoned for every later run in that browser. Offline use of the
  cloud's runners needs care for that reason. (Option A's opaque origin
  has no storage at all.) As an aside, the in-page probe can write the
  host's Cache Storage too. I did not check whether Light's service worker
  would serve a planted entry.
* **The language server and the runner no longer share downloads.**
  CONTRACT.md lets them share files by URL so they are cached once. If
  `server.js` stays a worker of the page and the runner moves to the packs
  origin, shared files (the JS pack's 3.6 MB `typescript-6.0.3.js`, which
  is 800 KB brotli; a compiled toolchain's wasm) are fetched and cached
  once per origin. Moving the language server into the frame too would
  fix that, but it puts LSP traffic behind the same hop. That was not
  measured.
* **stdin needs the host's isolation and the `allow` attribute**, and the
  `SharedArrayBuffer` cannot cross. So the transport owns the buffer
  (`handle.input`). The change is small, but it changes the contract's
  message as the app sends it.
* **Per-message relay cost** is real (about 15 µs per message) until
  batched. Batching is easy, but it is a second place that decides when
  output is "as produced".
* **A packs-origin deploy must send headers.** A host that cannot set
  headers (GitHub Pages) cannot be the packs origin. The service-worker
  trick for COOP/COEP covers top-level pages, not this.

## Against the experiment's rule

Criteria 1 to 3 pass, with criterion 1 only on a separate site. Added
latency: start +0.4 ms. The burst is +15 ms unbatched (427 %) and
+1.5 ms batched (131 % of a 4.8 ms burst, +2.7 ms or 114 % of total). The
batched burst still misses a strict 10 % on a relative basis. In absolute
terms it is about 1.5 µs per line. Hosting needs one extra site and four
headers.
