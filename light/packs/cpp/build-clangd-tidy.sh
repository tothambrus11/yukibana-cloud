#!/usr/bin/env bash
# Builds clangd (LLVM 21.1.8) with clang-tidy's checks for WebAssembly, the
# tidy unit's one step (toolchains/tidy/toolchain.sh), into $OUT:
#
#   clangd-tidy.js     Emscripten's glue (an ES module server.js imports)
#   clangd-tidy.wasm   clangd with every clang-tidy check but the static
#                      analyzer's, otherwise the compilers unit's clangd.wasm
#   tidy-checks.json   the checks it has, for the app's rule editor
#                      (tidy-checks.mjs)
#
# with .gz and .br siblings of the first two. It is the same clangd as
# build-clangd.sh's, from the same tarball (the compilers unit's, at
# $DEP_COMPILERS/build-only) and patch, configured alike but for
# CLANGD_TIDY_CHECKS (llvm-lib.sh, llvm_clangd_args), in a tree of its own:
# the checks are a second download the editor does not wait for. server.js
# starts with clangd.wasm, and swaps this one in once it has loaded
# (README, "clang-tidy").
#
# Idempotent, as build-clangd.sh: each reused tree records what made it.
# Needs clang, cmake, ninja and lld on the host (toolchains/tidy/deps.apt),
# the emsdk unit at $DEP_EMSDK and the compilers unit at $DEP_COMPILERS.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=build-lib.sh
source "$HERE/build-lib.sh"
# shellcheck source-path=SCRIPTDIR source=llvm-lib.sh
source "$HERE/llvm-lib.sh"
: "${OUT:?OUT is the toolchain directory of the tidy unit (pack-toolchain.sh sets it)}"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp"
JOBS=${JOBS:-3}
NICE="nice -n 10"
mkdir -p "$CACHE" "$OUT"
cd "$CACHE"
need_unit compilers   # LLVM_VERSION, LLVM_SHA256
emsdk_use

step "sources (LLVM $LLVM_VERSION, the compilers unit's tarball)"
tarball="$DEP_COMPILERS/build-only/llvm-project-$LLVM_VERSION.src.tar.xz"
[ -f "$tarball" ] || die "the compilers unit has no LLVM tarball at $tarball"
SRC=$(llvm_clangd_sources "$tarball")

step "native table generators"
llvm_native_tools "$SRC"

step "clangd with clang-tidy for WebAssembly"
# A tree of its own, not build-wasm with the option flipped: the two
# clangds differ in two files (ParsedAST.cpp links the checks in, and
# Feature.cpp says so), but every check is a library of its own, and
# flipping one tree between them would relink and recompile on every build.
made_by=$(llvm_made_by)
keep_tree build-wasm-tidy "$made_by"
follow_patch build-wasm-tidy "$HERE/patches/clangd-browser.patch" "$SRC"
llvm_clangd_args cmake_args ON
$NICE emcmake cmake -S "$SRC/llvm" -B build-wasm-tidy "${cmake_args[@]}" >/dev/null
$NICE ninja -C build-wasm-tidy -j"$JOBS" clangd

step "clangd with clang-tidy into the toolchain"
cp build-wasm-tidy/bin/clangd.wasm "$OUT/clangd-tidy.wasm"
# Emscripten's glue names its wasm and itself by the program's name, as
# URLs beside it: its threads are Workers started from "clangd.js", which
# here would be the other clangd's glue. Both become clangd-tidy's.
sed -E 's/"clangd\.(js|wasm)"/"clangd-tidy.\1"/g' build-wasm-tidy/bin/clangd.js > "$OUT/clangd-tidy.js"
for f in js wasm; do
  grep -q "\"clangd-tidy\.$f\"" "$OUT/clangd-tidy.js" ||
    die "clangd.js does not name \"clangd.$f\": Emscripten's glue changed, and clangd-tidy.js could load the other clangd's"
done
node "$HERE/tidy-checks.mjs" "$SRC" "$LLVM_VERSION" > "$OUT/tidy-checks.json"
node "$HERE/compress.mjs" "$OUT/clangd-tidy.js" "$OUT/clangd-tidy.wasm" "$OUT/tidy-checks.json"
printf '{"llvm":"%s"}\n' "$LLVM_VERSION" > "$OUT/versions-tidy.json"
ls -la "$OUT"/clangd-tidy.* "$OUT"/tidy-checks.json*
