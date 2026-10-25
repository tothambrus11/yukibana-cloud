#!/usr/bin/env bash
# The C/C++ pack's tests, run over the pack as assembled, in
# ../../app/static/packs/cpp: what light-packs.yml's assemble job runs once
# pack-toolchain.sh assemble has put the pack together over its units, in a
# release too, so the bytes these tests passed are the bytes shipped. Each
# drives the pack as the app does: app/static served with COOP/COEP, the
# workers in headless Chromium.
#
#   test.mjs             clangd (server.js): three sessions, the Linux
#                        targets' headers among them
#   test-run.mjs         the runner (runner.js) on the default target: the
#                        sample, stdin, exceptions, the test frameworks,
#                        RapidCheck, the files each run fetches
#   test-sanitizers.mjs  AddressSanitizer and UBSan on the default target
#   test-run-linux.mjs   Run on every Linux target, under QEMU-Wasm (vm.js)
#   test-targets.mjs     the target rule, the compile arguments, every Linux
#                        target linked by cc-cross.wasm and its ELF run by an
#                        oracle (the host, qemu-user-static), and the
#                        explorer worker
#
# Not here, because they test a unit's build rather than the pack and need
# that unit's build trees, which an assembly over stored units never has:
# test-vm.mjs (the guest's fixtures compiled with the host's clang against
# the musl sysroots in $PACK_CACHE; test-run-linux.mjs runs the same VM
# through the runner) and test-demangle.mjs (LLVM's demangler compiled
# natively from the source tree in $PACK_CACHE; test-targets.mjs's explorer
# demangles through demangle.wasm). Nor the tests that need no built pack
# (test-emit, test-cpio, test-build-lib, test-units), which light-ci.yml's
# pack-units job runs on every change to them.
#
# A test that skips because a file of the pack is missing is a failure
# here: an assembled pack has every unit's outputs (assemble checks them),
# so a skip means the pack lost a file, and a pass that hid it would ship it.
#
#   ./test.sh            runs them, after assembly (./build.sh locally);
#                        CHROMIUM names the browser, else playwright-core's
#                        own, else /opt/pw-browsers/chromium
#   ./test.sh --inputs   prints the repository paths outside this pack that
#                        the tests read, one per line, for the assemble
#                        job's once gate (the pack's own files are already
#                        its inputs)
#   ./test.sh --setup    installs what the tests need on a fresh
#                        ubuntu-24.04 runner, with sudo: Chromium and its
#                        system libraries (this pack's playwright-core),
#                        and qemu-user-static, test-targets.mjs's oracle
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=glue-lib.sh
source "$HERE/glue-lib.sh"

case "${1:-}" in
  --inputs)
    # test-run.mjs reads the app's sample and imports its test-framework
    # chooser (which imports only a type from languages.ts);
    # test-run-linux.mjs reads the sample too.
    printf '%s\n' light/app/src/lib/languages.ts light/app/src/lib/cpp-tests.ts
    exit 0 ;;
  --setup)
    npm_deps "$HERE"
    (cd "$HERE" && npx --no-install playwright-core install --with-deps chromium)
    sudo apt-get update -q
    sudo apt-get install -y -q --no-install-recommends qemu-user-static
    exit 0 ;;
  '') ;;
  *) echo "test.sh: unknown argument $1 (--inputs, --setup, or none)" >&2; exit 2 ;;
esac

[ -f "$HERE/../../app/static/packs/cpp/server.js" ] ||
  { echo "test.sh: no assembled pack in app/static/packs/cpp: run ./build.sh first" >&2; exit 1; }
npm_deps "$HERE"
if [ -z "${CHROMIUM:-}" ]; then
  CHROMIUM="$(cd "$HERE" && node -e "import('playwright-core').then((m) => console.log(m.chromium.executablePath()))")"
  [ -x "$CHROMIUM" ] || CHROMIUM=/opt/pw-browsers/chromium
fi
[ -x "$CHROMIUM" ] || { echo "test.sh: no Chromium at $CHROMIUM: set CHROMIUM, or run ./test.sh --setup" >&2; exit 1; }
export CHROMIUM
# ALLOW_SKIP turns a missing oracle or file into a skip in two of the tests;
# here every skip is a failure, so it never reaches them.
unset ALLOW_SKIP

log="$(mktemp)"
trap 'rm -f "$log"' EXIT
failed=()
# run <name> <command...>: runs one test from this directory, its output
# shown as it comes, and records it as failed when it exits non-zero or
# says it skipped anything (`# test-<name>: skipped`, a TAP `# skipped N`).
run() {
  local name=$1 status=0 start=$SECONDS
  shift
  [ -z "${GITHUB_ACTIONS:-}" ] || echo "::group::$name"
  (cd "$HERE" && "$@") 2>&1 | tee "$log" || status=$?
  [ -z "${GITHUB_ACTIONS:-}" ] || echo "::endgroup::"
  if [ "$status" -ne 0 ]; then
    failed+=("$name (exit $status)")
  elif grep -Eq '^# (test-[a-z-]+: (skipped|not built)|skipped [1-9])' "$log"; then
    failed+=("$name (skipped: $(grep -Em1 '^# (test-[a-z-]+: (skipped|not built)|skipped [1-9])' "$log"))")
  fi
  echo "$name: exit $status after $((SECONDS - start)) s"
}

run test.mjs node test.mjs
run test-run.mjs node test-run.mjs
run test-sanitizers.mjs node test-sanitizers.mjs
run test-run-linux.mjs node test-run-linux.mjs
run test-targets.mjs node --test --test-reporter=tap test-targets.mjs

if [ "${#failed[@]}" -gt 0 ]; then
  printf 'test.sh: failed: %s\n' "${failed[@]}" >&2
  exit 1
fi
echo "test.sh: every test of the assembled pack passed"
