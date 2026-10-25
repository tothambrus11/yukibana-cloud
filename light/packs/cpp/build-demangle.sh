#!/usr/bin/env bash
# Builds demangle.{js,wasm} into $OUT, the compilers unit's toolchain: LLVM's
# Itanium demangler (llvm::itaniumDemangle, ItaniumDemangle.cpp of
# LLVMDemangle from the pack's LLVM 21.1.8 source tree, what llvm-cxxfilt
# runs for a _Z name) behind src/demangle/demangle.cpp, for the
# compiler output views (README, "Compiler output views"). Fetched by
# explorer.js only when a view opens.
#
# The pack's Emscripten (the emsdk unit's), -Oz, an ES module factory for workers and
# Node (test-demangle.mjs), no file system. demangle.cpp is compiled with
# -Wall -Wextra -Wpedantic -Werror; LLVM's own files with LLVM's usual
# warnings. Takes under a minute; run by the compilers unit after
# build-clangd.sh, whose LLVM source tree it compiles.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=toolchains/compilers/pins.sh
source "$HERE/toolchains/compilers/pins.sh"
# shellcheck source-path=SCRIPTDIR source=build-lib.sh
source "$HERE/build-lib.sh"
: "${OUT:?OUT is the toolchain directory of the compilers unit (pack-toolchain.sh sets it)}"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp"
SRC="$CACHE/llvm-project-$LLVM_VERSION.src"
W="$CACHE/demangle"
mkdir -p "$W" "$OUT"
[ -f "$SRC/llvm/lib/Demangle/ItaniumDemangle.cpp" ] || die "no LLVM source tree in $SRC (build-clangd.sh extracts it)"
emsdk_use
# No exceptions or RTTI, as LLVM is built; the demangler uses neither.
common=(-std=c++17 -Oz -fno-exceptions -fno-rtti -I"$SRC/llvm/include")
# Only the Itanium demangler: Linux and WASI targets mangle nothing else.
em++ "${common[@]}" -c "$SRC/llvm/lib/Demangle/ItaniumDemangle.cpp" -o "$W/ItaniumDemangle.o"
em++ "${common[@]}" -Wall -Wextra -Wpedantic -Werror -c "$HERE/src/demangle/demangle.cpp" -o "$W/yk.o"
# emmalloc: the smallest malloc; one call allocates a few kilobytes.
em++ -Oz "$W/yk.o" "$W/ItaniumDemangle.o" -o "$W/demangle.js" \
  -sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createDemangle -sENVIRONMENT=worker,node \
  -sFILESYSTEM=0 -sMALLOC=emmalloc -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS=_yk_demangle_lines,_free -sEXPORTED_RUNTIME_METHODS=UTF8ToString,stringToNewUTF8
cp "$W/demangle.js" "$W/demangle.wasm" "$OUT/"
node "$HERE/compress.mjs" "$OUT/demangle.js" "$OUT/demangle.wasm"
