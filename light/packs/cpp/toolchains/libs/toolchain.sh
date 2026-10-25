#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Builds the C/C++ pack's libs unit (cpp/libs) into $OUT, run by
# light/scripts/pack-toolchain.sh from this directory of its stage, with the
# compilers unit at $DEP_COMPILERS, the emsdk unit at $DEP_EMSDK and the
# musl unit at $DEP_MUSL: everything a compiler compiles against or links,
# and nothing that compiles.
#
#   sysroot.tar.gz        the headers clangd parses with (build-sysroot.sh)
#   wasi-sysroot.tar.gz   wasi-libc, libc++ with exceptions, compiler-rt
#                         (build-cxx-runtime.sh, pack-runner.sh)
#   gtest.tar, catch2.tar, doctest.tar, rapidcheck.tar
#                         the test frameworks' libraries
#                         (build-test-frameworks.sh, pack-runner.sh)
#   asan.tar, ubsan.tar   the sanitizer runtimes (build-sanitizers.sh)
#   targets/<arch>/       include.tar, lib.tar (build-targets.sh), gtest.tar,
#                         rapidcheck.tar (build-test-frameworks-linux.sh),
#                         asan.tar, ubsan.tar: a Linux target's files
#   LICENSE-*.txt, versions-libs.json
#
# the archives with .gz and .br siblings. LLVM's runtimes and headers are
# extracted here from the compilers unit's checked tarball
# ($DEP_COMPILERS/build-only), so the LLVM they come from is the one the
# compilers were built from, pinned once; a change to the compilers re-keys
# this unit (its needs), and a framework pin here re-keys this unit alone.
# Tens of minutes from nothing; each step keeps its stamp in $PACK_CACHE/cpp
# (README, "Build").
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
need_unit compilers   # LLVM_VERSION, LLVM_SHA256
need_unit musl
need_unit emsdk
mkdir -p "$CACHE" "$OUT"

step "LLVM's runtimes and headers (LLVM $LLVM_VERSION, the compilers unit's tarball)"
# Only what the libraries and the headers are made of: libc++, libc++abi,
# libunwind and their build (runtimes, cmake, llvm's cmake modules,
# third-party), libc (which libc++ includes from), and clang's headers. A
# tree of its own, not the compilers unit's patched one in the same cache:
# those two units may be built on different machines, and nothing here
# is patched.
tarball="$DEP_COMPILERS/build-only/llvm-project-$LLVM_VERSION.src.tar.xz"
[ -f "$tarball" ] || die "the compilers unit has no LLVM tarball at $tarball"
SRC="$CACHE/llvm-runtimes-$LLVM_VERSION.src"
keep_tree "$SRC" "llvm $LLVM_VERSION $LLVM_SHA256"
if [ ! -f "$SRC/libunwind/src/Unwind-wasm.c" ]; then
  echo "$LLVM_SHA256  $tarball" | sha256sum -c --quiet - || die "$tarball is not the LLVM tarball pinned"
  tar xJf "$tarball" -C "$SRC" --strip-components=1 \
    "llvm-project-$LLVM_VERSION.src"/{llvm,clang/lib/Headers,cmake,third-party,libcxx,libcxxabi,libc,libunwind,runtimes}
fi
export SRC

"$PACK/build-cxx-runtime.sh"
"$PACK/build-test-frameworks.sh"
"$PACK/build-sysroot.sh"
step "Linux targets' headers and libraries"
"$PACK/build-targets.sh"
step "the runner's libraries"
"$PACK/pack-runner.sh"

printf '{"wasi-sdk":"%s","googletest":"%s","catch2":"%s","doctest":"%s","rapidcheck":"%s","musl":"%s"}\n' \
  "$WASI_SDK_VERSION" "$GTEST_VERSION" "$CATCH2_VERSION" "$DOCTEST_VERSION" "$RAPIDCHECK_COMMIT" "$MUSL_VERSION" \
  > "$OUT/versions-libs.json"
