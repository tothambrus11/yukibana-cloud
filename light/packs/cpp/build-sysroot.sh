#!/usr/bin/env bash
# Builds sysroot.tar.gz, the headers clangd parses with and the runners
# compile against, into $OUT, the libs unit's toolchain (README, "Files"):
#
#   /usr/include                musl's, from the musl unit's release tarball
#   /usr/include/c++/v1         libc++'s, configured for musl
#                               ($CACHE/cxx-headers, made here), with
#                               libc++abi's cxxabi.h and __cxxabi_config.h
#   /usr/include/gtest, catch2, doctest, rapidcheck(.h)
#                               the test frameworks' headers, as
#                               build-cxx-runtime.sh and
#                               build-test-frameworks.sh built them
#   /usr/lib/clang/21/include   clang's freestanding headers, and nothing else
#                               (the x86 intrinsics are 8 MB nobody's homework
#                               includes)
#
# and LICENSE-musl.txt. Run by the libs unit (toolchains/libs/toolchain.sh)
# after the runtime and the frameworks, with the LLVM source tree it
# extracted at $SRC (the compilers unit's tarball) and the musl unit at
# $DEP_MUSL. The libc++ headers are installed once per LLVM tarball and
# cmake arguments (what made them, keep_tree); the archive is written
# whole every run, in seconds.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=build-lib.sh
source "$HERE/build-lib.sh"
: "${OUT:?OUT is the toolchain directory of the libs unit (pack-toolchain.sh sets it)}"
: "${SRC:?SRC is the LLVM source tree the libs unit extracted (toolchains/libs/toolchain.sh)}"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp"
need_unit compilers
need_unit musl
mkdir -p "$CACHE" "$OUT"
cd "$CACHE"

step "musl's headers"
# musl's tree, named by the version; it records the tarball's pin.
keep_tree "musl-$MUSL_VERSION" "musl $MUSL_SHA256"
[ -f "musl-$MUSL_VERSION/Makefile" ] ||
  tar xzf "$DEP_MUSL/build-only/musl-$MUSL_VERSION.tar.gz" -C "musl-$MUSL_VERSION" --strip-components=1

step "libc++ headers"
# Configured for musl, as clangd's default target is x86_64-linux-musl; only
# the header step runs, nothing is compiled. Installed once per LLVM tarball
# and these arguments (what made it).
cxx_args=(-G Ninja -DLLVM_ENABLE_RUNTIMES=libcxx
  -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ -DCMAKE_INSTALL_PREFIX="$CACHE/cxx-headers"
  -DLIBCXX_HAS_MUSL_LIBC=ON -DLIBCXX_CXX_ABI=none -DLIBCXX_INCLUDE_TESTS=OFF
  -DLIBCXX_INCLUDE_BENCHMARKS=OFF -DLIBCXX_ENABLE_SHARED=OFF)
keep_tree cxx-headers "$(printf 'llvm %s %s\n' "$LLVM_VERSION" "$LLVM_SHA256"; printf '%s\n' "${cxx_args[@]}")"
if [ ! -f cxx-headers/include/c++/v1/__config_site ]; then
  rm -rf build-cxx
  cmake -S "$SRC/runtimes" -B build-cxx "${cxx_args[@]}" >/dev/null
  ninja -C build-cxx install-cxx-headers >/dev/null
  rm -rf build-cxx
fi

step "sysroot"
# /usr/include: musl; /usr/include/c++/v1: libc++, where clang's Linux driver
# looks for it in a sysroot of /; /usr/lib/clang/21/include: clang's own
# headers, the freestanding ones and nothing else.
stage="$CACHE/sysroot"
rm -rf "$stage" && mkdir -p "$stage/usr/include" "$stage/usr/lib/clang/21/include"
make -s -C "musl-$MUSL_VERSION" ARCH=x86_64 prefix=/usr DESTDIR="$stage" install-headers >/dev/null
cp -r cxx-headers/include/c++ "$stage/usr/include/"
# GoogleTest: #include <gtest/gtest.h> in a test resolves in the editor, and
# runner.js takes the same files from here for its WASI sysroot. It includes
# <cxxabi.h> (to demangle type names) when the library is libc++, so
# libc++abi's two public headers join libc++'s.
[ -d eh/include/gtest ] && [ -d testfw/include/catch2 ] ||
  die "the frameworks' headers are missing (build-cxx-runtime.sh and build-test-frameworks.sh run first)"
cp -r eh/include/gtest "$stage/usr/include/"
# Catch2 (with the catch_user_config.hpp its wasm build generated) and
# doctest, likewise: about 180 KB of the archive between them; RapidCheck
# (rapidcheck.h, rapidcheck/ with its gtest.h and catch.h) likewise (README).
cp -r testfw/include/catch2 testfw/include/doctest testfw/include/rapidcheck testfw/include/rapidcheck.h "$stage/usr/include/"
cp "$SRC"/libcxxabi/include/{cxxabi.h,__cxxabi_config.h} "$stage/usr/include/c++/v1/"
hdr="$SRC/clang/lib/Headers"
cp "$hdr"/{float.h,inttypes.h,iso646.h,limits.h,stdalign.h,stdarg.h,stdatomic.h,stdbool.h,stdckdint.h} \
  "$hdr"/{stdcountof.h,stddef.h,stdint.h,stdnoreturn.h,tgmath.h,varargs.h,unwind.h} \
  "$hdr"/__stdarg_*.h "$hdr"/__stddef_*.h "$stage/usr/lib/clang/21/include/"
reproducible_tar -C "$stage" -c usr | gzip -9n > "$OUT/sysroot.tar.gz"
cp "musl-$MUSL_VERSION/COPYRIGHT" "$OUT/LICENSE-musl.txt"
ls -la "$OUT/sysroot.tar.gz"
