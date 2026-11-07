#!/usr/bin/env bash
# The Rust pack's tests, run over the pack as assembled, in
# ../../app/static/packs/rust, by light-packs.yml's assemble job as every
# split pack's test.sh is, so the bytes tested are the bytes shipped. Each
# drives the pack as the app does: app/static served with COOP/COEP, the
# workers in headless Chromium.
#
#   test-mir.mjs   the MIR, LLVM IR and assembly filters and the demangler,
#                  on rustc's output in tests/fixtures (no pack needed, but
#                  cheap)
#   test.mjs       rust-analyzer (server.js): the sample, completion, hover,
#                  quickcheck's sources
#   test-run.mjs   the runner on WebAssembly (the sample, tests, quickcheck,
#                  stdin, errors, panics, optimisation levels), under Miri on
#                  its targets, and the compiler output views; and on the
#                  Linux targets, on the Linux pack's emulator, assembled
#                  beside this pack (`uses`), which test.sh requires
#
#   ./test.sh            runs them, after assembly; CHROMIUM names the
#                        browser, else playwright-core's own, else
#                        /opt/pw-browsers/chromium
#   ./test.sh --inputs   prints the repository paths outside this pack that
#                        the tests read, one per line: the app's sample
#   ./test.sh --setup    installs what the tests need on a fresh
#                        ubuntu-24.04 runner, with sudo: Chromium and its
#                        system libraries (this pack's playwright-core)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../../app/static/packs/rust"
npm_deps() {
  local want
  want=$(sha256sum < "$HERE/package-lock.json" | cut -d' ' -f1)
  [ "$(cat "$HERE/node_modules/.yk-lock" 2>/dev/null)" != "$want" ] || return 0
  (cd "$HERE" && npm ci --no-audit --no-fund >&2)
  echo "$want" > "$HERE/node_modules/.yk-lock"
}

case "${1:-}" in
  --inputs)
    # test.mjs and test-run.mjs import the app's sample (lang-rust's
    # body.ts), which Node loads as it is, with what it imports: the
    # package's own files, and std's, core's, runtime's and protocol's.
    (cd "$HERE/../../.." && git ls-files -- 'light/modules/lang-rust/*.ts' 'light/modules/std/*.ts' 'light/modules/core/*.ts' 'light/modules/runtime/*.ts' 'light/modules/protocol/*.ts')
    exit 0 ;;
  --setup)
    npm_deps
    (cd "$HERE" && npx --no-install playwright-core install --with-deps chromium)
    exit 0 ;;
  '') ;;
  *) echo "test.sh: unknown argument $1 (--inputs, --setup, or none)" >&2; exit 2 ;;
esac

[ -f "$OUT/server.js" ] || { echo "test.sh: no assembled pack at $OUT" >&2; exit 1; }
[ -f "$OUT/../linux/vm.js" ] ||
  { echo "test.sh: no Linux pack beside it (app/static/packs/linux), which the Linux targets run on: ../linux/build.sh" >&2; exit 1; }
npm_deps
if [ -z "${CHROMIUM:-}" ]; then
  CHROMIUM="$(cd "$HERE" && node -e "import('playwright-core').then((m) => console.log(m.chromium.executablePath()))")"
  [ -x "$CHROMIUM" ] || CHROMIUM=/opt/pw-browsers/chromium
fi
export CHROMIUM
cd "$HERE"
node --test test-mir.mjs
node test.mjs
node test-run.mjs
