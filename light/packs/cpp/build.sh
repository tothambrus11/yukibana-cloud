#!/usr/bin/env bash
# Builds the C/C++ pack (clangd from LLVM 21.1.8, compiled with Emscripten)
# into ../../app/static/packs/cpp/:
#
#   server.js       the module Worker: transport, file mirroring, loader
#   clangd.js       Emscripten's glue (an ES module server.js imports)
#   clangd.wasm     clangd itself, with threads (Web Workers; needs cross-origin isolation)
#   sysroot.tar.gz  musl and libc++ headers, clang's freestanding headers,
#                   GoogleTest's, Catch2's, doctest's and RapidCheck's headers
#
# then the Linux targets' compiler and libraries (build-cross.sh,
# build-targets.sh; README, "Targets") and the demangler (build-demangle.sh;
# README, "Compiler output views"), and then, through build-runner.sh, what
# runs a project (README, "Running"):
#
#   runner.js            the module Worker the app starts on Run
#   cc.js, cc.wasm       clang 21.1.8 + wasm-ld, one binary, WebAssembly only
#   wasi-sysroot.tar.gz  wasi-libc (wasi-sdk 30), libc++ with exceptions, compiler-rt
#   gtest.tar            GoogleTest's libraries, fetched by runner.js for tests
#   catch2.tar           Catch2's libraries, the same for tests that use Catch2
#   doctest.tar          doctest's implementation and main, for doctest's tests
#   rapidcheck.tar       RapidCheck's library, for a project that includes it
#   explorer.js          the compiler output views' worker (LLVM IR, assembly)
#   cc-cross.js, .wasm   clang 21.1.8 + ld.lld (ELF), x86_64/aarch64/riscv64 Linux
#   runner-linux.js      linking and running for a Linux target (with vm.js)
#   targets/<arch>/      include.tar, lib.tar: a Linux target's musl and LLVM runtimes
#   demangle.js, .wasm   llvm::demangle, for the views
#   sanitizer.js         a sanitized program's host half and report symbolizer
#   asan.tar, ubsan.tar  the sanitizer runtimes for WebAssembly, and
#                        targets/<arch>/ the same for Linux (build-sanitizers.sh;
#                        README, "Sanitizers"), fetched only for a project
#                        whose compile_flags.txt asks for a sanitizer
#
# Idempotent: each step is skipped, or only checked by ninja, when its
# output is in the cache ($PACK_CACHE/cpp, default
# ~/.cache/yukibana-packs/cpp) and was made from the same inputs: every
# reused tree records what made it (build-lib.sh, keep_tree), and every
# skipped step has a stamp of its inputs (README, "Build", lists them).
# Needs a Linux host with clang, cmake, ninja, git, curl, python3, make and
# node 22. Emscripten is fetched into the cache. Most of the time is the
# clangd step: about an hour at -j3 on this machine (see README).
#
#   JOBS=3 ./build.sh
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

step "sources"
fetch "https://github.com/llvm/llvm-project/releases/download/llvmorg-$LLVM_VERSION/llvm-project-$LLVM_VERSION.src.tar.xz" \
  "$LLVM_SHA256" "llvm-project-$LLVM_VERSION.src.tar.xz"
fetch "https://musl.libc.org/releases/musl-$MUSL_VERSION.tar.gz" "$MUSL_SHA256" "musl-$MUSL_VERSION.tar.gz"
# .patched holds a SHA-256 of the tarball's pin and the patch: another
# tarball or patch means a fresh tree. tar keeps the release's timestamps, so
# each build tree that compiles it recompiles what the old or the new patch
# touched, and nothing else (follow_patch, build-lib.sh).
patch_sha=$({ echo "$LLVM_SHA256"; cat "$HERE/patches/clangd-browser.patch"; } | sha256sum | cut -d' ' -f1)
if [ "$(cat "$SRC/.patched" 2>/dev/null)" != "$patch_sha" ]; then
  rm -rf "$SRC"
  # Only the parts clangd and the libc++ headers are made of (1.9 of 2.4 GB).
  tar xJf "llvm-project-$LLVM_VERSION.src.tar.xz" \
    "llvm-project-$LLVM_VERSION.src"/{llvm,clang,clang-tools-extra,cmake,third-party,libcxx,libcxxabi,libc,runtimes}
  # Input from the embedding Worker, and config files never cached; see the patch.
  patch -d "$SRC" -p1 < "$HERE/patches/clangd-browser.patch"
  echo "$patch_sha" > "$SRC/.patched"
