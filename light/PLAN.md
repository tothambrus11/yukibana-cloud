# Yukibana Light: the plan

Consolidated on 2026-11-14 from everything decided and proposed so far. This is the one
list of what is to be done, in order, with the decisions behind it and the criteria
each step is judged by. **Nothing in it is built unless a line says so.**

Where the detail lives:

| Document | What it holds | Standing |
|---|---|---|
| `REGISTRY-DESIGN.md` | Registries, pack identity, the runner frame, trust, the tool, and the layout view's place (section 16) | Proposal; reviewed by security, operations, CTO and CEO agents. Its order of work is replaced by section 6 here |
| ABI Explorer design page, https://claude.ai/artifact/6Xddv8TtyJTiSBfisdQqCi | The layout view: parts, channels, the answer's shape | Proposal; earlier versions reviewed, the current streamlined one not |
| `modules/DESIGN.md`, `modules/README.md` | The modules' settled design (steps 1 to 9, all built) and rules | Settled; section 5.3 here lists what this plan changes in it |
| `packs/CONTRACT.md`, `packs/cpp/README.md` | What a pack is; the C++ pack as built | Settled; this plan amends the contract in three places |
| `prototypes/runner-isolation/` | The measured case for a frame on another registrable domain | Evidence |
| `bench/sandbox/` | What a cross-site frame costs | Evidence, incomplete (two to three runs, Chrome only) |

## 1. What it is for

1. A student's program, run by someone who is logged in, cannot use that person's
   cookies or credentials.
2. A static site uses Light's engine by adding an npm dependency and deploying nothing.
3. Anyone can host everything themselves, for only the languages they need, and add
   their own packs beside an existing setup.
4. The official registry, `https://yukibana.run`, is built the same way as anyone
   else's, and a page can use several registries at once.
5. A memory-layout view for C and C++ (later Hylo), computed by the language server,
   off unless turned on.
6. Using the modules from a framework takes no hand-written lifecycle code.

## 2. How every step is judged

### 2.1 The criteria set in this work

| | Criterion | What passing looks like |
|---|---|---|
| C1 | **Pay for what you use.** | A feature that is off sends no request, starts no worker, draws nothing and loads no page code. A host carries only the modules it imports. A visitor downloads only the builds of the languages they use, and a change to one build re-downloads only that build. Light's first load stays within the existing gate (baseline + 1 %). |
| C2 | **No credentials near programs.** | The credential table of `prototypes/runner-isolation/b/measure.mjs` passes as a CI test on two sites: no session cookie sent, nothing readable. |
| C3 | **Nothing to deploy on the easy path.** | A page on GitHub Pages runs C++ after `npm install` and one call. |
| C4 | **Independence.** | Everything `yukibana.run` serves can be copied to one's own server from an archive that does not live on our servers, and checked by its hash. |
| C5 | **Operators choose what they serve.** | No server fetches or stores anything because a visitor's browser asked. |
| C6 | **Symmetry.** | `yukibana.run` and a self-hosted registry pass the same checker; the library has no code path for "official". |
| C7 | **The editor tells the truth.** | The language server parses with the arguments the program is compiled with, for every target. |
| C8 | **The simplest thing that works.** | No machinery for a user who has not asked. Keeping a future option open costs nothing: no layer, no file, no bundle bytes, no request. |
| C9 | **Optional features are off and hidden by default.** | Turning one on is one visible action; turning it off returns to C1. |
| C10 | **Views do not know editors.** | A view and an editor talk only through a controller, so either can be replaced. |
| C11 | **Examples are real users.** | Each example installs released versions and uses the hosted registry; CI also runs it against the commit's own packages and packs. |
| C12 | **Honest promises.** | Public packages are `0.x` until outside users exist; every document says what was not verified. |

### 2.2 The repository's own, still in force

From `modules/DESIGN.md` section 7 and the root `CLAUDE.md`:

- **Simplicity, Extensibility, Type-safety, Bundle, Efficiency, Flexibility,
  Maintainability, Generalizability**, each with its re-check in DESIGN.md's table.
