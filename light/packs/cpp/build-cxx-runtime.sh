#!/usr/bin/env bash
# Builds the C++ runtime the runner links programs against, with C++
# exceptions (WebAssembly exception handling), and GoogleTest, into
# $PACK_CACHE/cpp/eh/ (see README, "Running"):
#
#   lib/libc++.a, libc++abi.a, libc++experimental.a
#                          libc++/libc++abi 21.1.8 for wasm32-wasip1, configured
#                          as wasi-sdk 30 configures them except for exceptions
#   lib/libunwind.a        libunwind's Unwind-wasm.c: _Unwind_RaiseException as
#                          the wasm `throw` instruction, and the personality glue
#   lib/yukibana-uncaught.o  src/uncaught.cpp: reports an exception nobody caught
#   lib/libgtest.a, libgtest_main.a   GoogleTest, built with the same flags
#   include/gtest/         GoogleTest's headers
#
# pack-runner.sh puts the first four into wasi-sysroot.tar.gz, in place of
# wasi-sdk's libraries (built without exceptions), and the GoogleTest
# libraries into gtest.tar; build-sysroot.sh puts the headers into
# sysroot.tar.gz. All three are the libs unit's (toolchains/libs/), which
# runs this with the LLVM source tree it extracted at $SRC.
#
# Compiled with wasi-sdk 30's own clang (21.1.4, a native x86_64 build, pinned
# by SHA-256): the in-browser clang (cc.wasm) is the only other compiler here
# with a WebAssembly target, and the emsdk's clang is a newer LLVM than the
# wasm-ld that links these. Every object uses the flags the runner compiles
# C++ with:
#
#   -fwasm-exceptions -mllvm -wasm-use-legacy-eh=false
#
# the standardised form of WebAssembly exception handling (exnref, try_table),
# not the legacy one (try/catch/delegate), which browsers are phasing out.
#
# Idempotent: skipped when $CACHE/eh/.built holds the SHA-256 of this script,
# the libs unit's pins, the compilers unit's (the LLVM the sources are
# from), build-lib.sh and src/uncaught.cpp. About 4 minutes at -j3.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=toolchains/libs/pins.sh
source "$HERE/toolchains/libs/pins.sh"
# shellcheck source-path=SCRIPTDIR source=build-lib.sh
source "$HERE/build-lib.sh"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp"
JOBS=${JOBS:-3}
NICE="nice -n 10"
: "${SRC:?SRC is the LLVM source tree the libs unit extracted (toolchains/libs/toolchain.sh)}"
need_unit compilers
EH="$CACHE/eh"
mkdir -p "$CACHE/wasi"
cd "$CACHE"

stamp=$(cat "$HERE/build-cxx-runtime.sh" "$HERE/toolchains/libs/pins.sh" "$DEP_COMPILERS/build-only/pins.sh" \
  "$HERE/build-lib.sh" "$HERE/src/uncaught.cpp" | sha256sum | cut -d' ' -f1)
if [ "$(cat "$EH/.built" 2>/dev/null)" = "$stamp" ]; then
  echo "C++ runtime with exceptions and GoogleTest: cached in $EH"
  exit 0
fi

step "wasi-sdk $WASI_SDK_VERSION toolchain (native clang for wasm32)"
WSDK="$CACHE/wasi/wasi-sdk-$WASI_SDK_VERSION.0-x86_64-linux"
fetch "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$WASI_SDK_VERSION/wasi-sdk-$WASI_SDK_VERSION.0-x86_64-linux.tar.gz" \
  "$WASI_SDK_SHA256" "wasi/wasi-sdk-$WASI_SDK_VERSION.0-x86_64-linux.tar.gz"
# The unpacked tree is named by the version only; it records the tarball's
# pin, so another tarball of the same version is unpacked again rather than
# the old one used (build-lib.sh, keep_tree). build-test-frameworks.sh,
# build-test-frameworks-linux.sh and build-sanitizers.sh use it too.
keep_tree "$WSDK" "wasi-sdk $WASI_SDK_VERSION $WASI_SDK_SHA256"
[ -x "$WSDK/bin/clang" ] || tar xzf "wasi/wasi-sdk-$WASI_SDK_VERSION.0-x86_64-linux.tar.gz" -C wasi

