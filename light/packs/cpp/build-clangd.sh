#!/usr/bin/env bash
# Builds clangd (LLVM 21.1.8) for WebAssembly with the pack's Emscripten, the
# compilers unit's first step (toolchains/compilers/toolchain.sh), into $OUT:
#
#   clangd.js       Emscripten's glue (an ES module server.js imports)
#   clangd.wasm     clangd itself, with threads (Web Workers; needs cross-origin isolation)
#   LICENSE-llvm.txt
#
# with .gz and .br siblings of the first two. On the way it prepares what
# build-runner.sh and build-cross.sh build on: the LLVM source tree with
# patches/clangd-browser.patch ($CACHE/llvm-project-*.src) and the native
# table generators ($CACHE/build-native). server.js, the worker that loads
# clangd, is the pack's glue (glue.sh), and sysroot.tar.gz, the headers
# clangd parses with, the libs unit's (build-sysroot.sh).
#
# Idempotent: each reused tree records what made it (build-lib.sh,
# keep_tree), so a step is only checked by ninja when its inputs are the
# same. Needs clang, cmake, ninja and lld on the host
# (toolchains/compilers/deps.apt), and the emsdk unit at $DEP_EMSDK. Most of
# the time is clangd itself: about an hour at -j3 on this machine (README).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=toolchains/compilers/pins.sh
source "$HERE/toolchains/compilers/pins.sh"
# shellcheck source-path=SCRIPTDIR source=build-lib.sh
source "$HERE/build-lib.sh"
# shellcheck source-path=SCRIPTDIR source=llvm-lib.sh
source "$HERE/llvm-lib.sh"
: "${OUT:?OUT is the toolchain directory of the compilers unit (pack-toolchain.sh sets it)}"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp"
JOBS=${JOBS:-3}
NICE="nice -n 10"
mkdir -p "$CACHE" "$OUT"
cd "$CACHE"
emsdk_use

step "sources"
fetch "https://github.com/llvm/llvm-project/releases/download/llvmorg-$LLVM_VERSION/llvm-project-$LLVM_VERSION.src.tar.xz" \
  "$LLVM_SHA256" "llvm-project-$LLVM_VERSION.src.tar.xz"
SRC=$(llvm_clangd_sources "$CACHE/llvm-project-$LLVM_VERSION.src.tar.xz")

step "native table generators"
llvm_native_tools "$SRC"

step "clangd for WebAssembly"
# Configured on every run: with nothing changed it only rereads the cache,
# and a changed flag (the linker's, say) reaches the build instead of
# being shadowed by the first run's cache. What configuring cannot show
# (another LLVM tarball, another Emscripten under the same emcc path, a
# changed patch) is what the tree records (llvm-lib.sh, llvm_made_by).
# Assigned first: a failure inside an argument's $(...) would not stop the
# script, and the tree would be kept under a record missing its lines.
# Without clang-tidy's checks, to keep the editor's first download small:
# the tidy unit's clangd-tidy.wasm has them, and replaces this one once it
# has loaded (src/server.js).
made_by=$(llvm_made_by)
keep_tree build-wasm "$made_by"
follow_patch build-wasm "$HERE/patches/clangd-browser.patch" "$SRC"
llvm_clangd_args cmake_args OFF
$NICE emcmake cmake -S "$SRC/llvm" -B build-wasm "${cmake_args[@]}" >/dev/null
$NICE ninja -C build-wasm -j"$JOBS" clangd

step "clangd into the toolchain"
cp build-wasm/bin/clangd.wasm "$OUT/clangd.wasm"
cp build-wasm/bin/clangd.js "$OUT/clangd.js"
cp "$SRC/clang-tools-extra/LICENSE.TXT" "$OUT/LICENSE-llvm.txt" 2>/dev/null || cp "$SRC/llvm/LICENSE.TXT" "$OUT/LICENSE-llvm.txt"
node "$HERE/compress.mjs" "$OUT/clangd.js" "$OUT/clangd.wasm"
ls -la "$OUT"/clangd.*