- **Modules:** nothing happens on import; the host's Monaco is injected; no app and no
  framework; sources load as they are; a module imports only what its `package.json`
  names (`boundaries.test.mjs`).
- **Tests are negatives** and a test's name is a sentence about the product. What
  decides something is pure and in a library, tested as a table.
- **Every export says what it promises**; where a decision was a mistake once, the
  comment says so.

### 2.3 Budgets measured so far

| What | Number | Standing |
|---|---|---|
| A cross-site frame: the language server, test runs, memory | no visible difference from in-page; one more process | Chrome on Windows, two and a half rounds (`bench/sandbox/README.md`) |
| Program output through a frame, unbatched | about 3 times slower | same; gathered into batches it was no slower than in-page |
| The isolation prototype's own bar | run start and a 1000-line burst within 10 % of in-page | met in Chromium 141 |

## 3. Decisions taken

### 3.1 By Ambrus

| Decision | Consequence |
|---|---|
| Programs run only on a registrable domain of their own, holding no logins. The official one is `yukibana.run`. | The runner frame; `yukibana.dev` and the cloud become embedders |
| A registry serves only what its operator chose; nothing is fetched on a client's demand. | No on-demand proxy; packs are added with a tool |
| The official registry has the same architecture as any other. Several registries can be used at once, also with the same packs. A pack that is only released can be copied into one's own registry. | Content-addressed builds; ordered list of registries; mirroring from any source |
| One front package on npm, `yukibana`. Packs never go on npm. | Subpath exports over the lockstep `@yukibana/*` |
| Self-hosters run their own servers, not Cloudflare. They can be asked to use a separate domain. | One tested Caddy configuration; a checker |
| Examples look like real users: released versions, hosted registry. | `servePacks` leaves every example |
| No framework-specific packages for now. | The modules expose framework-free shapes (6, stage 3) |
| No languages loaded at run time; no community registry. A language author hosts everything themselves or makes a pull request. | `REGISTRY-DESIGN.md` section 15 |
| Previews carry a "User content" label; they keep their network access. | A label drawn by the host outside the frame |
| The layout view is computed in the language pack's worker, by the language server. Nothing is reused from the existing ABI Explorer. Warnings and fixes are native, not TypeScript. | One request in clangd; a clang-tidy rule |
| The layout view is toggleable and not shown by default. | The table in `REGISTRY-DESIGN.md` 16.3 |
| The language server must parse the way things are compiled. | Step 0.2 below |
| Publish, and refine the API as we go. | Every module goes out at `0.x`; nothing waits for an API to be called settled |
| `yukibana.run` is served by a Cloudflare Worker. The domain is registered at Spaceship. | Step 0.5 below |

### 3.2 In the proposals, awaiting approval

These came out of the reviews. They are the plan's assumptions until Ambrus says
otherwise.

| Decision | Why |
|---|---|
| The frame **relays** messages and batches on its own side. No direct port to the worker. | The benchmarked direct port with batching inside the worker deadlocks on a program that prompts and then blocks; the speed came from batching, not from the port |
| A build's identity is the hash of its `pack.json`; directories are `sha256-<hex>`. | Honest registries become interchangeable; copying needs no trust |
| Big toolchains are builds of their own, reached through `uses`. | A one-line glue fix must not make every visitor download the compiler again (C1) |
| A registry's domain hosts nothing else; the library refuses a registry that is same-site with the page. | The repository's own measurement: on a subdomain the session cookie rides along |
| Programs cannot reach the network by default (`connect-src 'self'`). | Otherwise a submission can post out hidden tests |
| The registry tool is a package of its own, with named roots and a grace period before deleting. | Several sites on different versions share one registry |
| Light's own app keeps its workers in the page in the first version. | It holds no logins, and would lose offline packs and deploy-on-every-push |
| Public contracts are `0.x`; no retention period is promised. | No outside user yet (C12) |
| A layout answer names the document version it came from; the page derives padding and assigns colours. | No flashing while typing; nothing from a registry reaches CSS |

## 4. Decisions still open

For Ambrus. The first two block every public step.

