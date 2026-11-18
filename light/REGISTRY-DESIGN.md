# Yukibana registries: design proposal (v2, after review)

Status: **proposal**, not settled. Written for Ambrus on 2026-11-14. Version 1 of this
design was attacked by a security reviewer and an operations reviewer and judged by a
CTO and a CEO reviewer; this version takes their findings in. Section 13 lists what
the review changed, section 14 what only Ambrus can decide. A first part of sections
3, 4 and 8 is built in `registry/`, whose README says what is there and what is not.

**The order of work, the decisions and the criteria are consolidated in `PLAN.md`.**
Where section 12 here and `PLAN.md` section 6 differ, `PLAN.md` holds.

## 1. What it must do

| | Requirement |
|---|---|
| R1 | A student's program, run by someone who is logged in somewhere, cannot use that person's cookies or credentials. |
| R2 | A static site (GitHub Pages) uses it by adding an npm dependency, deploying nothing else. |
| R3 | Anyone can self-host everything, for only the languages they need. |
| R4 | Self-hosted packs can be added beside an existing setup: no PR to Yukibana, no switch to fully self-hosted. |
| R5 | Pack creators distribute a pack without being responsible for serving it (a release archive on any file host). |
| R6 | A server only ever serves packs its operator chose. Nothing is fetched because a client asked. |
| R7 | The official registry, `https://yukibana.run`, has the same architecture as any other registry. |
| R8 | A page can use several registries at once, also when they hold the same packs. |
| R9 | A pack that is only released, or sits on a registry one does not trust to stay up, can be copied into one's own registry. |

## 2. The idea in five sentences

A **registry** is one web origin that serves two things as static files: a small
**runner frame**, and **pack builds** stored under the hash of their contents. Pages
embed the frame from another site, so every compiler, language server and student
program runs on the registry's origin, which holds no logins. A **language package**
on npm pins the exact pack build it works with by that hash, so any registry holding
the hash can serve it, and a page lists the registries it accepts in order of
preference. Registries are filled by a command-line tool that copies builds from a
release archive, from another registry or from a local file, checking the hash, so the
source needs neither trust nor uptime. `yukibana.run` is such a registry, built and
checked by the same tool.

## 3. Pack identity

3.1. **A pack build is identified by a digest, not by a name or a place.** The digest is
the SHA-256 of the build's `pack.json`, taken over the file's bytes exactly as
released. Tools never re-serialise that file; they compare bytes.

3.2. `pack.json` is small (a page fetches it to ask "do you have this build?"):

```json
{
  "format": 1,
  "id": "cpp", "name": "C++", "version": "3.2.0",
  "protocol": 1,
  "requires": { "…": "today's Requires, per worker kind" },
  "uses": { "linux": { "digest": "sha256-…", "optional": false },
            "lldb":  { "digest": "sha256-…", "optional": true },
            "cpp-compilers": { "digest": "sha256-…", "optional": false } },
  "files": { "sha256": "…", "count": 412, "bytes": 23891234 }
}
```

`files` is the hash of `files.json`, the table `path → { sha256, size }` of every file
of the build. So one digest fixes every byte.

3.3. **Rules for paths in `files.json`**, enforced by the tool on every add: relative,
`/`-separated, NFC, a conservative character set, unique ignoring case, no trailing dot
or space; no entry named `pack.json` or `files.json`; and never both `X` and `X.br` or
`X.gz` (see 4.4).

3.4. In URLs and directory names a digest is written `sha256-<hex>` (a colon is not a
legal file name on Windows).

3.5. **Names are labels.** Nothing resolves by name at run time, so two registries
holding different things under one name cannot confuse a page. Same digest on two
registries means the same bytes; same name and version with different digests are
different builds and are never substituted.

3.6. **Big toolchains are their own pack builds, reached through `uses`.** A glue edit
to `cpp/runner.js` then changes only the small `cpp` build; the compilers
(`cpp-compilers`, hundreds of MB) keep their digest, their URL and every browser's
cached copy. This follows the split the repository already has
(`packs/cpp/toolchains/{compilers,emsdk,libs,musl,tidy}`, `packs/rust/toolchains/…`).
Without it, a one-line fix would make every visitor download the whole pack again,
the mistake `offline-cache.ts` records having made once.

