#!/usr/bin/env bash
# The runner's libraries, the libs unit's last step
# (toolchains/libs/toolchain.sh runs it after build-sysroot.sh and
# build-targets.sh), into $OUT, that unit's toolchain: the WASI sysroot
# (wasi-sysroot.tar.gz), the test frameworks' libraries (gtest.tar,
# catch2.tar, doctest.tar) and RapidCheck's (rapidcheck.tar), the Linux
# targets' GoogleTest and RapidCheck (build-test-frameworks-linux.sh), the
# sanitizer runtimes (build-sanitizers.sh), their licences, and the
# archives' .gz/.br siblings. runner.js and the other workers that are
# bundled with these files' sizes are the pack's glue (glue.sh), and the
# compilers they load are the compilers unit's: nothing here depends on a
# worker's source, so an edit to runner.js rebuilds no library.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=toolchains/libs/pins.sh
source "$HERE/toolchains/libs/pins.sh"
# shellcheck source-path=SCRIPTDIR source=build-lib.sh
source "$HERE/build-lib.sh"
# shellcheck source-path=SCRIPTDIR source=libs-lib.sh
source "$HERE/libs-lib.sh"
: "${OUT:?OUT is the toolchain directory of the libs unit (pack-toolchain.sh sets it)}"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp"
need_unit compilers   # LLVM_VERSION, the headers' version checked below
need_unit emsdk
BIN="$DEP_EMSDK/build-only/emsdk/upstream/bin"
mkdir -p "$CACHE/wasi" "$OUT"
cd "$CACHE/wasi"

# libc++/libc++abi with exceptions, libunwind, GoogleTest (cached after the
# first run; the libs unit has normally run it already).
"$HERE/build-cxx-runtime.sh"
EH="$CACHE/eh"

step "WASI sysroot (wasi-sdk $WASI_SDK_VERSION)"
rel="https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$WASI_SDK_VERSION"
fetch "$rel/wasi-sysroot-$WASI_SDK_VERSION.0.tar.gz" "$WASI_SYSROOT_SHA256" "sysroot-$WASI_SDK_VERSION.tgz"
fetch "$rel/libclang_rt-$WASI_SDK_VERSION.0.tar.gz" "$WASI_RT_SHA256" "clang_rt-$WASI_SDK_VERSION.tgz"
rm -rf x stage && mkdir x stage
tar xzf "sysroot-$WASI_SDK_VERSION.tgz" -C x "wasi-sysroot-$WASI_SDK_VERSION.0/include/wasm32-wasip1" \
  "wasi-sysroot-$WASI_SDK_VERSION.0/lib/wasm32-wasip1"
tar xzf "clang_rt-$WASI_SDK_VERSION.tgz" -C x "libclang_rt-$WASI_SDK_VERSION.0/wasm32-unknown-wasip1"
src="x/wasi-sysroot-$WASI_SDK_VERSION.0"
# Laid out as clang's WASI driver expects with --sysroot=/wasi:
#   /wasi/include/wasm32-wasip1          wasi-libc's headers
#   /wasi/include/wasm32-wasip1/c++/v1   libc++: only the files that differ
#       from the language server's copy in sysroot.tar.gz (its __config_site,
#       and cxxabi.h, which that one has no use for); runner.js lays this
#       tree over that one. The rest is byte-identical apart from __config's
#       version number (WASI_SDK_LLVM_VERSION here, LLVM_VERSION there),
#       checked below.
#   /wasi/lib/wasm32-wasip1              crt1, libc, ... from wasi-sdk; libc++,
#       libc++abi, libunwind and yukibana-uncaught.o with exceptions, from
#       build-cxx-runtime.sh
#   /usr/lib/clang/21/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a
#       compiler-rt, where -resource-dir=/usr/lib/clang/21 finds it
mkdir -p stage/wasi/include stage/wasi/lib/wasm32-wasip1 stage/usr/lib/clang/21/lib/wasm32-unknown-wasip1
cp -r "$src/include/wasm32-wasip1" stage/wasi/include/
cxx="stage/wasi/include/wasm32-wasip1/c++/v1"
differ=$(diff -rq "$cxx" "$CACHE/cxx-headers/include/c++/v1" | sort || true)
expected="Files $cxx/__config and $CACHE/cxx-headers/include/c++/v1/__config differ
Files $cxx/__config_site and $CACHE/cxx-headers/include/c++/v1/__config_site differ
Only in $cxx: __cxxabi_config.h
Only in $cxx: cxxabi.h"
if [ "$differ" != "$expected" ]; then
  echo "$differ" >&2
  die "libc++ headers of wasi-sdk $WASI_SDK_VERSION and of sysroot.tar.gz differ more than expected (above)"
fi
# _LIBCPP_VERSION spells 21.1.4 as 210104.
libcpp_version() { local major minor patch; IFS=. read -r major minor patch <<< "$1"; printf '%d%02d%02d' "$major" "$minor" "$patch"; }
diff <(sed "s/$(libcpp_version "$WASI_SDK_LLVM_VERSION")/$(libcpp_version "$LLVM_VERSION")/" "$cxx/__config") \
  "$CACHE/cxx-headers/include/c++/v1/__config" >/dev/null || die "__config differs in more than the version number"
