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
| `build.mjs` | Builds on disk: describing a directory as a build, checking one against its name, adding one to a registry kept as a directory |
| `cli.mjs` | `yukibana-registry`: `init`, `stamp`, `verify`, `add` (below) |
| `worker.js` | The Worker: a path is a key in the bucket; one read answers a request |
| `site/` | What this repository itself puts on the registry: the runner frame (`frame/v1/`), so far only its greeting |
| `wrangler.jsonc` | The Worker `yukibana-run` with `yukibana.run` as its custom domain, over the bucket `yukibana-run`; no other address |
| `deploy.sh` | Uploads `site/` and deploys the Worker |
| `*.test.mjs` | `node --test`: the rules and the format as tables, the Worker over a bucket that is a Map, builds in temporary directories |

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
- **No packs** are in the bucket. The tool can make a build of a pack's directory and
  add it to a registry on disk (below); putting such a registry's builds into the
  bucket, and the frame that runs them, are still to come.
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

## The tool, so far

A **build** of a pack is a directory with a `pack.json` (what it is, what it uses,
and the hash of `files.json`) and a `files.json` (every other file's path, size and
hash). Its name is `sha256-` and the hash of its `pack.json`, so the name fixes every
byte. `format.mjs` says the rest.

```sh
node registry/cli.mjs init   ./my-registry
node registry/cli.mjs stamp  app/static/packs/java --meta java.meta.json   # writes pack.json and files.json, prints the name
node registry/cli.mjs verify app/static/packs/java sha256-…
node registry/cli.mjs add    ./my-registry app/static/packs/java sha256-…
```

- `stamp` leaves out the `.br` and `.gz` copies a pack's build writes beside its
  files: a registry makes its own from the bytes it checked. All 14 installed packs
  describe without a problem (9 to 647 files; the largest, Rust, in 6 seconds).
- `add` copies only the listed files, none larger than listed, checks the copy whole,
  and gives the build its name by one rename. It says which builds the new one uses
  that the registry lacks.
- The same files and description give the same name on every machine: a test pins
  one build's name, and runs on Windows here and on Linux in CI.

Not yet: archives (`pack`, and `add` from an archive or another registry), the
registry's compressed copies, roots and `gc`, `check` of a served registry, `serve`,
the index, and what puts a directory registry into the R2 bucket. No pack has its
real description written down yet (`id`, `requires`, `uses`), and the runtime does not
read builds by name yet (`modules/runtime/packs.ts` reads `pack.json` by pack id).

## Checking a deploy from outside

```sh
B=https://yukibana.run
curl -sI $B/frame/v1/frame.html                      # 200, CORP cross-origin, no-cache, frame-ancestors
curl -sI $B/packs/sha256-$(printf 'ab%.0s' {1..32})/pack.json   # 404 with Access-Control-Allow-Origin: *
curl -sI -H 'Service-Worker: script' $B/frame/v1/frame.js       # 403
curl -sI -X POST $B/frame/v1/frame.js                           # 405
```

No response may carry `Set-Cookie`.
