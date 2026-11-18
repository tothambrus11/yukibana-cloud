# Registries: the rules, the tool, and https://yukibana.run

A registry is one web origin that serves the runner frame and the language packs, as
files, under fixed header rules (`../REGISTRY-DESIGN.md`). This directory holds
what every registry shares (the header rules, the format of a pack build, the tool
that fills a registry) and the official one: a Cloudflare Worker in front of one R2
bucket.

| File | What |
|---|---|
| `rules.mjs` | What a registry answers for a path: the kind of file, its key, its headers. Pure; the Worker asks it for every request, and a checker of someone else's registry can ask it what a response should have carried |
| `format.mjs` | A pack build as files: what its `pack.json` and `files.json` say, the rules for a build's paths, and the one way each is written. Pure |
| `build.mjs` | Builds on disk: describing a directory as a build, checking one against its name (its compressed copies decoded), writing one as an archive, adding one to a registry kept as a directory, from a directory or an archive, with the registry's own compressed copies |
| `tar.mjs` | The tar headers a pack archive is made of, written deterministically and read strictly. Pure |
| `archive.mjs` | Pack archives (`.pack.tar.zst`): writing one, and reading one as a stream that a registry can trust whoever made it |
| `s3.mjs` | The two S3 calls a sync needs (HEAD and PUT), signed with Signature Version 4, for R2 and any S3 server |
| `sync.mjs` | Putting a registry kept as a directory into the bucket the Worker serves from |
| `cli.mjs` | `yukibana-registry`: `init`, `stamp`, `verify`, `pack`, `add`, `sync` (below) |
| `worker.js` | The Worker: a path is a key in the bucket; one read answers a request |
| `site/` | What this repository itself puts on the registry: the runner frame (`frame/v1/`), so far only its greeting |
| `wrangler.jsonc` | The Worker `yukibana-run` with `yukibana.run` as its custom domain, over the bucket `yukibana-run`; no other address |
| `deploy.sh` | Uploads `site/` and deploys the Worker |
| `fake-s3.mjs` | For the tests: an S3 on 127.0.0.1 that checks signatures and payload hashes as R2 does |
| `*.test.mjs` | `node --test`: the rules, the format and tar headers as tables, the Worker over a bucket that is a Map, builds and archives in temporary directories (with archives GNU tar wrote, where `tar` has zstd), syncs to the fake S3 and, when `YUKIBANA_REGISTRY_TEST_BUCKET` names one, to a real one (RustFS in CI) |

## What it promises

- **It is only read.** `GET` and `HEAD`; anything else is refused before the bucket is
  touched.
- **No credential, ever.** No response sets a cookie and none is read.
- **No service worker.** A request to register one is refused, whatever the file.
- **No pack can put a document on the origin.** Under `/packs/` only `.js`, `.mjs`,
  `.wasm` and `.json` get their type; everything else is bytes.
- **Programs cannot reach another origin.** Every script it serves carries a policy
  whose `connect-src` is the registry itself (`CONTENT_SECURITY_POLICY` in
  `rules.mjs`, and why).
- **A build named by its hash never changes** and is cached for good; the frame page,
  the index and packs still served by name are revalidated every time.
- **A missing build can be told from a registry that is down**: the "not found" for
  what a page probes is readable from any site.

The Worker keeps no log (`observability` is off) until the registry has a privacy
statement that says what is kept (`../PLAN.md`, O9).

## State

- **`https://yukibana.run` answers**, since 2026-11-14, with the frame and the rules
  above. Checked from outside with the commands at the end of this file.
- **The frame is only its greeting.** Starting workers in it is stage 1 of
  `../PLAN.md`.
- **No packs** are in the bucket. The tool can make a build of a pack's directory,
  write it as an archive, add it to a registry on disk from either, and put such a
  registry into the bucket (below). Nothing runs that last step yet: it needs an R2
  key, and the frame that runs packs is stage 1.
- **There is no staging copy.** One ran at a workers.dev address until the domain was
  on Cloudflare and was deleted then: such an address shares its site with the
  account's other Workers, and a registry is on a site of its own. That copy was
  where a file stored brotli-compressed was checked: served as stored to a client
  that accepts brotli, decoded by the edge for one that does not.

## The domain

