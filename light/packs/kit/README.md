# Pack kit: code several packs' workers share

Not a pack: nothing here is served on its own, and there is no `build.sh`.
These are the JavaScript files that more than one pack's workers would
otherwise each keep a copy of. A pack imports them by relative path
(`../../kit/linux-worker.js` from its `src/`), and its own glue or build
bundles them with esbuild into the worker it ships, as it bundles its own
`src/`.

| File | What it is | Bundled by |
|---|---|---|
| `emit-filter.js` | The compiler output views' filters: LLVM assembly and IR, filtered as Compiler Explorer does, each line mapped to its source line. Pure functions of strings | cpp, rust, swift (`src/explorer.js`; swift's `src/views.js`) |
| `wasi-program.js` | Running a wasm32-wasip1 program with browser_wasi_shim: stdout and stderr posted as written, stdin from the contract's `SharedArrayBuffer` | go, rust (`src/runner.js`) |
| `linux-worker.js` | The worker that runs one static Linux program under the Linux pack's emulator (`../linux/vm.js`) | go, rust, swift, zig (each pack's `src/linux-worker.js` is a one-line import of it) |

## Rules

* **A pack that bundles the kit says so.** An unsplit pack's build is
  stored under the id `scripts/pack-store.sh tree` prints, which is its own
  tree id only while it bundles nothing from outside it. A pack that
  imports from here lists `kit` in its `shared` file, and its id then also
  covers this directory's tree, so an edit here rebuilds exactly the packs
  that bundle it. A split pack's glue is assembled on every run and stored
  under no id, so it needs no `shared` file. `../contract.test.mjs` fails
  on an import from here by an unsplit pack that does not name `kit`.
* **Packages come from the bundling pack.** A file here that imports a
  package by name (`@bjorn3/browser_wasi_shim`) gets it from the pack that
  bundles it: each pack's esbuild runs with `NODE_PATH` set to the pack's own
  `node_modules`, and the pack declares the package in its `package.json`.
  The kit has no `package.json` and no `node_modules` of its own.
* **The kit imports from no pack**, so a change to one pack never changes
  another through here. `../contract.test.mjs` checks that too.
* **Only glue.** Nothing here is an input of a toolchain unit: a unit's
  inputs are its own pack's files (`../../scripts/toolchain-key.sh`), and
  sharing a unit's build scripts would change how keys are made, which is a
  change of its own (`yukibana-toolchain/N`).
* **Tests stay with the packs.** Each pack's tests check the kit's code on
  that pack's fixtures (`cpp/test-emit.mjs`, `rust/test-mir.mjs`,
  `swift/test-emit.mjs`), so a change here is tested against every
  language it serves.