| | Decision | Recommendation |
|---|---|---|
| O1 | **A licence for Yukibana's own code.** The repository has none. | Decide before anything is published |
| O2 | **Source for the GPL parts** of packs (Linux, QEMU, qboot, php-wasm; OpenJDK and GraalVM under the Classpath exception). | Serve source bundles beside the binaries; have it looked at |
| O3 | **The public word.** "Registry" also means the cloud and npm. | Decide before `registries:` ships; "sandbox" was the reviewers' suggestion |
| O5 | **Programs on `yukibana.run` and the network.** | Blocked by default |
| O6 | **Which languages count as supported** in the preview, as opposed to experimental. | Four or five |
| O7 | **A spending ceiling for `yukibana.run`**, and what happens at it. | Set one before the first public link |
| O8 | **Who else holds the keys**: npm, the domains, GitHub, the CDN. | A second holder; long renewal for `yukibana.run` |
| O9 | **A privacy statement and the legal entity behind it.** | Before universities are approached |
| O10 | **Light's app on a domain of its own**, and when. | Not in this plan's first version |
| O11 | **Layout view: what drives it from the code.** | Caret, and the pointer while Ctrl or Cmd is held, as Light's assembly views do |
| O12 | **Layout view: where its page code lives.** | A shared module with a framework-free `mount`, which is the shape `modules/DESIGN.md` already names for shared views |

O1 is sharper than it looks: no module's `package.json` names a licence, so nothing
can go to npm, even at `0.x`, until one is chosen.

## 5. What constrains the design

### 5.1 The browser

- A page starts workers only from its own origin, and many packs start further
  workers from their own URL. So a pack and whatever starts it share an origin, and so
  do packs that use each other.
- Threads and blocking input need `SharedArrayBuffer`, which needs the top-level page
  to send two headers. No design removes that from the embedding page.
- Cookies follow sites, not origins. A subdomain is the same site.
- A shared buffer cannot cross from a page into a frame on another site, so input and
  debug buffers are made inside the frame.
- A browser's cache is kept per embedding site, so each site downloads a pack once
  for itself.

### 5.2 The code as it is

- Packs reach each other by relative path (`../linux/`, `../lldb/`).
- No pack ships a `pack.json`; what a pack needs of its host is two hard-coded
  constants.
- Five places create workers outside any transport seam.
- The pack store is keyed by its inputs and keeps eight builds; nothing shows that
  compilers build reproducibly.
- The C++ pack's clangd parses for 64-bit Linux while Run defaults to 32-bit
  WebAssembly.
- The pack ships clangd twice (with and without clang-tidy), built from one patch.
- Only `@yukibana/protocol` and `@yukibana/runtime` are released, as tarballs; nothing
  is on npm.

### 5.3 What this plan changes in the settled design

| In `modules/DESIGN.md` or the READMEs | Becomes |
|---|---|
| In-page workers for hosts without credentials (H9) | The frame is the default for every embedder; in-page stays for Light's app and development |
| The pinned locator, where the packs' host picks the build | The page's package picks the build, by hash |
| "No pack contract changes" | Three stated exceptions: `pack.json` and `uses()`; the layout request as an optional part; nothing else |
| An allowlist of embedding sites (M10) | The operator's `frame-ancestors`, open by default |
| Core, std and the language packages private until needed; Monaco held back until its API is settled | All published at `0.x`, the API refined as we go (decided) |

Unchanged and relied on: tokens and providers, `Slot`, one language session per
project and language (N7), lockstep versions (N11), the bundle gate (N12), batching as
the transport's job (D33), "cpp-layout is first-party clangd work".

### 5.4 Not verified by anyone

- Whether Firefox and Safari isolate a cross-site frame and give it a process of its
  own.
- The speed of a relay frame that batches, and blocking input through it.
- Whether `Document-Isolation-Policy` can isolate the frame without the embedding
  page's headers.
- That the pack's clangd accepts every flag Run passes, and takes a custom request.
- That a rule added to the pack's clang-tidy build shows its fix as a quick fix.
- The size of the layout code inside clangd.
- Anything about Hylo's language server in a browser.