`yukibana.run` is registered at Spaceship and is a zone of the Cloudflare account
that serves `light.yukibana.dev`; its nameservers are Cloudflare's. The Worker has
the domain as a custom domain (`wrangler.jsonc`), which makes and keeps the zone's
one DNS record and the certificate. The zone redirects plain HTTP to HTTPS ("Always
Use HTTPS").

Adding the zone had imported the registrar's parking address as two A records
(54.149.79.189 and 34.216.117.25), and Cloudflare refuses a custom domain over
records it did not make: they were deleted by hand on 2026-11-14, as was the route
that served the domain meanwhile. A zone made afresh needs the same.

For CI, the repository's `CLOUDFLARE_API_TOKEN` must be allowed on this zone too
(Workers scripts and routes, R2); the workflow's deploy job has not run yet. What else
the domain's owner keeps an eye on (the plan's request limit, the registrar's locks)
is in `../PLAN.md`, step 0.5.

Deploying:

```sh
registry/deploy.sh            # runs the tests, uploads site/, deploys the Worker
```

## The tool

A **build** of a pack is a directory with a `pack.json` (what it is, what it uses,
and the hash of `files.json`) and a `files.json` (every other file's path, size and
hash). Its name is `sha256-` and the hash of its `pack.json`, so the name fixes every
byte. `format.mjs` says the rest.

```sh
node registry/cli.mjs init   ./my-registry
node registry/cli.mjs stamp  app/static/packs/java --meta java.meta.json   # writes pack.json and files.json, prints the name
node registry/cli.mjs verify app/static/packs/java sha256-…
node registry/cli.mjs pack   app/static/packs/java                         # java-<version>.pack.tar.zst, prints the name
node registry/cli.mjs add    ./my-registry java-1.0.0.pack.tar.zst sha256-…  # or the build's directory
AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… \
node registry/cli.mjs sync   ./my-registry https://<account>.r2.cloudflarestorage.com/yukibana-run
```

- `stamp` leaves out the `.br` and `.gz` copies a pack's build writes beside its
  files: a registry makes its own from the bytes it checked. All 14 installed packs
  describe without a problem (9 to 647 files; the largest, Rust, in 6 seconds).
- **An archive** is a zstd tar whose first file is `pack.json`, its second
  `files.json`, then the listed files and nothing else (REGISTRY-DESIGN.md 8.6). `pack`
  writes it at zstd level 15 (on that slice: 25%, 5 MiB a second; level 19 gives 23%
  at half the speed) and deterministically (mode 0644, owner and time 0, sorted, pax headers for
  paths over 100 bytes) after checking the build; GNU tar and bsdtar list and unpack
  it. `add` also takes one GNU tar wrote, in its own format or POSIX, from an explicit
  file list with `pack.json` first.
- **`add` is safe from any source.** From an archive, pack.json is hashed before
  anything else is read and the archive is refused unless it is the wanted build; a
  file is refused by its header, before a byte of it is written, unless it is listed,
  new, and of its listed size; links, devices and damaged or truncated archives are
  refused by what they are. From a directory, only the listed files are copied, none
  larger than listed. Either way the copy is checked whole and gets its name by one
  rename, and a failed add leaves the registry as it was. It says which builds the new
  one uses that the registry lacks.
- **The registry's own compressed copies.** `add` writes `<file>.br` (brotli quality
  11, a 16 MiB window) beside every file of at least a KiB, files.json included, whose
  copy saves at least a twentieth, skipping kinds that are compressed already (`.gz`,
  `.zst`, `.png`, …). `verify` decodes every `.br` and `.gz` beside a build and
  refuses one that is not its file's bytes, since a server sends the copy in the
  file's place (REGISTRY-DESIGN.md 4.4). Brotli at quality 11 runs at about half a MiB
  a second a core (a 16 MiB slice of the Node binary, to 22%): adding a toolchain of
  hundreds of MiB takes minutes on a CI runner, once.
- **`sync`** puts every build of a directory registry that the bucket lacks into it,
  over the S3 API: each build checked first, the builds it uses before it, its files
  (a file with a `.br` beside it as that copy, under the file's own key, with
  `Content-Encoding: br`, as the Worker expects), eight at once, and its `pack.json`
  last, so a build is in the bucket whole or not at all. The bucket checks each
  object's SHA-256. A build whose `pack.json` the bucket has is not put again, a sync
  stopped half-way puts the build again whole, and nothing is ever deleted. A failure
  that may pass (no answer, 429, 5xx) is tried four times. The key is
  `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (`AWS_REGION` defaults to R2's
  `auto`); it is sent only over HTTPS, or to this machine. One object is at most 5 GiB,
  R2's limit for a single upload; no pack has a file near it.
- The same files and description give the same name on every machine: a test pins
  one build's name, and runs on Windows here and on Linux in CI.

For CI to sync `yukibana.run`, its owner makes an R2 API token with "Object Read &
Write" on the bucket `yukibana-run` only (Cloudflare dashboard, R2, "Manage API
tokens") and stores its key pair as the secrets `R2_ACCESS_KEY_ID` and
`R2_SECRET_ACCESS_KEY` (PLAN.md 0.5, step 8; set on the repository on 2026-11-15). The
deploy job syncs an empty registry with them, which checks the key against the bucket
with one request; no workflow syncs builds yet, since none are stamped until the
packs' release does it.

Not yet: `add` from another registry or a URL, roots and `gc`, `check` of a served
registry, `serve` and its Caddy configuration, the index. No pack has its real
description written down yet (`id`, `requires`, `uses`), and the runtime does not read
builds by name yet (`modules/runtime/packs.ts` reads `pack.json` by pack id).

## Checking a deploy from outside

```sh
B=https://yukibana.run
curl -sI $B/frame/v1/frame.html                      # 200, CORP cross-origin, no-cache, frame-ancestors
curl -sI $B/packs/sha256-$(printf 'ab%.0s' {1..32})/pack.json   # 404 with Access-Control-Allow-Origin: *
curl -sI -H 'Service-Worker: script' $B/frame/v1/frame.js       # 403
curl -sI -X POST $B/frame/v1/frame.js                           # 405
```

No response may carry `Set-Cookie`.
