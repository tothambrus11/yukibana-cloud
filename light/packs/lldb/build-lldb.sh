# shellcheck shell=bash
# The lldb unit's build, sourced by toolchains/lldb/toolchain.sh after its
# pins, lib.sh and emsdk_use, with CACHE and OUT set. Each step keeps its
# result in $CACHE and is skipped when that result is there and was made
# from the same inputs.
#
#   1. LLVM_VERSION's source tarball, unpacked once; its lldb/ unpacked
#      again and patched whenever patches/lldb-browser.patch changes.
#   2. The native tablegens (llvm, clang, lldb, llvm-min), which the
#      WebAssembly build runs on the host.
#   3. libxml2, for Emscripten (static, threads, nothing optional).
#   4. lldb-dap for Emscripten: clang and lldb, the WebAssembly target only,
#      no Python, Lua, libedit or curses. One module Web Worker program
#      (src/debugger.js loads it): its main runs on a pthread
#      (PROXY_TO_PTHREAD), so its MainLoop may block in poll() while the
#      worker's own thread delivers the page's DAP messages to /dev/dap.
#
# lldb-dap.wasm's size is reported; it is over the 25 MiB a static asset
# may be, and deploy/prepare.mjs puts it in R2.

JOBS="${JOBS:-$(nproc)}"
NICE="${NICE:-nice -n 10}"
SRC="$CACHE/llvm-project-$LLVM_VERSION.src"
TARBALL="$CACHE/llvm-project-$LLVM_VERSION.src.tar.xz"
PATCH="$PACK/patches/lldb-browser.patch"

step "LLVM $LLVM_VERSION sources"
fetch "https://github.com/llvm/llvm-project/releases/download/llvmorg-$LLVM_VERSION/llvm-project-$LLVM_VERSION.src.tar.xz" "$LLVM_SHA256" "$TARBALL"
if [ ! -f "$SRC/.unpacked" ]; then
  rm -rf "$SRC"
  tar -C "$CACHE" -xJf "$TARBALL"
  touch "$SRC/.unpacked"
fi
patch_sum="$(sha256sum "$PATCH" | cut -d' ' -f1)"
if [ "$(cat "$SRC/.patched" 2>/dev/null)" != "$patch_sum" ]; then
  # Only lldb/ is patched, so only it is unpacked again: the rest keeps its
  # mtimes and is not recompiled.
  rm -rf "$SRC/lldb" "$SRC/.patched"
  tar -C "$CACHE" -xJf "$TARBALL" "llvm-project-$LLVM_VERSION.src/lldb"
  patch -d "$SRC" -p1 --forward --quiet < "$PATCH" || die "patches/lldb-browser.patch does not apply to LLVM $LLVM_VERSION"
  echo "$patch_sum" > "$SRC/.patched"
fi

step "Native tablegens"
NATIVE="$CACHE/build-native"
if [ ! -f "$NATIVE/build.ninja" ]; then
  cmake -G Ninja -S "$SRC/llvm" -B "$NATIVE" -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
    -DLLVM_ENABLE_PROJECTS="clang;lldb" -DLLVM_TARGETS_TO_BUILD=WebAssembly \
    -DLLDB_ENABLE_PYTHON=OFF -DLLDB_ENABLE_LUA=OFF -DLLDB_ENABLE_LIBEDIT=OFF -DLLDB_ENABLE_CURSES=OFF -DLLDB_ENABLE_LIBXML2=OFF \
    -DLLDB_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_TESTS=OFF -DCLANG_INCLUDE_TESTS=OFF -DLLVM_ENABLE_ZSTD=OFF -DLLVM_ENABLE_ZLIB=OFF >"$CACHE/cmake-native.log" ||
    die "configuring the native tablegens failed: $CACHE/cmake-native.log"
fi
$NICE ninja -C "$NATIVE" -j "$JOBS" llvm-tblgen clang-tblgen lldb-tblgen llvm-min-tblgen
N="$NATIVE/bin"