3.7. **How a running pack finds the packs it uses.** Today glue reaches siblings by
name (`new URL('../linux/vm.js', import.meta.url)` in `packs/cpp/src/runner-linux.js`,
`../lldb/runtime.js`, `../linux/` in the go, rust, swift and zig runners), which a
digest layout breaks. A helper in the packs' shared kit replaces those lines:
`await uses('linux')` reads the pack's own `pack.json` beside it and returns
`../sha256-…/`. In the development layout (no `pack.json`, packs by name) it returns
`../linux/` as today. This is a change to `packs/CONTRACT.md` and a glue rebuild of
the packs that use others.

3.8. A **pack reference** is what a language package carries, in its `package.json`,
as data a tool can read without running code:

```json
"yukibana": { "packs": [ { "name": "@alice/prolog", "version": "1.2.0",
  "digest": "sha256-9f2c…", "protocol": 1,
  "sources": ["https://example.org/releases/prolog-1.2.0.pack.tar.zst"] } ] }
```

`sources` are places an operator's tool may fetch the archive from. Browsers and
registries never fetch them. The `uses` closure is read from the `pack.json` files
themselves, never from the reference. Digests are stamped into the published
`package.json` by the release job (10.1); they are not kept in git.

## 4. A registry

4.1. **Layout** (all static files):

```
/frame/v1/frame.html           the runner frame for frame-protocol 1   (no-cache)
/frame/v1/assets/<hash>.js     its scripts                             (immutable)
/packs/sha256-<hex>/pack.json  written last when a build is added      (immutable)
/packs/sha256-<hex>/files.json
/packs/sha256-<hex>/<file…>    with .br siblings the tool made         (immutable)
/index.json                    what the registry holds, deprecations and withdrawals (no-cache)
```

4.2. **Symmetry (R7) means: the same layout, the same header contract, proven by the
same checker.** It cannot honestly mean "the same web server": on Cloudflare,
`yukibana.run` needs a Worker for compressed variants and for files over 25 MiB, as
Light's deploy has today. So the contract is the URLs and headers below, and
`registry check` (8.4) is run against `yukibana.run` after every deploy and against a
Caddy container in CI on every release. A registry that passes the check is a registry.

4.3. **Header contract.**

| Where | Headers | Why |
|---|---|---|
| `frame.html` | `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: cross-origin`, `Content-Security-Policy:` the value of `CONTENT_SECURITY_POLICY` in `registry/rules.mjs` (scripts from the origin, `blob:` and `data:`, with evaluation, which WebAssembly and the interpreters need; connections to the origin only) and `frame-ancestors <policy>`, `Referrer-Policy: no-referrer`, `Cache-Control: no-cache` | Embeddable by an isolated page; a fix to the frame reaches every browser at once |
| every `/packs/` response | `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: same-origin`, the same `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Cache-Control: immutable` | Workers started by URL take their policy from their own response |
| `pack.json`, `files.json`, `index.json` | additionally `Access-Control-Allow-Origin: *` (also on 404s) | The page probes them; a 404 must be readable as "absent", not as "unreachable" |
| content types under `/packs/` | only `.js`/`.mjs`, `.wasm`, `.json` get their type; everything else is `application/octet-stream` | A pack cannot put an HTML or SVG document on the registry's origin |
| every response | never `Set-Cookie`; a request carrying `Service-Worker: script` is refused | No credential, and no service worker, ever exists on the origin where programs run |

4.4. **Compressed variants are derived, never imported.** The tool makes `X.br` from the
verified bytes of `X`; it does not copy a `.br` from a source. `check` fetches files
under br, gzip and identity and hashes the decoded bytes. (Otherwise a source could
serve a clean `runner.js` and a different `runner.js.br`, and every browser would get
the second.)

4.5. **`connect-src 'self'` is the default, and it matters.** A student's program can
otherwise send requests from the victim's browser and network position (with
`SameSite=None` cookies of third-party sites, to intranet hosts, to `localhost`) and
post out whatever it can read in its run, hidden tests included. The official packs
work offline by design, so the default costs nothing. An operator who wants programs
to reach the network loosens it in their registry, knowingly.

4.6. **A registry lives on a registrable domain of its own that hosts nothing else.**
Not a subdomain of a site with logins: `run.myuni.edu` beside `moodle.myuni.edu` is
same-site, and the repository's own measurement
(`prototypes/runner-isolation/b/README.md`) shows the session cookie then rides along
on a no-cors POST. The library refuses a registry that is same-site with the page
(loopback excepted, for development), and `registry check --embedder <url>` fails on
it. `yukibana.run` is a different registrable domain from `yukibana.dev`.

