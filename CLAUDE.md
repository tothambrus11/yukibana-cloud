# Working in this repository

Everything here is Yukibana Light, in `light/`: `light/README.md` says how
it is built, run, tested and deployed.

* Light is a pnpm workspace of its own (`light/pnpm-workspace.yaml`),
  installed with `pnpm install` in `light/` and checked with
  `pnpm run check` and `pnpm run test:unit` in `light/app`.
* Its CI is the `light-*.yml` workflows in `.github/workflows/`, with the
  composite actions in `.github/actions/` (`once`, `light-swift-toolchain`).
  `light/scripts/test-workflows.mjs` checks the workflows themselves.