## 6. The work, in order

Two tracks run side by side: **the platform** (stages 1 to 4) and **the layout view**
(L1 to L4). Stage 0 is shared and can start now. Each item names what proves it done.

### Stage 0: now, each independent

**State on 2026-11-14:**

- **0.1 is done.** `modules/playground/runs.ts` settles every run exactly once
  (eight table tests); `ready` no longer rejects unheard; `dispose` ends the runner
  pool, also one a run was about to make; the SvelteKit example passes its own check.
  Both C++ examples pass end to end in Chrome, with the two negatives that need a
  browser in `examples/cpp-library/test.mjs`: a missing pack is named and raises no
  error, and a playground disposed as a run starts leaves no worker. Those tests run
  where the pack is, not in CI. One correction to the first review: the playground
  does not leak compiler-view workers itself, since those are held by whoever asked
  for a view.
- **0.5 is done as far as it can be before stages 1 and 2.** `registry/` holds the
  Worker, its rules and their tests, and https://yukibana.run answers with the frame's
  greeting under the registry's headers, checked from outside. The checks that need a
  pack wait for stage 2. The check that a page on another site embeds the frame and is
  told whether it is isolated needs a browser and is still open; it is the first of
  0.3's checks. The staging copy at a workers.dev address is deleted. Left
  for Ambrus: steps 6 to 8 below.
- **0.2, 0.3 and 0.4 are not started.** 0.2 and 0.3 need a browser; 0.4 is Ambrus's.
- **Stage 2 has its first piece**, the part that needs no browser: `registry/format.mjs`
  (what `pack.json` and `files.json` say, a build's path rules, deterministic
  writing), `registry/build.mjs` and `registry/cli.mjs` (`init`, `stamp`, `verify`,
  `add`, on directories). `pack.json` keeps the fields the runtime already reads
  (`id`, `name`, `protocol`, `requires`) and adds `version`, `uses` and `files`; it has
  no `build` field, since a build's name is the hash of that file. All 14 installed
  packs describe without a problem. `registry/README.md` lists what is not there yet.
- **Stage 2's second piece** (2026-11-14): archives, the registry's own compressed
  copies, and the sync into the bucket, still without a browser. `yukibana-registry
  pack` writes a build as a `.pack.tar.zst` (`registry/tar.mjs`, `archive.mjs`), and
  `add` takes one, from any source, refusing it by its first file when it is not the
  wanted build and refusing any file before a byte is written when it is not listed at
  its size; archives GNU tar wrote are taken too. `add` makes each file's `.br` from the
  checked bytes, and `verify` decodes every copy. `sync` (`registry/s3.mjs`, `sync.mjs`)
  puts a directory registry into an S3 bucket, compressed copies in their files' place,
  each build's `pack.json` last; it is tested against a fake that checks signatures and
  against RustFS in CI, not yet against R2, and no workflow runs it: that needs an R2
  key pair as two secrets (0.5, step 8) and builds to sync.

| | What | Done when |
|---|---|---|
| 0.1 | **Repair the playground module** found in the first review: the SvelteKit example's `on:click` fails its own check; `ready` rejects with nobody listening; `dispose` leaves the runner pool and explorer workers running; a replaced or disposed run never settles and cannot be aborted. | The example's `pnpm run check` passes; negatives for each: a missing pack logs no unhandled rejection, a disposed playground has no worker, a replaced run resolves as cancelled |
| 0.2 | **The editor parses the way Run compiles** (L0). The C++ pack's server script gives clangd Run's arguments from the same function and unpacks the WASI headers it already downloads. | On the default project `static_assert(sizeof(void*) == 4)` gives no error; a `__linux__` block is inactive; for every target the editor's arguments equal Run's |
| 0.3 | **Three checks in real browsers**: frame isolation and process in Firefox and Safari; relay with batching and blocking input, in `bench/sandbox`; `Document-Isolation-Policy` on the frame. | Each has a yes or no, written into `REGISTRY-DESIGN.md` 5 and 6.6 |
| 0.4 | **O1 and O2 decided.** | A licence file; a statement of what a mirror owes |
| 0.5 | **`yukibana.run` answers**: the domain on Cloudflare, a Worker on it serving from a bucket under the registry's header rules. First the frame and nothing else; packs arrive with stages 1 and 2. | The checks at the end of the next subsection |