4.7. **Embedding policy** is the operator's `frame-ancestors`: any site by default, a
list for a registry meant for one institution. That restricts who may run things
there, not who may read: registries are public files, with no authentication, ever.

## 5. The runner frame

5.1. The frame is the far half of the runtime's transport. It starts workers **only**
from `/packs/sha256-…/` of its own origin and **relays** their messages to the page
over a `MessagePort`, batching what a worker posts within one task into one delivery
(a `MessageChannel` tick; the frame's thread is never blocked, so nothing is held
back). It creates each run's stdin `SharedArrayBuffer` itself and takes input lines by
value. It pairs a debugger worker with a runner inside the frame, since LLDB's channel
buffer cannot leave it. On load it deletes the origin's caches, databases and OPFS.

5.2. So the frame **does** know the runner messages of `@yukibana/protocol` (it must
recognise a run to attach a buffer, and a debug channel to wire it). It knows nothing
of languages or LSP: a language server's messages pass through untouched.

5.3. **Why relay and not a direct port to the worker.** The first benchmark's
"direct port with batching inside the worker" has a real defect found in review: a
program that prints a prompt, asks for input and blocks never yields, so its batch is
never sent and the page never sees the request. It also reversed two settled rules
(batching is the transport's, D33; the contract has no batch message). The benchmark's
own numbers give the whole speed-up to batching, none to the direct port. Relay with
frame-side batching is the design; its throughput is to be measured before building
(spike S2, section 12).

5.4. The frame protocol is versioned by its URL (`/frame/v1/`) and carries a handshake:
the frame's build, whether it is cross-origin isolated, and what it supports. A
registry may serve several majors side by side.

5.5. The iframe is created by the library with `sandbox="allow-scripts
allow-same-origin"`, `allow="cross-origin-isolated"`, `referrerpolicy="no-referrer"`.
The frame does nothing when it is the top-level document, and accepts messages only
from its parent.

5.6. One frame per registry origin in use on a page, made on first use. Language
servers, runners, explorers, the preview builder and debuggers all start through it;
today five places create workers outside any transport seam and must be rerouted
(section 11).

## 6. Who is trusted with what

6.1. **Listing a registry gives its operator, and every pack on it:**

- everything sent to a run: the source code, stdin, test files including hidden ones;
- the visitor's IP address, the fact and time of use (every listed registry is
  probed, chosen or not);
- the content of results: output, test verdicts, diagnostics, completions, and edits
  the language server asks the editor to apply;
- the visitor's CPU.

It does **not** give them the page, its cookies or its storage. That holds while the
page-side code that renders frame data (hover text, terminal links, previews) has no
bug, which is why that code is reviewed as a security boundary.

6.2. **Order in `registries` is preference, not a ranking of trust.** Every listed
registry is fully trusted in the sense of 6.1.

6.3. **A result computed in a browser is never authoritative.** A student's program
runs in the runner's own realm and can post its own "all tests passed". Grades need a
run the grader controls.

6.4. **The digest is not a defence against a registry you listed** (it serves the frame
code and could do anything on its origin). It is what makes honest registries
interchangeable, what makes copying from any source safe, and what makes URLs
immutable.

6.5. **A language package is npm code with the page's full rights**, more trusted than
any registry. Its digest pin is the supply-chain anchor. Official language packages
are published only under the `@yukibana` scope and through `yukibana`.

6.6. **Residual risk, stated:** where a browser keeps a cross-site frame in the page's
process, a program with `SharedArrayBuffer` shares a process with the logged-in page.
Which browsers do that, and what `allow="cross-origin-isolated"` yields in Firefox and
Safari, is unverified (spike S1). A site that holds logins keeps tokens in `HttpOnly`
cookies and out of script.

6.7. **Previews** (student HTML) stay in a sandboxed opaque-origin frame in the page,
as today. R1 holds there without the registry: an opaque origin has no cookies, no
storage and no way into the page around it, and a separate domain would add nothing
for cookies. (Whether a sandboxed frame also gets a process of its own, the caveat of
6.6, depends on the browser and is unverified for the preview.) What no origin
boundary prevents is a page that *looks* like the site: a
submission can draw a login form in a rectangle that has no address bar. The answer is
for the person, not the browser: **the preview always carries a visible "User content"
label**, drawn by the host outside the frame, so the page inside cannot remove or
cover it. Previews keep their network access (a student's page may load images and
call APIs); so the label, not a network block, is the whole measure, and removing
`allow-forms` would not help (a script can read a text box and send it without a
form).

