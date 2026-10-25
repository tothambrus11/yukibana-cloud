#!/usr/bin/env bash
# Builds what the C/C++ pack needs to *run* a project, next to clangd, into
# ../../app/static/packs/cpp/ (see README, "Running"):
#
#   runner.js            the module Worker the app starts on Run
#   cc.js, cc.wasm       clang 21.1.8 and wasm-ld in one Emscripten binary
#                        (LLVM's multi-call "llvm-driver"; WebAssembly target only)
#   wasi-sysroot.tar.gz  wasi-libc and compiler-rt builtins from the pinned
#                        wasi-sdk release; libc++, libc++abi and libunwind
#                        with C++ exceptions (build-cxx-runtime.sh)
#   gtest.tar            GoogleTest's libraries, for the runner's test mode
#
# clang's freestanding headers are not repeated: runner.js takes them from
# the language server's sysroot.tar.gz, the same URL, so it is cached once.
#
# Called by build.sh after the clangd steps (it reuses that script's LLVM
# source, native table generators and emsdk); idempotent, caches in
# $PACK_CACHE/cpp. The LLVM step takes about an hour at -j3 on this machine.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=pins.sh
source "$HERE/pins.sh"
# shellcheck source-path=SCRIPTDIR source=build-lib.sh
source "$HERE/build-lib.sh"
OUT="$(cd "$HERE/../.." && pwd)/app/static/packs/cpp"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp"
JOBS=${JOBS:-3}
NICE="nice -n 10"
SRC="$CACHE/llvm-project-$LLVM_VERSION.src"
mkdir -p "$CACHE" "$OUT"
cd "$CACHE"

step "lld sources"
# build.sh extracts only what clangd needs; the linker comes from the same
# tarball. The patch drops lld's ELF, COFF, Mach-O and MinGW flavours.
if [ ! -f "$SRC/lld/.patched" ]; then
  rm -rf "$SRC/lld"
  tar xJf "llvm-project-$LLVM_VERSION.src.tar.xz" "llvm-project-$LLVM_VERSION.src/lld"
  patch -d "$SRC" -p1 < "$HERE/patches/wasm-ld-only.patch"
  touch "$SRC/lld/.patched"
fi

step "clang + wasm-ld for WebAssembly"
# shellcheck disable=SC1091
source emsdk/emsdk_env.sh >/dev/null 2>&1
# One binary, LLVM's multi-call driver (LLVM_TOOL_LLVM_DRIVER_BUILD): argv[0]
# or the first argument picks "clang" or "wasm-ld". Only those two join it
# (LLVM_DISTRIBUTION_COMPONENTS); build-lib.sh's llvm_wasm_common_args says
# what the rest of the configuration is and why.
#
# Every setting that build-cross.sh changes is spelled out here too, at its
# default (the lld source next to llvm/, no default unwind library), so a
# tree that was configured for cc-cross is put back by this configure and
# not left half one and half the other: CMake keeps a cached value that is
# not passed again.
cmake_args=()
llvm_wasm_common_args cmake_args worker WebAssembly "$SRC/llvm/../lld" wasm32-wasip1 ""
# The artifact, cc.{js,wasm}, is kept in artifacts/cc with a STAMP: the
# SHA-256 of the LLVM version, Emscripten's version, the cmake arguments and
# the lld patch. pack-runner.sh copies cc.* from there and from nowhere else,
# so a build tree reconfigured for something else (build-cross.sh can use
# this one) never leaks into cc.wasm, and the LLVM step is skipped while the
# stamp matches.
ART="$CACHE/artifacts/cc"
stamp=$({ echo "llvm $LLVM_VERSION"; emcc --version | head -1; printf '%s\n' "${cmake_args[@]}";
          cat "$HERE/patches/wasm-ld-only.patch"; } | sha256sum | cut -d' ' -f1)
if [ "${PRINT_STAMP:-}" = 1 ]; then echo "$stamp"; exit 0; fi
B=build-wasm-cc
if [ "$(cat "$ART/STAMP" 2>/dev/null)" = "$stamp" ] && [ -f "$ART/llvm.wasm" ] && [ -f "$ART/llvm.js" ]; then
  echo "cc.wasm is up to date (artifacts/cc/STAMP $stamp)"
else
  # Configured on every build, so a changed flag reaches it instead of being
  # shadowed by an old cache.
  $NICE emcmake cmake -S "$SRC/llvm" -B $B "${cmake_args[@]}" >/dev/null
  $NICE ninja -C $B -j"$JOBS" llvm-driver
  mkdir -p "$ART"
  rm -f "$ART/STAMP"
  cp $B/bin/llvm.js $B/bin/llvm.wasm "$ART/"
  echo "$stamp" > "$ART/STAMP"
fi

# The sysroot, runner.js and compressed siblings.
"$HERE/pack-runner.sh"
