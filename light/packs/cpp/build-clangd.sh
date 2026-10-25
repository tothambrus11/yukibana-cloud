#!/usr/bin/env bash
# Builds clangd (LLVM 21.1.8) for WebAssembly with the pack's Emscripten, the
# compilers unit's first step (toolchains/compilers/toolchain.sh), into $OUT:
#
#   clangd.js       Emscripten's glue (an ES module server.js imports)
#   clangd.wasm     clangd itself, with threads (Web Workers; needs cross-origin isolation)
#   LICENSE-llvm.txt
#
# with .gz and .br siblings of the first two. On the way it prepares what
# build-runner.sh and build-cross.sh build on: the LLVM source tree with
# patches/clangd-browser.patch ($CACHE/llvm-project-*.src) and the native
# table generators ($CACHE/build-native). server.js, the worker that loads
# clangd, is the pack's glue (glue.sh), and sysroot.tar.gz, the headers
# clangd parses with, the libs unit's (build-sysroot.sh).
#
# Idempotent: each reused tree records what made it (build-lib.sh,
# keep_tree), so a step is only checked by ninja when its inputs are the
# same. Needs clang, cmake, ninja and lld on the host
# (toolchains/compilers/deps.apt), and the emsdk unit at $DEP_EMSDK. Most of
# the time is clangd itself: about an hour at -j3 on this machine (README).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=toolchains/compilers/pins.sh
source "$HERE/toolchains/compilers/pins.sh"
# shellcheck source-path=SCRIPTDIR source=build-lib.sh
source "$HERE/build-lib.sh"
# shellcheck source-path=SCRIPTDIR source=llvm-lib.sh
source "$HERE/llvm-lib.sh"
: "${OUT:?OUT is the toolchain directory of the compilers unit (pack-toolchain.sh sets it)}"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp"
JOBS=${JOBS:-3}
NICE="nice -n 10"
SRC="$CACHE/llvm-project-$LLVM_VERSION.src"
mkdir -p "$CACHE" "$OUT"
cd "$CACHE"
emsdk_use

step "sources"
fetch "https://github.com/llvm/llvm-project/releases/download/llvmorg-$LLVM_VERSION/llvm-project-$LLVM_VERSION.src.tar.xz" \
  "$LLVM_SHA256" "llvm-project-$LLVM_VERSION.src.tar.xz"
# .patched holds a SHA-256 of the tarball's pin and the patch: another
# tarball or patch means a fresh tree. tar keeps the release's timestamps, so
# each build tree that compiles it recompiles what the old or the new patch
# touched, and nothing else (follow_patch, build-lib.sh).
patch_sha=$({ echo "$LLVM_SHA256"; cat "$HERE/patches/clangd-browser.patch"; } | sha256sum | cut -d' ' -f1)
if [ "$(cat "$SRC/.patched" 2>/dev/null)" != "$patch_sha" ]; then
  rm -rf "$SRC"
  # Only the parts the compilers are made of. The runtimes and the headers
  # the libs unit needs, it extracts from the same tarball itself.
  tar xJf "llvm-project-$LLVM_VERSION.src.tar.xz" \
    "llvm-project-$LLVM_VERSION.src"/{llvm,clang,clang-tools-extra,cmake,third-party}
  # Input from the embedding Worker, and config files never cached; see the patch.
  patch -d "$SRC" -p1 < "$HERE/patches/clangd-browser.patch"
  echo "$patch_sha" > "$SRC/.patched"
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
# changed patch) is what the tree records (llvm-lib.sh, llvm_made_by).
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

step "clangd into the toolchain"
cp build-wasm/bin/clangd.wasm "$OUT/clangd.wasm"
cp build-wasm/bin/clangd.js "$OUT/clangd.js"
cp "$SRC/clang-tools-extra/LICENSE.TXT" "$OUT/LICENSE-llvm.txt" 2>/dev/null || cp "$SRC/llvm/LICENSE.TXT" "$OUT/LICENSE-llvm.txt"
node "$HERE/compress.mjs" "$OUT/clangd.js" "$OUT/clangd.wasm"
ls -la "$OUT"/clangd.*