find "$cxx" -type f ! -name __config_site ! -name cxxabi.h ! -name __cxxabi_config.h -delete
find "$cxx" -type d -empty -delete
# Static libraries only (nothing loads a .so), without the LTO bitcode copies;
# debug info stripped (libc++.a goes from 7.5 MB to 1.4 MB).
for f in "$src"/lib/wasm32-wasip1/*.a "$src"/lib/wasm32-wasip1/crt1*.o; do
  "$BIN/llvm-strip" --strip-debug -o "stage/wasi/lib/wasm32-wasip1/$(basename "$f")" "$f"
done
# C++ exceptions: wasi-sdk's libc++ and libc++abi are built without them
# (no __cxa_throw), so they are replaced by the same libraries built with
# WebAssembly exception handling (build-cxx-runtime.sh; same configuration
# and __config_site otherwise, checked there).
for f in libc++.a libc++abi.a libc++experimental.a libunwind.a yukibana-uncaught.o; do
  cp "$EH/lib/$f" stage/wasi/lib/wasm32-wasip1/
done
"$BIN/llvm-strip" --strip-debug \
  -o stage/usr/lib/clang/21/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a \
  "x/libclang_rt-$WASI_SDK_VERSION.0/wasm32-unknown-wasip1/libclang_rt.builtins.a"
# The sysroot tarball carries no licence; its VERSION file names wasi-libc
# commit WASI_LIBC_COMMIT, whose LICENSE this is (libc++ is under
# LICENSE-llvm.txt).
fetch "https://raw.githubusercontent.com/WebAssembly/wasi-libc/$WASI_LIBC_COMMIT/LICENSE" \
  "$WASI_LIBC_LICENSE_SHA256" LICENSE-wasi-libc.txt
cp LICENSE-wasi-libc.txt "$OUT/LICENSE-wasi-libc.txt"
reproducible_tar -C stage -c wasi usr | gzip -9n > "$OUT/wasi-sysroot.tar.gz"
rm -rf x stage

step "test framework libraries (gtest.tar, catch2.tar, doctest.tar, rapidcheck.tar)"
# One archive per framework, fetched by runner.js only to build tests (or a
# program) that include that framework, so a project downloads the one it
# uses. The headers are in sysroot.tar.gz (build-sysroot.sh), which both workers
# download anyway. Plain tar: its .br/.gz siblings are what travels.
"$HERE/build-test-frameworks.sh"
TESTFW="$CACHE/testfw"
pack_libs() { # archive dir libs...
  local archive=$1 dir=$2; shift 2
  rm -rf stage && mkdir -p stage/wasi/lib/wasm32-wasip1
  for lib in "$@"; do cp "$dir/lib/$lib" stage/wasi/lib/wasm32-wasip1/; done
  reproducible_tar -C stage -c wasi > "$OUT/$archive"
  rm -rf stage
}
pack_libs gtest.tar "$EH" libgtest.a libgtest_main.a
pack_libs catch2.tar "$TESTFW" libCatch2.a libCatch2Main.a
pack_libs doctest.tar "$TESTFW" libdoctest_main.a
# RapidCheck goes with any of the three (or a main of the project's own), so
# it is an archive of its own, fetched for a project that includes it.
pack_libs rapidcheck.tar "$TESTFW" librapidcheck.a
cp "$EH/LICENSE-googletest.txt" "$OUT/LICENSE-googletest.txt"
cp "$TESTFW/LICENSE-catch2.txt" "$OUT/LICENSE-catch2.txt"
cp "$TESTFW/LICENSE-doctest.txt" "$OUT/LICENSE-doctest.txt"
cp "$TESTFW/LICENSE-rapidcheck.txt" "$OUT/LICENSE-rapidcheck.txt"

step "GoogleTest and RapidCheck for the Linux targets"
# targets/<arch>/gtest.tar and rapidcheck.tar, compiled with the compilers
# unit's cc-cross against the headers build-sysroot.sh and build-targets.sh
# wrote (build-test-frameworks-linux.sh).
"$HERE/build-test-frameworks-linux.sh"

step "sanitizer runtimes (asan.tar, ubsan.tar, targets/<arch>/asan.tar, ubsan.tar)"
# Fetched by runner.js only for a project that asks for a sanitizer
# (README, "Sanitizers"); compressed by the script itself.
"$HERE/build-sanitizers.sh"

step "compress"
# Brotli at quality 11 takes a while: only when the file changed.
compress=()
for f in "$OUT"/{gtest,catch2,doctest,rapidcheck}.tar "$OUT"/targets/*/gtest.tar "$OUT"/targets/*/rapidcheck.tar; do
  if [ ! -f "$f.br" ] || [ ! -f "$f.gz" ] || [ "$f" -nt "$f.br" ]; then compress+=("$f"); fi
done
[ ${#compress[@]} -eq 0 ] || node "$HERE/compress.mjs" "${compress[@]}"
ls -la "$OUT"/wasi-sysroot.tar.gz "$OUT"/{gtest,catch2,doctest,rapidcheck}.tar*