0.2 changes what the editor accepts on the default target: code using things
WebAssembly lacks gets errors while typing. It is the only item here users will notice.

#### 0.5 in detail: getting `yukibana.run` to answer

The code is in `registry/` (the Worker, its configuration, its tests and a deploy
script). Light's own deploy (`deploy/worker.js`, one Worker in front of static assets
and a bucket) is the model, with two differences: every file comes from the bucket,
because a Worker's static assets stop at 25 MiB a file and 20,000 files a version and
a registry holds every build at once; and the headers are the registry's
(`REGISTRY-DESIGN.md` 4.3), which differ by path.

**Only Ambrus can do these** (accounts and dashboards):

1. **Add the domain to Cloudflare.** Done: `yukibana.run` is a zone of the account
   that serves `light.yukibana.dev`.
2. **Point the domain at Cloudflare's nameservers** in Spaceship's domain manager.
   Done.
3. **Wait until Cloudflare shows the domain as active.** Done.
4. **Delete the imported DNS records.** Done: adding the zone had copied the
   registrar's parking address to `yukibana.run`, and Cloudflare refuses to give a
   Worker a custom domain over records it did not make. With them deleted, the Worker
   has the domain as a custom domain, which makes its own record.
5. **"Always Use HTTPS"** on for the zone. Done.
6. **At the registrar,** auto-renew, the transfer lock and two-factor sign-in stay on. A lapsed
   `yukibana.run` would hand every site that embeds it to the next owner (O8).
7. **Workers Paid plan** once a normal day uses about a third of the free plan, or
   before a link that could send a crowd at once. The free plan stops at 100,000
   requests a day for the whole account, this Worker runs on every request, and past
   the limit every site that embeds the registry stops loading until midnight UTC
   (O7).
8. **A token for deploying:** the existing `CLOUDFLARE_API_TOKEN` must also be allowed
   on the new domain (Workers scripts, Workers routes, R2). For uploading many files
   quickly, an R2 access key pair as two more secrets.

**In the repository:** `registry/README.md` says what was built (the Worker, its
header rules, the deploy script, the workflow) and what each promises.

**Done when**, from outside:

- `https://yukibana.run/frame/v1/frame.html` answers with the frame's headers and is
  not cached;
- a file under `/packs/` is immutable, same-origin, and a `.wasm` is
  `application/wasm` sent as brotli;
- a missing `pack.json` answers 404 readable from another site;
- a request carrying `Service-Worker: script` is refused, and no response sets a
  cookie;
- a page on another site embeds the frame, and the frame reports whether it is
  isolated (which is also the first of the browser checks in 0.3).

### Stage 1: the sandbox

Serves C2. Needs 0.3.

- The runner frame as a relay, and a remote language-server endpoint, over **today's
  pack layout** on a second site.
- An asynchronous `connect` in the runtime (today a transport's origin and input
  support are read before anything starts).
- The five places that create workers by hand go through the transport.
- The cloud embeds the frame. Previews get the "User content" label.

**Done when**, on two sites in Chromium and Firefox: a run reads two lines of input;
mutation testing runs (nested workers); clangd answers; a compiler view answers; a
custom request and its answer cross the framed endpoint; a missing worker is a named
error; the credential table passes.

### Stage 2: packs and the first registry

Serves C1, C4, C5, C6. Needs stage 1.

- `pack.json` and `files.json`; directories named by hash; the `uses()` helper;
  toolchains as builds of their own; each pack's real requirements written down.
- `yukibana-registry`: `add` (from an archive, a registry or a file), `check`,
  `pack`, `serve`. One tested Caddy configuration.
- `yukibana.run`, filled by that tool and checked by it after every deploy.
- The release order, enforced: build packs, archive them, add them to the registry,
  check, then publish npm.

