#!/usr/bin/env bash
# The LLDB pack's tests, run over the pack as assembled, in
# ../../app/static/packs/lldb, by light-packs.yml's assemble job as every
# split pack's test.sh is, so the bytes tested are the bytes shipped:
#
#   test-stub.mjs   the instrumenter (the assembled instrument.wasm) and the
#                   stub, with a scripted GDB-remote client
#   test.mjs        lldb-dap in headless Chromium debugging tests/hello.wasm
#                   through DAP, with the glue's debugger.js and runtime.js
#
#   ./test.sh            runs them, after assembly; CHROMIUM names the
#                        browser, else playwright-core's own, else
#                        /opt/pw-browsers/chromium
#   ./test.sh --inputs   prints the paths outside this pack the tests read:
#                        none
#   ./test.sh --setup    installs what the tests need on a fresh
#                        ubuntu-24.04 runner, with sudo: Chromium and its
#                        system libraries (this pack's playwright-core)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../../app/static/packs/lldb"
npm_deps() {
  local want
  want=$(sha256sum < "$HERE/package-lock.json" | cut -d' ' -f1)
  [ "$(cat "$HERE/node_modules/.yk-lock" 2>/dev/null)" != "$want" ] || return 0
  (cd "$HERE" && npm ci --no-audit --no-fund >&2)
  echo "$want" > "$HERE/node_modules/.yk-lock"
}

case "${1:-}" in
  --inputs) exit 0 ;;
  --setup)
    npm_deps
    (cd "$HERE" && npx --no-install playwright-core install --with-deps chromium)
    exit 0 ;;
  '') ;;
  *) echo "test.sh: unknown argument $1 (--inputs, --setup, or none)" >&2; exit 2 ;;
esac

[ -f "$OUT/debugger.js" ] || { echo "test.sh: no assembled pack at $OUT" >&2; exit 1; }
npm_deps
if [ -z "${CHROMIUM:-}" ]; then
  CHROMIUM="$(cd "$HERE" && node -e "import('playwright-core').then((m) => console.log(m.chromium.executablePath()))")"
  [ -x "$CHROMIUM" ] || CHROMIUM=/opt/pw-browsers/chromium
fi
export CHROMIUM
cd "$HERE"
INSTRUMENT_WASM="$OUT/instrument.wasm" node --test test-stub.mjs
LLDB_PACK="$OUT" node test.mjs