## 7. Using several registries

7.1. Configuration is a build-time value, never read from a URL or from storage:

```ts
createPlayground({ …, registries: ['https://yukibana-myuni.example', 'https://yukibana.run'] })
```

Default: `['https://yukibana.run']`.

7.2. **Resolving a language.** Its pack and the packs it requires through `uses` must
come from one origin (they start each other's workers). For each listed registry, in
parallel: fetch `pack.json` of each needed digest (small, immutable), check that its
SHA-256 is the digest, and load the frame and complete its handshake. The first
registry **in list order** for which all of that succeeded within a timeout is used. An
optional `uses` (lldb) that is absent only disables its feature.

7.3. **A registry that passes and then fails to start a worker** (a half-copied build,
a blocked frame) is marked bad for that build for the session and the next one is
tried, as long as no program has run yet. After that, a failure is reported and a
reload resolves again.

7.4. Results are remembered in memory for the page's life (modules use no
`localStorage`). `onResolve` tells the host which registry served what, and the
library warns when a preferred registry lacked a build and a later one was used, so a
campus registry that was not updated after an upgrade is noticed.

7.5. **Failure names the fix:** "No listed registry has `@alice/prolog` 1.2.0
(sha256-9f2c…). Tried: … . Add it to a registry you run:
`yukibana-registry add ./registry yukibana-lang-prolog`."

7.6. Two languages may resolve to two registries: two frames, and the runner pool
keys runners by origin and digest, not by name.