step "sources: GoogleTest $GTEST_VERSION"
# LLVM's runtimes (libcxx, libcxxabi, libc, libunwind, runtimes) are in
# $SRC, which the libs unit extracted from the compilers unit's tarball.
[ -f "$SRC/libunwind/src/Unwind-wasm.c" ] || die "no libunwind in $SRC (toolchains/libs/toolchain.sh extracts it)"
fetch "https://github.com/google/googletest/releases/download/v$GTEST_VERSION/googletest-$GTEST_VERSION.tar.gz" \
  "$GTEST_SHA256" "googletest-$GTEST_VERSION.tar.gz"
rm -rf "googletest-$GTEST_VERSION" && tar xzf "googletest-$GTEST_VERSION.tar.gz"

# As words for a compiler called directly, and as one string for cmake.
eh=(-fwasm-exceptions -mllvm -wasm-use-legacy-eh=false)
EHFLAGS="${eh[*]}"
target=(--target=wasm32-wasip1 "--sysroot=$WSDK/share/wasi-sysroot")
CC="$WSDK/bin/clang"
rm -rf "$EH" build-eh build-gtest && mkdir -p "$EH/lib" "$EH/include"

step "libc++ and libc++abi with exceptions"
# wasi-sdk's options (cmake/wasi-sdk-sysroot.cmake, define_libcxx_sub), static
# only, with three changes: exceptions on; -O2 without -g; and
# LIBCXXABI_SILENT_TERMINATE off, so that an uncaught exception prints its
# type and what() before abort() (wasi-sdk has no exceptions to report). The
# generated __config_site is checked below to be wasi-sdk's, so the headers
# the runner compiles with describe these libraries. -I libc: libc++'s
# floating-point from_chars uses LLVM libc's shared headers, which a
# standalone runtimes build does not put on the include path itself.
$NICE cmake -S "$SRC/runtimes" -B build-eh -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE="$WSDK/share/cmake/wasi-sdk-p1.cmake" -DWASI_SDK_PREFIX="$WSDK" \
  -DCMAKE_SYSROOT="$WSDK/share/wasi-sysroot" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS="$EHFLAGS -ffile-prefix-map=$SRC/=" -DCMAKE_CXX_FLAGS="$EHFLAGS -ffile-prefix-map=$SRC/= -I$SRC/libc" \
  -DCMAKE_C_FLAGS_RELEASE="-O2 -DNDEBUG" -DCMAKE_CXX_FLAGS_RELEASE="-O2 -DNDEBUG" \
  -DCMAKE_C_COMPILER_WORKS=ON -DCMAKE_CXX_COMPILER_WORKS=ON -DLLVM_COMPILER_CHECKED=ON \
  -DCMAKE_C_LINKER_DEPFILE_SUPPORTED=OFF -DCMAKE_CXX_LINKER_DEPFILE_SUPPORTED=OFF -DUNIX=ON \
  -DLLVM_ENABLE_RUNTIMES="libcxxabi;libcxx" -DCXX_SUPPORTS_CXX11=ON \
  -DLIBCXX_ENABLE_THREADS=ON -DLIBCXX_HAS_PTHREAD_API=ON -DLIBCXX_HAS_EXTERNAL_THREAD_API=OFF \
  -DLIBCXX_BUILD_EXTERNAL_THREAD_LIBRARY=OFF -DLIBCXX_HAS_WIN32_THREAD_API=OFF \
  -DLIBCXX_ENABLE_SHARED=OFF -DLIBCXX_ENABLE_EXCEPTIONS=ON -DLIBCXX_ENABLE_FILESYSTEM=ON \
  -DLIBCXX_ENABLE_ABI_LINKER_SCRIPT=OFF -DLIBCXX_CXX_ABI=libcxxabi \
  -DLIBCXX_CXX_ABI_INCLUDE_PATHS="$SRC/libcxxabi/include" -DLIBCXX_HAS_MUSL_LIBC=ON \
  -DLIBCXX_ABI_VERSION=2 -DLIBCXX_INCLUDE_TESTS=OFF -DLIBCXX_INCLUDE_BENCHMARKS=OFF \
  -DLIBCXXABI_ENABLE_EXCEPTIONS=ON -DLIBCXXABI_ENABLE_SHARED=OFF -DLIBCXXABI_SILENT_TERMINATE=OFF \
  -DLIBCXXABI_ENABLE_THREADS=ON -DLIBCXXABI_HAS_PTHREAD_API=ON -DLIBCXXABI_HAS_EXTERNAL_THREAD_API=OFF \
  -DLIBCXXABI_BUILD_EXTERNAL_THREAD_LIBRARY=OFF -DLIBCXXABI_HAS_WIN32_THREAD_API=OFF \
  -DLIBCXXABI_USE_LLVM_UNWINDER=OFF -DLIBCXXABI_INCLUDE_TESTS=OFF >/dev/null