fi
# musl's tree: its headers go into sysroot.tar.gz here, and vm/build-qemu-user.sh
# takes them from it too.
keep_tree "musl-$MUSL_VERSION" "musl $MUSL_SHA256"
[ -f "musl-$MUSL_VERSION/Makefile" ] || tar xzf "musl-$MUSL_VERSION.tar.gz" -C "musl-$MUSL_VERSION" --strip-components=1
if [ ! -x emsdk/upstream/emscripten/emcc ] || [ "$(git -C emsdk rev-parse HEAD 2>/dev/null)" != "$EMSDK_COMMIT" ]; then
  rm -rf emsdk
  git clone --quiet --depth 1 --branch "$EMSDK_VERSION" https://github.com/emscripten-core/emsdk
  [ "$(git -C emsdk rev-parse HEAD)" = "$EMSDK_COMMIT" ] || die "emsdk $EMSDK_VERSION is not commit $EMSDK_COMMIT"
  mkdir -p emsdk/downloads
  fetch "https://storage.googleapis.com/webassembly/emscripten-releases-builds/linux/$EMSDK_RELEASE/wasm-binaries.tar.xz" \
    "$EMSDK_BINARIES_SHA256" "emsdk/downloads/$EMSDK_RELEASE-wasm-binaries.tar.xz"
  fetch "https://storage.googleapis.com/webassembly/emscripten-releases-builds/deps/$EMSDK_NODE" \
    "$EMSDK_NODE_SHA256" "emsdk/downloads/$EMSDK_NODE"
  (cd emsdk && EMSDK_KEEP_DOWNLOADS=1 ./emsdk install "$EMSDK_VERSION" >/dev/null && ./emsdk activate "$EMSDK_VERSION" >/dev/null)
  rm -rf emsdk/downloads
fi
# Emscripten's proxying: a synchronous proxied call is signalled before its
# mutex is unlocked, as upstream does from 5.0.5 (the patch says why: clangd
# trapped on "unaligned accesses" about one C++ e2e run in four). Its libc is
# prebuilt in the emsdk's cache, so the multithreaded variants are deleted for
# emcc to rebuild from the patched source on the next link; .proxying-patched
# holds the patch's SHA-256, and a change to it also relinks clangd.
proxying_sha=$(sha256sum < "$HERE/patches/emscripten-proxying-signal-before-unlock.patch" | cut -d' ' -f1)
if [ "$(cat emsdk/.proxying-patched 2>/dev/null)" != "$proxying_sha" ]; then
  p="$HERE/patches/emscripten-proxying-signal-before-unlock.patch"
  patch -d emsdk/upstream/emscripten -p1 -R --dry-run --quiet < "$p" >/dev/null 2>&1 ||
    patch -d emsdk/upstream/emscripten -p1 --quiet < "$p"
  rm -f emsdk/upstream/emscripten/cache/sysroot/lib/wasm32-emscripten/libc-mt*.a
  rm -f build-wasm/bin/clangd.js
  echo "$proxying_sha" > emsdk/.proxying-patched
fi

step "native table generators"
# The wasm build runs these on the host; it cannot run its own.
tools="llvm-tblgen llvm-min-tblgen clang-tblgen clang-tidy-confusable-chars-gen"
native_args=(-G Ninja -DCMAKE_BUILD_TYPE=Release
  -DLLVM_ENABLE_PROJECTS="clang;clang-tools-extra" -DLLVM_TARGETS_TO_BUILD=X86
  -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ -DLLVM_USE_LINKER=lld
  -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF -DLLVM_INCLUDE_EXAMPLES=OFF)
# Configured once, so its arguments are in what made it, and so is the
# host's clang, which ninja sees only by path. ninja runs every time: with
# nothing changed it only checks (it used to be skipped while the last tool
# existed, whatever source or compiler had made it).
keep_tree build-native "$(printf 'llvm %s %s\nhost %s\n' "$LLVM_VERSION" "$LLVM_SHA256" "$(clang --version | head -1)"
  printf '%s\n' "${native_args[@]}")"
follow_patch build-native "$HERE/patches/clangd-browser.patch" "$SRC"
[ -f build-native/build.ninja ] || cmake -S "$SRC/llvm" -B build-native "${native_args[@]}" >/dev/null
# shellcheck disable=SC2086
$NICE ninja -C build-native -j"$JOBS" $tools