7.7. `index.json` can mark a build **deprecated** (a warning, with the digest that
replaces it) or **withdrawn** (a named error: "this build was withdrawn on … because
…"). Nothing is ever silently replaced.

## 8. Filling a registry

8.1. One tool, `yukibana-registry`, **a package of its own** (it needs Node, which no
module may; and a registry serving several sites must not be rewritten by whichever
site's library version ran last). The layout's `format` number gates writes: an older
tool refuses a newer registry.

```sh
yukibana-registry init  ./registry
yukibana-registry add   ./registry --project ./course-a --as course-a   # what that site's installed language packages pin
yukibana-registry add   ./registry cpp python --yukibana 1.4.2 --as base # official packs of a library version, read from npm metadata
yukibana-registry add   ./registry ./prolog-1.2.0.pack.tar.zst --as prolog
yukibana-registry add   ./registry sha256-9f2c… --from https://other-registry.example --as prolog
yukibana-registry gc    ./registry                                      # removes builds no root has named for 30 days
yukibana-registry check https://yukibana-myuni.example --project ./course-a --embedder https://course.myuni.edu
yukibana-registry serve ./registry                                      # local, on 127.0.0.1: a different site from localhost, so development is really cross-site
```

8.2. **Roots.** `registry.json` records named roots (`course-a`, `base`), each a set of
builds with where they came from. Garbage collection deletes only what no root names
and has not been named for a grace period. Two course sites on different library
versions share one registry without deleting each other's builds.

8.3. **Adding is safe from any source** (R9). The archive's first entry is `pack.json`;
the tool hashes it before reading further and stops unless it is the wanted digest.
It then accepts only regular files listed in `files.json`, each up to its listed size,
checks each hash, makes the `.br` variants, and writes `pack.json` last (a build is
visible only when whole). It follows `uses` and adds those builds too, from the same
source or from the references' sources. It fetches over HTTPS only, never to private
addresses, never installs npm packages or runs their scripts, and reads references
only from a project's direct dependencies. Identical files across builds are stored
once (hard links).

8.4. **`check`** is what makes a self-hosted registry dependable, in three depths:
headers and a sample (seconds), one build, everything. It verifies the header contract
of 4.3 on real responses including 404s, the content types, that a `Service-Worker`
request is refused, that no cookie is set (also by a proxy in front), compressed
variants decode to the hashed bytes, each root's closure is complete, the frame's
build, and the site rule of 4.6.

8.5. The tool emits one tested **Caddy** configuration (Caddy serves precompressed
files and conditional rules without extra modules; stock nginx has no static brotli).

8.6. **Pack creators (R5).** The format is: a `.pack.tar.zst` whose first entry is
`pack.json`. `yukibana-registry pack ./build-dir` makes it and prints the digest and
the reference. The creator uploads the archive to any file host and publishes the
language package. Whoever wants the pack adds it to a registry they run with one
command; nobody serves it on demand.

8.7. **The gap that remains, stated:** a site on GitHub Pages can use a third-party
pack only if a registry it lists carries it, and GitHub Pages cannot be a registry (no
headers). That is accepted, and decided (section 15): a language author who wants a
playground of their own hosts everything (their site with their language package, and
a registry), or brings the language to Yukibana by pull request, after which
`yukibana.run` and Light carry it like any official one. There is no community
registry.

## 9. Third-party language packages

- `@yukibana/core` and `@yukibana/std` are **peer dependencies** of every language
  package, and lockstep packages name each other by exact version: tokens are
  identities, so a second copy of `std` would make a package's providers invisible.
  The library detects a duplicate instance and says so.
- A pack may `use` only builds its creator publishes, in the first version. The
  interfaces between packs (`linux/vm.js`, `lldb/runtime.js`) have never been
  versioned; they become a contract before others may build on them.
- Pack ids accept a scope (`@alice/prolog`); `PACK_ID` in `runtime/packs.ts` does not
  today.

## 10. Releases and retention

10.1. **One order, enforced by the release job:** build packs → write archives to an
immutable release → add them to `yukibana.run` → `check` it against the references →
publish npm (`yukibana` last, its `package.json` stamped with the digests). A page can
never install a version whose packs are not being served.

10.2. **A released build is never rebuilt.** Archives are the source of truth and are
kept; nothing claims the compilers build reproducibly, and the pack store today is
keyed by input tree and keeps 8 builds. Rebuilding would change digests.

10.3. **Retention:** `yukibana.run` does not delete a build that a tagged stable
release pins; with toolchains split out, a release adds megabytes, not gigabytes.
The exception is withdrawal for a security or legal reason, announced in `index.json`
(7.7). No number of months is promised, and until outside users exist everything is
published as `0.x`: the layout, the frame protocol and the pack format may still
change.

10.4. **Development** keeps today's by-name layout and in-page transport as a named
path (`registries: [{ dev: 'http://127.0.0.1:5199' }]` with builds found by name), so
an unreleased pack and an unreleased library can be worked on together.

## 11. What changes in the code

| Area | Change |
|---|---|
| `runtime/packs.ts` | `PackLocator.registry` over `/packs/sha256-…/`; `pack.json` read and verified; scoped ids. `pinned` (whose host chose the build) is superseded: the page's package chooses. |
| `runtime/transport.ts`, `run-pool.ts` | Framed transport and a remote `ServerEndpoint`; an async `connect` (today `context`, `stdin` and `url()` are synchronous, and a resolved registry knows none of them before its handshake); pool keyed by origin and digest. Supersedes H9's "in-page for hosts without credentials" as the default. |
| Workers made outside a seam | `playground/index.ts`, `app/…/workspace.svelte.ts:1431` (LSP), `lang-javascript/preview-session.ts:70`, `app/…/debug.svelte.ts:131`, `std/explore-workers.ts`, and the page-side fetches and HEAD probes of pack files |
| `packs/` | `uses()` helper; toolchains as builds of their own; a real `pack.json` with per-pack `Requires` (today two hard-coded constants stand in for all of them); `CONTRACT.md` amended |
| New packages | `yukibana` (front package), `yukibana-registry` (tool), the frame |
| Examples | the hosted registry by default; `servePacks` goes; one example on GitHub Pages |
| Cloud | embeds the registry frame |
| Previews, in every host | a "User content" label drawn by the host outside the frame (6.7); network access unchanged |
| Layout view (ABI explorer) | a track of its own beside these phases (section 16): one request in the C++ pack's language server, one method on the language session, a lazy page module; off unless turned on |
| **Light's app** | **unchanged in the first version.** It holds no credentials, ships an offline PWA whose verified cache depends on packs being same-origin, and deploys from every push with unreleased packs. It stays in-page; R1 for Light itself is met by moving it off `yukibana.dev` (which `CLAUDE.md` already anticipates), not by the frame. |

Tests follow the repository's rule of negatives: the credential table of
`prototypes/runner-isolation/b/measure.mjs` as a CI test on two sites; a registry
missing a file, serving a wrong `.br`, same-site with the page, setting a cookie;
resolution over overlap, a dead registry, a split closure; digest test vectors that
give the same result on Linux and Windows.

## 12. Order of work

**Spikes first (days), because three assumptions are unverified:**

- S1. In Firefox and real Safari: is a cross-site frame with
  `allow="cross-origin-isolated"` isolated, and is it in a process of its own? If
  Safari says no, framed mode has no stdin and no clangd there.
- S2. Benchmark relay with frame-side batching, and stdin through the frame.
- S3. `Document-Isolation-Policy` on `frame.html` (Chromium): if the frame can be
  isolated without the embedding page's headers, GitHub Pages and pages inside an LMS
  get stdin and threads with no service worker.

| Phase | Ships | Serves |
|---|---|---|
| P1 | Framed transport (relay) and remote worker, over today's layout on a second site; cloud embeds it | R1 |
| P2 | `pack.json`/`files.json`, digest layout, `uses()`, toolchains split, `yukibana-registry add/check/pack/serve`, `yukibana.run` | R3, R6, R7, R9 |
| P3 | npm `0.x`: `yukibana` and `@yukibana/*`; examples on the hosted registry; the isolation answer for GitHub Pages from S3 | R2 |
| P4 | Several registries, `add --from`, roots and `gc`, deprecation and withdrawal | R4, R8 |
| P5 | Third-party language packages (section 9), on the first outside request | R5 |

Decided against (section 15): a community registry, languages loaded at run time.
Deferred until someone asks: a container image, an nginx
configuration, offline packs through a registry-side service worker, hash checks in
the browser, moving Light's app onto the frame.

Beside these phases runs a second track that needs none of them: the layout view
(section 16). Its first step, making the editor parse the way Run compiles, is a
correctness fix that can be done now.

## 13. What the review changed

| Found by | Problem in v1 | Now |
|---|---|---|
| Operations, CTO | Packs reach each other by `../linux/`; a digest layout 404s | `uses()` helper reading the pack's own `pack.json` (3.7) |
| Security, CTO | Batching inside the worker deadlocks on blocking stdin; debug buffer cannot cross | Relay frame with frame-side batching; the frame owns stdin and debug wiring (5) |
| Operations, CTO | Per-pack URLs re-store and re-download gigabytes on any glue edit | Toolchains are builds of their own; files stored once (3.6, 8.3) |
| Operations | Release order let npm point at packs not yet served; digests had no home in git | Fixed order, digests stamped at publish, released builds never rebuilt (10) |
| Security | "A subdomain suffices" breaks R1 for a university | A registrable domain of its own; the library refuses same-site (4.6) |
| Security | A `.br` outside the digest could differ from the hashed file | Variants derived by the tool, checked decoded (4.4) |
| Security | Programs could make credentialed requests anywhere and post out hidden tests | `connect-src 'self'` by default (4.5) |
| Security | A pack could serve HTML on the registry's origin | Content-type allowlist, `nosniff`, pack files `same-origin` (4.3) |
| Security, operations | "Has the manifest" was taken for "works"; no failover | Digest checked by the page, frame handshake, failover before the first run, `pack.json` written last (7.2, 7.3) |
| Security, CTO | `immutable` frame could never be patched | `frame.html` no-cache, hashed assets (4.1) |
| Security | Trust statement incomplete | Rewritten as a list (6) |
| Operations | Shared registries: one site's prune deletes another's builds; tool tied to a library version | Standalone tool, roots, grace-period `gc` (8.1, 8.2) |
| CTO, operations | "Static folder and nothing else" is false for `yukibana.run` on Cloudflare | Symmetry is layout plus header contract plus one checker (4.2) |
| CTO, operations | Light's app cannot move without losing offline and continuous deploy | Light stays in-page in the first version (11) |
| Security (corrected by Ambrus) | The review asked to strip forms and network from previews and called it part of R1 | Cookies were already safe in the opaque frame; the remaining risk is a look-alike page, answered by a "User content" label; previews keep the network (6.7) |
| CEO | 24-month promise and "stable" contracts without users | `0.x`, no promised months, withdrawal path (10.3) |
| CEO, CTO | Ecosystem features before any adopter | Phased; third-party tooling last and on request (12) |

## 14. Decisions only Ambrus can make

1. **A licence for Yukibana's own code.** The repository has none, so nobody may
   legally mirror the frame, the glue or the tool today. This blocks every public step.
2. **Source for the GPL parts** (Linux, QEMU, qboot, php-wasm; OpenJDK and GraalVM
   under the Classpath exception): the packs point at upstream URLs. Serving the source
   bundles beside the binaries, and saying what a mirror owes, needs a decision and
   probably a lawyer's look.
3. **The public word.** "Registry" already means the cloud (its README, the CLI's
   `--url <registry>`) and means npm to every developer, and it says "storage" where a
   security reader needs "code runs here". The CEO review suggests "sandbox". This
   document keeps "registry" as you chose it; the option name `registries:` freezes it.
4. **Where `yukibana.run` is served** (decided: Cloudflare, `PLAN.md` 3.1)**:** Cloudflare (free egress, already operated, a
   Worker in front) or Caddy on a server (exactly what self-hosters run). Either passes
   the same check.
5. **Whether Light's app moves to a domain of its own**, and when.
6. **`connect-src 'self'` as the default on `yukibana.run`**: programs on the official
   registry then cannot reach the network at all.
7. **Preview or 1.0**, and which languages are "supported" as opposed to experimental.
8. **A spending ceiling for `yukibana.run`** and what happens at it. The Workers free
   plan stops at 100,000 requests a day, roughly 2,000 first loads.
9. **Who else holds the keys:** npm, the domains (a lapsed `yukibana.run` hands every
   static site that never updates to its next owner), GitHub, the CDN account.
10. ~~Whether a community registry is ever yours to run.~~ Decided: no (section 15).
11. **Privacy statement and the legal entity behind it**, which EU universities will
    ask for before embedding a third party's frame.

## 15. Decided against for now: languages loaded at run time

**Decision (Ambrus, 2026-11-14).** Light and `yukibana.run` do not load third-party
languages at run time. A project on official Light uses the languages built into
Light. A language author who wants a playground hosts everything themselves (their own
site with their language package built in, and their own registry) or makes a pull
request to Yukibana. The registry list stays a build-time value of the host (7.1), and
a language's page side stays an npm package.

What was considered: a declarative `language.json` inside the pack (name, entry,
extensions, which standard abilities, grammar as data), a registry named by a project
file, and a consent prompt. It fits the design, since simple languages are already
nearly data (`lang-python/index.ts` is 34 lines, `lang-go/index.ts` 27), but it adds a
public format, a consent flow and an adversarial rendering boundary, for no user who
has asked.

**Kept possible, at no cost.** These are properties the design has anyway or habits
that cost nothing; none adds a layer, a file, a byte to a bundle or a request:

1. **The registry list is an argument, not a constant.** The resolver takes the list
   when it is asked (modules already take configuration as values). "Build-time only"
   is the host's rule, kept in the host; a host that one day asks its user first
   changes nothing in the modules.
2. **A pack reference is plain data and does not say where it came from.** The
   resolver takes `{ digest, … }`; reading it from a `package.json` is the release
   tooling's business. A reference from a project file would be the same value.
3. **Readers of `pack.json` ignore fields they do not know.** The digest is over the
   file's bytes, so a later `language` field needs no new format number and breaks no
   existing reader or registry.
4. **Runners are keyed by origin and digest, and a transport belongs to a registry**
   (7.6). In-page for one registry and framed for another on the same page is already
   a consequence, which is what Light would need to keep its own packs in-page and
   frame someone else's.
5. **What comes back from a frame is treated as untrusted where it is rendered**
   (6.1): edits stay inside the project, links are web links, markup is sanitised.
   That is required for R1 today; it is also the boundary a stranger's registry
   would lean on.
6. **A language's definition stays a value where it can be one.** New fields in a
   language's spec or view table are data (`extensions: ['.py']`) unless behaviour is
   needed; nobody rewrites the existing ones for this.

What is deliberately **not** done: no `language.json`, no generic "declarative
provider" layer, no consent UI, no change to how the fourteen language packages are
written.

## 16. The layout view (ABI explorer) in this plan

**Decided (Ambrus, 2026-11-14).** Light gets a memory-layout view for C and C++, and
later Hylo: where each field of a struct lands, where the padding is. Everything is
computed in the language pack's worker, by the language server; nothing is taken from
the existing ABI Explorer's code. **It is a feature that is off and not shown unless
someone turns it on.** The design, with its diagrams, is at
https://claude.ai/artifact/6Xddv8TtyJTiSBfisdQqCi. Nothing is built, and that design
has not been through adversarial review in its current form.

16.1. **What it is, in this document's terms.**

- The C++ pack's language server answers one extra request, "the layouts of this
  document", from the parse it already holds: no second parse, no second compiler in
  memory, no extra download.
- A clang-tidy rule in the same pack gives the wasted-space warning and its "reorder
  members" fix. They reach the editor as ordinary diagnostics and quick fixes.
- The page side is one small module, `@yukibana/abi` (`yukibana/abi` in the front
  package): a controller, a view, and marks in the editor. The view and the editor
  talk only to the controller.

16.2. **What it adds to the contracts of this document: nothing.**

- *Frame protocol (5).* The request and its answer are language-server messages, which
  the frame relays untouched (5.2). No new message kind, nothing shared, nothing
  synchronous. It works the same with workers in the page (Light's app, today) and in
  a registry frame.
- *Registry layout and pack format (3, 4).* Unchanged. The request is an optional part
  of the C++ pack, named in `packs/CONTRACT.md` beside its other optional parts and
  announced in the server's capabilities, so a page offers the view only where the
  server has it.
- *Trust (6.1).* The answer is data from a frame and is rendered under the same rule:
  one checked entry point with stated limits, names drawn as text, colours assigned by
  the page and never sent by the server.

16.3. **Off unless turned on.**

| Piece | By default | Turned on by |
|---|---|---|
| The view | Not shown; none of its code is loaded | In Light's app, an entry in the View menu that opens a dock panel, remembered with the dock's layout. For an embedder, importing `yukibana/abi` and mounting it |
| Marks in the editor | None | They exist only while the view is open |
| The layout request | Never sent | Sent only by an open view |
| The wasted-space warning and its fix | Off: the rule is not in Light's default set of clang-tidy rules | The project's `.clang-tidy`, through the rule editor that exists; the view offers a switch that edits it |
| Hover with size and offset | On | Not part of this feature: it is clangd's own hover |

What a user who never turns it on still carries: the request's code inside
`clangd.wasm` and the rule's inside `clangd-tidy.wasm` (bytes every C++ user downloads;
to be measured), and a few lines on the language session that check the capability.
Nothing else: no worker, no request, no decoration, and no page code, which keeps the
rule that Light's first load does not grow (N12).

16.4. **Order: a track of its own.** It needs none of the phases of section 12.

| Step | Ships | Notes |
|---|---|---|
| L0 | The editor parses the way Run compiles | Today the C++ pack's clangd parses for 64-bit Linux while programs run as 32-bit WebAssembly unless the project names a target (`packs/cpp/README.md`, "Execution target vs. editor target"). The pack's server script gives clangd the arguments Run uses, from the same function (`compileArgs`), and unpacks the WASI headers it already downloads. No compiler rebuild. A correctness fix on its own; it changes what the editor accepts on the default target |
| L1 | The layout request in clangd; `layouts(document)` on `LanguageSession`, beside `selectionRanges`, `calls` and `workspaceErrors`; the capability | Both of the pack's clangd builds come from one patch file: written once, built twice |
| L2 | `@yukibana/abi`: controller, view, Monaco marks; in Light's app a dock panel and its menu entry, hidden by default | Loaded when the view is first opened |
| L3 | The clang-tidy rule and its fix-it, off by default | In the pack's clang-tidy build |
| L4 | Hylo | When its language server runs in a browser and answers the same request |

16.5. **Where the two tracks touch.**

- *Pack rebuilds.* L1 and L3 change the C++ pack's clangd builds. Under 3.6 those are
  builds with digests of their own, so each change is one more download of that build
  for every C++ user. L1 and L3 should land in one rebuild, and in the same rebuild as
  the toolchain split of P2 if that is near.
- *P1's test list* gains one case: a custom request and its answer through the framed
  language-server endpoint. That covers this request and any later one.
- *P3.* `yukibana/abi` is one more subpath of the front package. The playground does
  not import it.
- *Tests, as negatives:* with the view closed no layout request is sent and no
  decoration exists; a malformed or oversized answer is refused visibly; on the
  default project the editor and Run agree on `sizeof(void*)`; a record that is
  invalid, incomplete or depends on a template parameter is skipped and the server
  stays up.

16.6. **Risks carried into this plan.** A fault in the layout code takes the language
server down, which is the price of the simplest design; the fallback is to answer the
same request from the pack's compiler-output worker, with no change in the page. The
view shows the project's Run target only. Hylo depends on a browser build of its
language server that does not exist yet.
