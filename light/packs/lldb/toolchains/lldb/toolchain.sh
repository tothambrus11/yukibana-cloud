#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Builds the LLDB pack's lldb unit (lldb/lldb) into $OUT, run by
# light/scripts/pack-toolchain.sh from this directory of its stage, with
# the cpp/emsdk unit at $DEP_EMSDK:
#
#   lldb-dap.js, lldb-dap.wasm   LLDB's Debug Adapter Protocol server,
#                                LLVM_VERSION, patched for the browser
#                                (patches/lldb-browser.patch) and compiled
#                                with Emscripten (build-lldb.sh)
#   LICENSE-llvm.txt, LICENSE-libxml2.txt, versions-lldb.json
#
# the .wasm with .gz and .br siblings. Two to three hours on four cores
# from nothing (most of it LLDB's clang); the build directories stay in
# $PACK_CACHE/lldb, so a rebuild after a patch change compiles what changed.
set -euo pipefail

UNIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK="$(cd "$UNIT/../.." && pwd)"
# shellcheck source=pins.sh
source "$UNIT/pins.sh"
# shellcheck source=../../lib.sh
source "$PACK/lib.sh"
: "${OUT:?OUT is the toolchain directory of this unit (pack-toolchain.sh sets it)}"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/lldb"
mkdir -p "$CACHE"
emsdk_use
# shellcheck source=../../build-lldb.sh
source "$PACK/build-lldb.sh"