step "clangd for WebAssembly"
# shellcheck disable=SC1091
source emsdk/emsdk_env.sh >/dev/null 2>&1
# Threads are Web Workers sharing one memory, so the page must be cross-origin
# isolated (SharedArrayBuffer). main() runs on a thread of its own
# (PROXY_TO_PTHREAD), which leaves the Worker that loaded clangd free to
# receive the client's messages and hand them to it (clangd_input, in the
# patch). Stacks: clang's parser recurses deeply, and Emscripten's default
# 64 KiB overflows on ordinary code.
ldflags="-pthread -sPROXY_TO_PTHREAD -sPTHREAD_POOL_SIZE=4 -sMODULARIZE -sEXPORT_ES6 \
  -sEXPORT_NAME=createClangd -sENVIRONMENT=worker -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 \
  -sEXPORTED_RUNTIME_METHODS=FS,callMain,stringToUTF8,lengthBytesUTF8 -sEXPORTED_FUNCTIONS=_main,_malloc,_free \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=128MB -sMAXIMUM_MEMORY=2GB \
  -sSTACK_SIZE=8MB -sDEFAULT_PTHREAD_STACK_SIZE=8MB"
# Configured on every run: with nothing changed it only rereads the cache,
# and a changed flag (the linker's above, say) reaches the build instead of
# being shadowed by the first run's cache. What configuring cannot show
# (another LLVM tarball, another Emscripten under the same emcc path, a
# changed patch) is what the tree records (build-lib.sh, llvm_made_by).
keep_tree build-wasm "$(llvm_made_by)"
follow_patch build-wasm "$HERE/patches/clangd-browser.patch" "$SRC"
$NICE emcmake cmake -S "$SRC/llvm" -B build-wasm -G Ninja \
    -DCMAKE_BUILD_TYPE=MinSizeRel -DCMAKE_EXE_LINKER_FLAGS="$ldflags" \
    -DCMAKE_C_FLAGS=-pthread -DCMAKE_CXX_FLAGS=-pthread \
    -DCMAKE_EXE_LINKER_FLAGS_MINSIZEREL="-Oz" \
    -DLLVM_ENABLE_PROJECTS="clang;clang-tools-extra" -DLLVM_TARGETS_TO_BUILD=X86 \
    -DLLVM_HOST_TRIPLE=wasm32-unknown-emscripten -DLLVM_DEFAULT_TARGET_TRIPLE=x86_64-linux-musl \
    -DCLANG_DEFAULT_CXX_STDLIB=libc++ -DLLVM_NATIVE_TOOL_DIR="$CACHE/build-native/bin" \
    -DLLVM_TABLEGEN="$CACHE/build-native/bin/llvm-tblgen" -DCLANG_TABLEGEN="$CACHE/build-native/bin/clang-tblgen" \
    -DLLVM_ENABLE_THREADS=ON -DLLVM_ENABLE_PIC=OFF -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF \
    -DLLVM_ENABLE_LIBXML2=OFF -DLLVM_ENABLE_LIBEDIT=OFF -DLLVM_ENABLE_LIBPFM=OFF \
    -DLLVM_ENABLE_BACKTRACES=OFF -DLLVM_ENABLE_CRASH_OVERRIDES=OFF -DLLVM_ENABLE_UNWIND_TABLES=OFF \
    -DLLVM_ENABLE_PLUGINS=OFF -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF \
    -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_UTILS=OFF -DLLVM_BUILD_UTILS=OFF -DLLVM_INCLUDE_DOCS=OFF \
    -DCLANG_ENABLE_CLANGD=ON -DCLANG_ENABLE_STATIC_ANALYZER=OFF -DCLANG_ENABLE_OBJC_REWRITER=OFF \
    -DCLANG_PLUGIN_SUPPORT=OFF -DCLANG_INCLUDE_TESTS=OFF -DCLANG_INCLUDE_DOCS=OFF \
    -DCLANG_TIDY_ENABLE_STATIC_ANALYZER=OFF -DCLANGD_TIDY_CHECKS=OFF -DCLANGD_BUILD_DEXP=OFF \
    -DCLANGD_BUILD_XPC=OFF -DCLANGD_ENABLE_REMOTE=OFF -DCLANGD_MALLOC_TRIM=OFF >/dev/null
$NICE ninja -C build-wasm -j"$JOBS" clangd

step "libc++ headers"
# Configured for musl, as the default target is x86_64-linux-musl; only the
# header step runs, nothing is compiled.
# Installed once per LLVM tarball and these arguments (what made it).
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