step "libxml2 $LIBXML2_VERSION"
XML="$CACHE/libxml2-wasm"
if [ "$(cat "$XML/.made-by" 2>/dev/null)" != "$LIBXML2_VERSION $EMSDK_VERSION" ]; then
  fetch "https://download.gnome.org/sources/libxml2/${LIBXML2_VERSION%.*}/libxml2-$LIBXML2_VERSION.tar.xz" "$LIBXML2_SHA256" "$CACHE/libxml2-$LIBXML2_VERSION.tar.xz"
  rm -rf "$CACHE/libxml2-$LIBXML2_VERSION" "$CACHE/build-libxml2" "$XML"
  tar -C "$CACHE" -xJf "$CACHE/libxml2-$LIBXML2_VERSION.tar.xz"
  emcmake cmake -G Ninja -S "$CACHE/libxml2-$LIBXML2_VERSION" -B "$CACHE/build-libxml2" -DCMAKE_BUILD_TYPE=MinSizeRel -DCMAKE_C_FLAGS=-pthread \
    -DBUILD_SHARED_LIBS=OFF -DLIBXML2_WITH_PYTHON=OFF -DLIBXML2_WITH_ZLIB=OFF -DLIBXML2_WITH_LZMA=OFF -DLIBXML2_WITH_ICONV=OFF -DLIBXML2_WITH_ICU=OFF \
    -DLIBXML2_WITH_PROGRAMS=OFF -DLIBXML2_WITH_TESTS=OFF -DLIBXML2_WITH_HTTP=OFF -DLIBXML2_WITH_MODULES=OFF -DLIBXML2_WITH_THREADS=ON \
    -DCMAKE_INSTALL_PREFIX="$XML" >"$CACHE/cmake-libxml2.log" || die "configuring libxml2 failed: $CACHE/cmake-libxml2.log"
  ninja -C "$CACHE/build-libxml2" install >/dev/null
  echo "$LIBXML2_VERSION $EMSDK_VERSION" > "$XML/.made-by"
fi

