# The stub pack

A split pack that takes milliseconds to build, so every part of the
toolchain-unit machinery runs on something real: the scripts' tests
(`light/scripts/test-pack-store.mjs`, `test-pack-toolchain.mjs`) copy this
directory into their throwaway repositories, `light/packs/contract.test.mjs`
checks it like any split pack, and `light-packs.yml` builds its units in
waves and assembles it on every run that touches the packs. It is not a
language: it has no `build.sh`, so `setup.sh`, the app and a release
(`light-release.yml` takes the packs with a `build.sh`) never see it.

It has the shape cpp's toolchain will have, in three units:

* `toolchains/compilers/`: "compiles" with `compiler/cc.sh`, the pack file
  its `paths` names, and the shared `lib.sh`. It also writes
  `build-only/flags`, which only the units built with it read: assembly
  never links a toolchain's `build-only/` into the pack.
* `toolchains/vm/`: needs nothing, and also reads `lib.sh`, so one pack
  file is an input of two units.
* `toolchains/libs/`: `needs` `stub/compilers` and builds its "framework"
  with the compilers unit's `bin/cc` and `build-only/flags`, found at
  `$DEP_COMPILERS`. A change
  to the compilers re-keys it; its own pin (`FRAMEWORK_VERSION` in its
  `pins.sh`) re-keys nothing else.

The glue (`glue.paths`: `glue.sh`, `src/`, this file) writes `server.js`
and reads each unit's versions from `versions-<unit>.json`, the one file
name a unit may not share with another.