**Done when:** the same build gets the same hash on Linux and Windows; `check` passes
against a Caddy container in CI and against `yukibana.run`; a registry missing a
file, serving a wrong compressed copy, setting a cookie or sitting on the page's own
site is refused; a glue-only change leaves every toolchain's hash unchanged.

*Batch with this stage:* the clangd rebuild of L1 and L3, so C++ users download the
changed language server once.

### Stage 3: the public preview

Serves C3, C11. Needs stage 2 and O1.

- **The playground without lifecycle code.** `definePlayground(options)` touches no
  DOM; `mount(element)` returns its clean-up, which is already a Svelte attachment and
  a React ref; state is a value to subscribe to; Monaco is passed as a loader.
  `createPlayground` stays as the two together.
- npm `0.x`: `yukibana` and `@yukibana/*`, each language package naming `core` and
  `std` as peers at exact versions.
- Examples install released versions and use the hosted registry. One example on
  GitHub Pages, with the answer from 0.3 for input and threads there.

**Done when:** the package test installs the published tarballs and runs a playground
against a registry on another port; publishing is refused unless every pinned build is
live; the SvelteKit example has no `onMount`; each example passes both as published
and against the commit.

### Stage 4: several registries

Serves the rest of goal 4.

- An ordered list of registries; a language's packs resolved to the first registry
  that has all of them and whose frame answers; fallback before the first run.
- `add --from` another registry; named roots; `gc`; deprecation and withdrawal in a
  registry's index.

**Done when:** overlap, a dead registry, a half-copied build and packs split across
registries each have a negative test; a fallback to a later registry is reported to
the host.

### The layout view (beside stages 1 to 4)

Serves goal 5 under C1, C7, C9, C10. Needs only 0.2.

| | What | Done when |
|---|---|---|
| L1 | The layout request in clangd; `layouts(document)` on the language session; the server announces it | A record that is invalid, incomplete or depends on a template parameter is skipped and the server stays up; a page offers the view only where the server has the request |
| L2 | The page module: controller, view, Monaco marks. In Light's app a dock panel and a View-menu entry, hidden by default | With the view closed no layout request is sent and no decoration exists; a malformed or oversized answer is refused visibly; Light's first load does not grow |
| L3 | The clang-tidy rule and its "reorder members" fix, off by default | Off: no warning. On, through the project's `.clang-tidy`: the warning and its quick fix appear in the editor with no page code |
| L4 | Hylo | When its language server runs in a browser and answers the same request |

If the layout code proves fragile inside clangd, the same request is answered from the
pack's compiler-output worker; the page does not change.

### Later, on a real request

- Third-party language packages (`REGISTRY-DESIGN.md` section 9).
- A container image; an nginx configuration.
- Offline packs through a verified service worker on the registry.
- Light's app on the frame, or on a domain of its own (O10).
- A layout request for Rust.

### What depends on what

```
0.1 playground repairs ─────────────────────────────┐
0.2 editor parses as Run ──► L1 ──► L2 ──► L3        │
0.3 browser checks ──► 1 sandbox ──► 2 packs + registry ──► 3 public preview ──► 4 several registries
0.5 yukibana.run answers ──►┘ (the second site of stage 1)
0.4 licence ───────────────────────────────────────►┘ (needed by 3)
                         L1 + L3 rebuild clangd together with stage 2
```

## 7. Not doing

- A Svelte or React component library.
- Languages loaded at run time, a `language.json`, a consent prompt.
- A community registry.
- A registry that fetches packs when a browser asks.
- A direct port from the page to a worker, or batching inside pack code.
- The existing ABI Explorer's engines, its TypeScript fixes, or a converter for its
  result type.
- A Vite plugin for serving packs: the hosted registry and `yukibana-registry serve`
  replace it.
- A promised number of months of retention; a "1.0".
- Hash checks in the browser in the first version.

## 8. Keeping this document true

When a stage lands, its row moves to "built" with the commit, and what was learnt goes
into the detail document it belongs to. A decision in section 4 that is taken moves to
section 3 with its date. A number in 2.3 or a line in 5.4 that is measured is replaced
by the measurement.
