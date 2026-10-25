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
| `runtime/` | workers, packs and sessions in a browser: pack locator, worker factories, runner transports, LSP, run and preview sessions | itself, protocol |
| `monaco/` | the host's Monaco fed from a session: conversions, features, models, opt-in services, theme | itself, runtime, protocol, and `import type` from `monaco-editor` |

Rules every module keeps, so that a host can import one without taking on
the app:

* **No side effects on import.** No services, listeners, `<html>`
  attributes, styles, `MonacoEnvironment` or service-worker registration; a
  host calls a function when it wants one.
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

`tsconfig.json` checks the three as one project (`npm run check` in
`light/app` runs `tsc -p ../modules`), and `boundaries.test.mjs` fails on any
import or mention that breaks the table or the rules above (`npm run
test:unit` in `light/app` runs it).