$NICE ninja -C build-eh -j"$JOBS" cxx_static cxxabi_static cxx_experimental --quiet
if ! diff -q build-eh/include/c++/v1/__config_site \
    "$WSDK/share/wasi-sysroot/include/wasm32-wasip1/c++/v1/__config_site" >/dev/null; then
  diff build-eh/include/c++/v1/__config_site "$WSDK/share/wasi-sysroot/include/wasm32-wasip1/c++/v1/__config_site" >&2
  die "the exception-enabled libc++'s __config_site differs from wasi-sdk's (above)"
fi
for lib in libc++.a libc++abi.a libc++experimental.a; do
  "$WSDK/bin/llvm-strip" --strip-debug -o "$EH/lib/$lib" "build-eh/lib/$lib"
done

step "libunwind (Unwind-wasm.c) and yukibana-uncaught.o"
# The rest of libunwind walks native stacks and does not build for wasm;
# with wasm exception handling the engine unwinds, and this file is all
# libc++abi needs.
mkdir -p build-eh/unwind
$NICE "$CC" "${target[@]}" "${eh[@]}" -O2 -DNDEBUG -I"$SRC/libunwind/include" -I"$SRC/libunwind/src" \
  -D_LIBUNWIND_IS_NATIVE_ONLY -D_LIBUNWIND_HIDE_SYMBOLS -c "$SRC/libunwind/src/Unwind-wasm.c" -o build-eh/unwind/Unwind-wasm.o
rm -f "$EH/lib/libunwind.a"
"$WSDK/bin/llvm-ar" rcs "$EH/lib/libunwind.a" build-eh/unwind/Unwind-wasm.o
$NICE "$WSDK/bin/clang++" "${target[@]}" "${eh[@]}" -O2 -c "$HERE/src/uncaught.cpp" -o "$EH/lib/yukibana-uncaught.o"

step "GoogleTest $GTEST_VERSION"
# Without pthreads (wasm32-wasip1 has none) and without gMock. libc++'s fast
# hardening, as the runner compiles C++ with it. No stream redirection
# (CaptureStdout, death tests): it needs dup and dup2, which WASI has not.
# _WASI_EMULATED_SIGNAL only lets gtest.cc include <csignal>; nothing in
# GoogleTest calls signal() or raise() here (checked with llvm-nm).
# -ffile-prefix-map: __FILE__ is printed ("Running main() from
# googletest/src/gtest_main.cc"), and is not to name this machine's cache.
$NICE cmake -S "googletest-$GTEST_VERSION" -B build-gtest -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE="$WSDK/share/cmake/wasi-sdk-p1.cmake" -DWASI_SDK_PREFIX="$WSDK" \
  -DCMAKE_SYSROOT="$WSDK/share/wasi-sysroot" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_FLAGS="$EHFLAGS -D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_FAST \
    -DGTEST_HAS_STREAM_REDIRECTION=0 -D_WASI_EMULATED_SIGNAL -ffile-prefix-map=$CACHE/googletest-$GTEST_VERSION/=" \
  -DCMAKE_CXX_FLAGS_RELEASE="-O2 -DNDEBUG" \
  -DBUILD_GMOCK=OFF -DINSTALL_GTEST=OFF -Dgtest_disable_pthreads=ON >/dev/null
$NICE ninja -C build-gtest -j"$JOBS" gtest gtest_main --quiet
for lib in libgtest.a libgtest_main.a; do
  "$WSDK/bin/llvm-strip" --strip-debug -o "$EH/lib/$lib" "build-gtest/lib/$lib"
done
cp -r "googletest-$GTEST_VERSION/googletest/include/gtest" "$EH/include/"
cp "googletest-$GTEST_VERSION/LICENSE" "$EH/LICENSE-googletest.txt"

rm -rf build-eh build-gtest "googletest-$GTEST_VERSION"
echo "$stamp" > "$EH/.built"
ls -la "$EH/lib"
