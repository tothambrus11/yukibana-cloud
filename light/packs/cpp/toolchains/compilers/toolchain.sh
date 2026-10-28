#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Builds the C/C++ pack's compilers unit (cpp/compilers) into $OUT, run by
# light/scripts/pack-toolchain.sh from this directory of its stage, with
# the emsdk unit at $DEP_EMSDK:
#
#   clangd.js, clangd.wasm   the language server (build-clangd.sh)
#   cc.js, cc.wasm           clang + wasm-ld, WebAssembly (build-runner.sh)
#   cc-cross.js, .wasm       clang + ld.lld, the Linux targets (build-cross.sh)
#   demangle.js, .wasm       llvm::demangle for the views (build-demangle.sh)
#   LICENSE-llvm.txt, versions-compilers.json
#   build-only/pins.sh       this unit's pins, which the libs unit reads
#   build-only/llvm-project-<version>.src.tar.xz
#                            the checked LLVM tarball, from which the libs
#                            unit extracts the runtimes and headers it builds
#                            (so LLVM is pinned and downloaded once)
#
# each served file with .gz and .br siblings. The pack files it builds with
# are the ones toolchains/compilers/paths names; everything it compiles is
# LLVM's with this unit's patches, so a change to a library, the VM or the
# glue never reaches it. Hours from nothing; its trees and stamps are kept
# in $PACK_CACHE/cpp, so a warm build redoes only what changed (README,
# "Build").
set -euo pipefail

UNIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK="$(cd "$UNIT/../.." && pwd)"
# shellcheck source=pins.sh
source "$UNIT/pins.sh"
# shellcheck source=../../build-lib.sh
source "$PACK/build-lib.sh"
: "${OUT:?OUT is the toolchain directory of this unit (pack-toolchain.sh sets it)}"
export OUT
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp"

"$PACK/build-clangd.sh"
"$PACK/build-cross.sh"
"$PACK/build-runner.sh"
"$PACK/build-demangle.sh"

step "compilers into the toolchain (from the stamped artifacts)"
# Only from $CACHE/artifacts, which build-runner.sh and build-cross.sh
# stamp: never from a build tree, which may have been reconfigured for the
# other compiler since.
for c in cc cc-cross; do
  [ -f "$CACHE/artifacts/$c/llvm.wasm" ] || die "no $c compiler in $CACHE/artifacts/$c"
  cp "$CACHE/artifacts/$c/llvm.wasm" "$OUT/$c.wasm"
  cp "$CACHE/artifacts/$c/llvm.js" "$OUT/$c.js"
done
node "$PACK/compress.mjs" "$OUT/cc.js" "$OUT/cc.wasm" "$OUT/cc-cross.js" "$OUT/cc-cross.wasm"

step "what the libs unit builds with"
mkdir -p "$OUT/build-only"
cp "$UNIT/pins.sh" "$OUT/build-only/pins.sh"
cp "$CACHE/llvm-project-$LLVM_VERSION.src.tar.xz" "$OUT/build-only/"
echo "$LLVM_SHA256  $OUT/build-only/llvm-project-$LLVM_VERSION.src.tar.xz" | sha256sum -c --quiet - ||
  die "the LLVM tarball in $CACHE is not the one pinned"
printf '{"llvm":"%s"}\n' "$LLVM_VERSION" > "$OUT/versions-compilers.json"
