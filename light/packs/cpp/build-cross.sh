#!/usr/bin/env bash
# Builds cc-cross.{js,wasm}: clang 21.1.8 and ld.lld (ELF only) in one
# Emscripten binary, for the Linux targets x86-64, AArch64 and RISC-V 64
# (README, "Targets"). It is the runner's and the explorer's compiler for a
# project whose compile_flags.txt names one of those targets; cc.wasm
# (build-runner.sh) stays the WebAssembly compiler, untouched, so a project
# on the default target downloads nothing new.
#
# The configuration is build-runner.sh's, except for what makes it a Linux
# cross compiler:
#
#   LLVM_TARGETS_TO_BUILD=X86;AArch64;RISCV   no WebAssembly, no ARM
#   LLVM_DEFAULT_TARGET_TRIPLE=x86_64-linux-musl
#   LLVM_EXTERNAL_LLD_SOURCE_DIR              a copy of lld/ with
#                                             patches/elf-ld-only.patch
#   CLANG_DEFAULT_{CXX_STDLIB,RTLIB,UNWINDLIB,LINKER}
#                                             libc++, compiler-rt, libunwind,
#                                             lld: the LLVM runtimes that
#                                             build-targets.sh ships
#   -sENVIRONMENT=worker,node                 Node too, for test-targets.mjs
#
# The artifact is kept in $CACHE/artifacts/cc-cross with a STAMP (the
# SHA-256 of the LLVM version and tarball pin, Emscripten's version, the
# cmake arguments and the patch), as build-runner.sh keeps cc's; the LLVM
# step is skipped while it matches, and PRINT_STAMP=1 prints it without
# building. The compilers unit (toolchains/compilers/toolchain.sh) copies
# it to cc-cross.{js,wasm}. Run by that unit after build-clangd.sh, whose
# LLVM source tree and native table generators it builds on.
#
# CROSS_BUILD_DIR picks the build tree (default $CACHE/build-wasm-cross, a
# fresh tree: about 2500 steps, as long as build-runner.sh's first build).
# Any tree of this LLVM and Emscripten can be reused (it records what made
# it; build-lib.sh, keep_tree): switching a tree between this
# configuration and build-runner.sh's rebuilds most of it, because the
# default triple and the native target are in llvm-config.h, which nearly
# every file includes (README, "Targets", Build).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=toolchains/compilers/pins.sh
source "$HERE/toolchains/compilers/pins.sh"
# shellcheck source-path=SCRIPTDIR source=build-lib.sh
source "$HERE/build-lib.sh"
# shellcheck source-path=SCRIPTDIR source=llvm-lib.sh
source "$HERE/llvm-lib.sh"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp"
JOBS=${JOBS:-3}
NICE="nice -n 10"
SRC="$CACHE/llvm-project-$LLVM_VERSION.src"
B="${CROSS_BUILD_DIR:-$CACHE/build-wasm-cross}"
LLD="$CACHE/lld-elf-$LLVM_VERSION"
ART="$CACHE/artifacts/cc-cross"
cd "$CACHE"

step "lld sources (ELF only)"
# LLVM's CMake refuses LLVM_ENABLE_PROJECTS=lld unless llvm/../lld exists,
# even with LLVM_EXTERNAL_LLD_SOURCE_DIR pointing elsewhere. The compilers
# unit runs this script before build-runner.sh, so on a clean machine it is
# not there yet: made here as build-runner.sh makes it (llvm-lib.sh).
llvm_lld_sources
# A copy of lld/ of its own: build-runner.sh's $SRC/lld is patched to wasm
# only and is never touched here. .patched holds a SHA-256 of the tarball's
# pin and the patch; another tarball or patch means a fresh copy.
patch_sha=$({ echo "$LLVM_SHA256"; cat "$HERE/patches/elf-ld-only.patch"; } | sha256sum | cut -d' ' -f1)
if [ "$(cat "$LLD/.patched" 2>/dev/null)" != "$patch_sha" ]; then
  rm -rf "$LLD" && mkdir -p "$LLD"
  tar xJf "llvm-project-$LLVM_VERSION.src.tar.xz" -C "$LLD" --strip-components=1 "llvm-project-$LLVM_VERSION.src/lld"
  patch -d "$LLD" -p1 < "$HERE/patches/elf-ld-only.patch"
  echo "$patch_sha" > "$LLD/.patched"
fi

step "clang + ld.lld for x86-64, AArch64 and RISC-V 64 Linux"
emsdk_use
# As build-runner.sh's (llvm-lib.sh's llvm_wasm_common_args), with node in
# ENVIRONMENT: test-targets.mjs drives the compiler in Node. The glue grows by
# its Node branch (README, sizes).
cmake_args=()
llvm_wasm_common_args cmake_args worker,node "X86;AArch64;RISCV" "$LLD/lld" x86_64-linux-musl libunwind
stamp=$({ echo "llvm $LLVM_VERSION $LLVM_SHA256"; emcc --version | head -1; printf '%s\n' "${cmake_args[@]}";
          cat "$HERE/patches/elf-ld-only.patch"; } | sha256sum | cut -d' ' -f1)
# PRINT_STAMP=1 prints the stamp and builds nothing, as build-runner.sh does:
# a change to the scripts can be checked to leave the compiler's stamp alone.
if [ "${PRINT_STAMP:-}" = 1 ]; then echo "$stamp"; exit 0; fi
if [ "$(cat "$ART/STAMP" 2>/dev/null)" = "$stamp" ] && [ -f "$ART/llvm.wasm" ] && [ -f "$ART/llvm.js" ]; then
  echo "cc-cross.wasm is up to date (artifacts/cc-cross/STAMP $stamp)"
  exit 0
fi
# The tree records what made it (llvm-lib.sh, llvm_made_by), which is
# cc's too (llvm-lib.sh), and follows the patches of the sources it
# compiles.
keep_tree "$B" "$(llvm_made_by)"
follow_patch "$B" "$HERE/patches/clangd-browser.patch" "$SRC"
follow_patch "$B" "$HERE/patches/elf-ld-only.patch" "$LLD"
$NICE emcmake cmake -S "$SRC/llvm" -B "$B" "${cmake_args[@]}" >/dev/null
$NICE ninja -C "$B" -j"$JOBS" llvm-driver
mkdir -p "$ART"
rm -f "$ART/STAMP"
cp "$B/bin/llvm.js" "$B/bin/llvm.wasm" "$ART/"
echo "$stamp" > "$ART/STAMP"
ls -l "$ART"
