#!/usr/bin/env bash
# The Linux pack's tests, run over the pack as assembled, in
# ../../app/static/packs/linux, by light-packs.yml's assemble job as every
# split pack's test.sh is, so the bytes tested are the bytes shipped:
#
#   test-cpio.mjs   the initramfs writer (src/cpio.js) against GNU cpio
#   test-run.mjs    vm.js in headless Chromium, as a runner imports it: a
#                   program on each architecture, in system emulation and in
#                   user emulation, with stdin, strace and two vCPUs
#
# The packs that run programs on it test it with their own: the C/C++
# pack's test-run-linux.mjs and the Rust pack's test-run.mjs, over this
# pack assembled beside theirs (their `uses` files). test-vm.mjs is the vm
# unit's own test, which compiles vm/fixtures/ against that unit's build
# trees, which an assembly over stored units never has.
#
#   ./test.sh            runs them, after assembly (./build.sh locally);
#                        CHROMIUM names the browser, else playwright-core's
#                        own, else /opt/pw-browsers/chromium
#   ./test.sh --inputs   prints the paths outside this pack the tests read:
#                        none
#   ./test.sh --setup    installs what the tests need on a fresh
#                        ubuntu-24.04 runner, with sudo: Chromium and its
#                        system libraries (this pack's playwright-core),
#                        and GNU cpio
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../../app/static/packs/linux"
# shellcheck source=../../scripts/pack-lib.sh
source "$HERE/../../scripts/pack-lib.sh"

case "${1:-}" in
  --inputs) exit 0 ;;
  --setup)
    pnpm_deps "$HERE"
    (cd "$HERE" && pnpm exec playwright-core install --with-deps chromium)
    sudo apt-get update -q
    sudo apt-get install -y -q --no-install-recommends cpio
    exit 0 ;;
  '') ;;
  *) echo "test.sh: unknown argument $1 (--inputs, --setup, or none)" >&2; exit 2 ;;
esac

[ -f "$OUT/vm.js" ] || { echo "test.sh: no assembled pack at $OUT: run ./build.sh first" >&2; exit 1; }
pnpm_deps "$HERE"
if [ -z "${CHROMIUM:-}" ]; then
  CHROMIUM="$(cd "$HERE" && node -e "import('playwright-core').then((m) => console.log(m.chromium.executablePath()))")"
  [ -x "$CHROMIUM" ] || CHROMIUM=/opt/pw-browsers/chromium
fi
export CHROMIUM
cd "$HERE"
node --test test-cpio.mjs test-run.mjs