step "lldb-dap for WebAssembly"
WASM="$CACHE/build-wasm"
# What the program is: a module worker's ES module factory (createLLDB),
# main on a pthread, a file system the worker fills, memory that grows to
# 2 GiB (a C++ program's DWARF and LLDB's clang ASTs of it), and the exports
# src/debugger.js reads: FS, callMain and HEAPU8 (the shared memory the
# channel is in). yukibana_debug_channel (where in it) exports itself
# (EMSCRIPTEN_KEEPALIVE): named here, it would be required of every program
# the build links, lldb-argdumper too, and only lldb-dap has it.
LDF="-pthread -sPROXY_TO_PTHREAD -sPTHREAD_POOL_SIZE=8 -sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createLLDB -sENVIRONMENT=worker -sINVOKE_RUN=0 -sEXIT_RUNTIME=1"
LDF+=" -sINCOMING_MODULE_JS_API=wasmBinary,locateFile,print,printErr,onExit -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=FS,callMain,HEAPU8 -sEXPORTED_FUNCTIONS=_main,_malloc,_free"
LDF+=" -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=128MB -sMAXIMUM_MEMORY=2GB -sSTACK_SIZE=8MB -sDEFAULT_PTHREAD_STACK_SIZE=8MB"
configured="$LLVM_VERSION $EMSDK_VERSION $LDF"
if [ "$(cat "$WASM/.configured" 2>/dev/null)" != "$configured" ]; then
  emcmake cmake -G Ninja -S "$SRC/llvm" -B "$WASM" -DCMAKE_BUILD_TYPE=MinSizeRel \
    -DCMAKE_EXE_LINKER_FLAGS="$LDF" -DCMAKE_EXE_LINKER_FLAGS_MINSIZEREL=-Oz -DCMAKE_C_FLAGS=-pthread -DCMAKE_CXX_FLAGS=-pthread \
    -DLLVM_ENABLE_PROJECTS="clang;lldb" -DLLVM_TARGETS_TO_BUILD=WebAssembly -DLLVM_HOST_TRIPLE=wasm32-unknown-emscripten -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-unknown-wasi \
    -DLLVM_NATIVE_TOOL_DIR="$N" -DLLVM_TABLEGEN="$N/llvm-tblgen" -DCLANG_TABLEGEN="$N/clang-tblgen" -DLLDB_TABLEGEN="$N/lldb-tblgen" -DLLVM_MIN_TABLEGEN="$N/llvm-min-tblgen" \
    -DLLVM_ENABLE_THREADS=ON -DLLVM_ENABLE_PIC=OFF -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF -DLLVM_ENABLE_LIBXML2=OFF -DLLVM_ENABLE_LIBEDIT=OFF -DLLVM_ENABLE_LIBPFM=OFF \
    -DLLVM_ENABLE_BACKTRACES=OFF -DLLVM_ENABLE_CRASH_OVERRIDES=OFF -DLLVM_ENABLE_UNWIND_TABLES=OFF -DLLVM_ENABLE_PLUGINS=OFF -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF \
    -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_UTILS=OFF -DLLVM_BUILD_UTILS=OFF -DLLVM_INCLUDE_DOCS=OFF \
    -DCLANG_ENABLE_STATIC_ANALYZER=OFF -DCLANG_ENABLE_OBJC_REWRITER=OFF -DCLANG_PLUGIN_SUPPORT=OFF -DCLANG_INCLUDE_TESTS=OFF -DCLANG_INCLUDE_DOCS=OFF -DCLANG_BUILD_TOOLS=OFF \
    -DLLDB_ENABLE_PYTHON=OFF -DLLDB_ENABLE_LUA=OFF -DLLDB_ENABLE_LIBEDIT=OFF -DLLDB_ENABLE_CURSES=OFF -DLLDB_ENABLE_LZMA=OFF -DLLDB_ENABLE_FBSDVMCORE=OFF \
    -DLLDB_ENABLE_LIBXML2=ON -DLIBXML2_INCLUDE_DIR="$XML/include/libxml2" -DLIBXML2_LIBRARY="$XML/lib/libxml2.a" \
    -DLLDB_INCLUDE_TESTS=OFF -DLLDB_INCLUDE_UNITTESTS=OFF -DLLDB_BUILD_FRAMEWORK=OFF -DLLDB_TOOL_DEBUGSERVER=OFF -DLLDB_TOOL_LLDB_SERVER=OFF \
    -DLLDB_CAN_USE_LLDB_SERVER=OFF -DLLDB_CAN_USE_DEBUGSERVER=OFF -DLLDB_ENABLE_SWIG=OFF >"$CACHE/cmake-wasm.log" ||
    die "configuring lldb-dap failed: $CACHE/cmake-wasm.log"
  echo "$configured" > "$WASM/.configured"
fi
$NICE ninja -C "$WASM" -j "$JOBS" bin/lldb-dap.js

cp "$WASM/bin/lldb-dap.js" "$OUT/lldb-dap.js"
cp "$WASM/bin/lldb-dap.wasm" "$OUT/lldb-dap.wasm"
node "$PACK/compress.mjs" "$OUT/lldb-dap.wasm"
cp "$SRC/lldb/LICENSE.TXT" "$OUT/LICENSE-llvm.txt"
cp "$CACHE/libxml2-$LIBXML2_VERSION/Copyright" "$OUT/LICENSE-libxml2.txt"
printf '{"lldb":"%s","libxml2":"%s","emscripten":"%s"}\n' "$LLVM_VERSION" "$LIBXML2_VERSION" "$EMSDK_VERSION" > "$OUT/versions-lldb.json"
