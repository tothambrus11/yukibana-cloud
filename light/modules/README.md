# Shared modules

The code that the app (`light/app`), the packs' glue (`light/packs/*`), the
runner frame and other hosts (a documentation site's playground, the course
platform) share, as three packages that point one way:

```text
app, embeds  ->  @yukibana/monaco  ->  @yukibana/runtime  ->  @yukibana/protocol
                                                                ^
                                          packs' glue, runner frame
```

| Module | Holds | May import |
|---|---|---|
| `protocol/` | types and pure codecs for what crosses a boundary: LSP connection, stdin buffer, runner messages, loading progress, a pack's requirements, the frame messages | itself |
| `runtime/` | workers, packs and sessions in a browser: workspace paths, pack locator, worker factories, runner transports, LSP, run and preview sessions | itself, protocol |
| `monaco/` | the host's Monaco fed from a session: conversions, features, models, opt-in services, theme | itself, runtime, protocol, and `import type` from `monaco-editor` |

Rules every module keeps, so that a host can import one without taking on
the app:

* **No side effects on import.** No services, listeners, `<html>`
  attributes, styles, `MonacoEnvironment` or service-worker registration; a
  host calls a function when it wants one. `tests/imports.test.mjs`
  imports every module with the page's objects as tripwires, and fails on
  any reach for one, any listener or timer, and any new global.
* **The host's Monaco is injected.** Nothing here bundles or configures an
  editor.
* **No app or framework.** No Svelte, dockview or `$app`, no
  `localStorage`, and no reading of `yukibana.json`: a project's
  configuration is the app's, and reaches a module as values.
* **Files load as they are.** Erasable TypeScript only (no `enum`,
  `namespace` or parameter properties), and a relative import names its
  `.ts` file, so Node's type stripping, Vite and esbuild load the source
  without a build step. Another module is imported by its relative path
  (`../protocol/index.ts`) or its name (`@yukibana/protocol`); the app has
  the names as `kit.alias`.

Each module is its own TypeScript project, so each is checked with only
the globals it may use: `protocol/tsconfig.json` with the language and
the few platform types every host has (`protocol/platform.d.ts`), and
`runtime/` and `monaco/` with the DOM; none sees Node's types. They share
`tsconfig.base.json`, and `npm run check` in `light/app` runs
`tsc -p ../modules/<name>` for each. `boundaries.test.mjs` fails on any
import or mention that breaks the table or the rules above, and on a
protocol project that would compile a source reaching for a page or Node
(`npm run test:unit` in `light/app` runs it). The modules' own tests are in `tests/`,
beside them rather than in them, since a test imports `node:test`; the same
`npm run test:unit` runs them, as does
`node --test "light/modules/**/*.test.mjs"` from the repository root.

## Packages

`@yukibana/protocol` and `@yukibana/runtime` are also packages a site
outside this repository installs (step MP1 of the architecture plan; the
Monaco integration follows once its feature API is settled, MP2). A host's
Node refuses to strip types inside `node_modules`, and Vite's SSR leaves
dependencies external, so the sources alone fail in a prerender such as
Astro's. `node build.mjs` (with `light/app` installed) therefore writes each
module's `dist/`: JavaScript and declarations with their maps, every import
of another module written as its package name, and every built file read
back so that an import a host could not follow fails the build.
`node build.mjs --pack <dir>` then makes the tarballs.

* **Exports.** `types` and `default` name `dist/`. A first condition,
  `@yukibana/source`, names the sources (`index.ts`): this repository's own
  hosts that link a module rather than install it (`examples/hylo`) set it
  in their Vite, TypeScript and Node, so they need no build. Nowhere else
  should: from `node_modules`, Node refuses it.
* **Versions.** Semver from 0.1.0, one version for both, released together:
  the runtime depends on `^<version>` of the protocol beside it, and the
  tag `light-modules-v<version>` publishes both tarballs as a GitHub release
  (`.github/workflows/light-modules.yml`), never the repository's latest.
  Until a registry is chosen, a host installs both tarballs by their release
  URLs; with the protocol's tarball installed beside it, npm never asks a
  registry for the runtime's dependency.
* **No side effects** (`sideEffects: false`), as the rules above promise, so
  a bundler drops what a host does not use.

`tests/package.test.mjs` installs the tarballs `build.mjs` makes into a
project of its own and loads them as a host would: in Node, in TypeScript
(resolving as Node and as a bundler) and in a Vite SSR build that Node then
runs.