# The C++ runtime with exceptions and GoogleTest (build-cxx-runtime.sh), and
# Catch2, doctest and RapidCheck (build-test-frameworks.sh), here because the sysroot
# below takes the frameworks' headers from them; the libraries go to the
# runner (pack-runner.sh).
"$HERE/build-cxx-runtime.sh"
"$HERE/build-test-frameworks.sh"

step "sysroot"
# /usr/include: musl; /usr/include/c++/v1: libc++, where clang's Linux driver
# looks for it in a sysroot of /; /usr/lib/clang/21/include: clang's own
# headers, the freestanding ones and nothing else (the x86 intrinsics are
# 8 MB nobody's homework includes).
stage="$CACHE/sysroot"
rm -rf "$stage" && mkdir -p "$stage/usr/include" "$stage/usr/lib/clang/21/include"
make -s -C "musl-$MUSL_VERSION" ARCH=x86_64 prefix=/usr DESTDIR="$stage" install-headers >/dev/null
cp -r cxx-headers/include/c++ "$stage/usr/include/"
# GoogleTest: #include <gtest/gtest.h> in a test resolves in the editor, and
# runner.js takes the same files from here for its WASI sysroot. It includes
# <cxxabi.h> (to demangle type names) when the library is libc++, so
# libc++abi's two public headers join libc++'s.
cp -r eh/include/gtest "$stage/usr/include/"
# Catch2 (with the catch_user_config.hpp its wasm build generated) and
# doctest, likewise: about 180 KB of the archive between them; RapidCheck
# (rapidcheck.h, rapidcheck/ with its gtest.h and catch.h)
# likewise (README).
cp -r testfw/include/catch2 testfw/include/doctest testfw/include/rapidcheck testfw/include/rapidcheck.h "$stage/usr/include/"
cp "$SRC"/libcxxabi/include/{cxxabi.h,__cxxabi_config.h} "$stage/usr/include/c++/v1/"
hdr="$SRC/clang/lib/Headers"
cp "$hdr"/{float.h,inttypes.h,iso646.h,limits.h,stdalign.h,stdarg.h,stdatomic.h,stdbool.h,stdckdint.h} \
  "$hdr"/{stdcountof.h,stddef.h,stdint.h,stdnoreturn.h,tgmath.h,varargs.h,unwind.h} \
  "$hdr"/__stdarg_*.h "$hdr"/__stddef_*.h "$stage/usr/lib/clang/21/include/"
reproducible_tar -C "$stage" -c usr | gzip -9n > "$OUT/sysroot.tar.gz"

step "pack"
cp build-wasm/bin/clangd.wasm "$OUT/clangd.wasm"
cp build-wasm/bin/clangd.js "$OUT/clangd.js"
npm_deps "$HERE"
# Bundled: it imports src/targets.js (and its targets.json), for the Linux
# targets' headers; clangd.js stays a file of its own.
"$HERE/node_modules/.bin/esbuild" "$HERE/src/server.js" --bundle --external:./clangd.js --outfile="$OUT/server.js" --format=esm --minify \
  --target=es2022 --define:CLANGD_WASM_SIZE="$(stat -c %s "$OUT/clangd.wasm")" \
  --define:SYSROOT_SIZE="$(stat -c %s "$OUT/sysroot.tar.gz")" --log-level=warning
cp "$SRC/clang-tools-extra/clangd/../LICENSE.TXT" "$OUT/LICENSE-llvm.txt" 2>/dev/null || cp "$SRC/llvm/LICENSE.TXT" "$OUT/LICENSE-llvm.txt"
cp "musl-$MUSL_VERSION/COPYRIGHT" "$OUT/LICENSE-musl.txt"
node "$HERE/compress.mjs" "$OUT/server.js" "$OUT/clangd.js" "$OUT/clangd.wasm"
ls -la "$OUT"

step "Linux targets: cc-cross (clang + ld.lld), per-target headers and libraries"
# README, "Targets". Before the runner step, whose pack-runner.sh bundles
# runner.js and explorer.js with these files' sizes and copies cc-cross.
"$HERE/build-cross.sh"
"$HERE/build-targets.sh"

step "demangler for the compiler output views"
"$HERE/build-demangle.sh"

step "runner (clang + wasm-ld, WASI sysroot, runner.js, explorer.js)"
# A separate script so it can run on its own; see README, "Running".
"$HERE/build-runner.sh"

# Running a Linux target's program: QEMU-Wasm, the emulator's build
# (vm/README.md), when it is there.
if [ -x "$HERE/build-vm.sh" ]; then "$HERE/build-vm.sh"; fi
