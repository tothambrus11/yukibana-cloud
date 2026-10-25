# shellcheck shell=bash
# What the compilers unit's scripts (build-clangd.sh, build-runner.sh,
# build-cross.sh) share about building LLVM with the pack's Emscripten:
# sourced after build-lib.sh, and named in toolchains/compilers/paths only,
# so an edit here rebuilds the compilers and the units built with them
# (libs), never the VM. Defines functions only.

# llvm_made_by: prints what made a build tree of the LLVM source with the
# pack's Emscripten (clangd's, cc's and cc-cross's: the same lines, so that
# build-cross.sh may still be pointed at cc's tree): the source tarball and
# emsdk_tree_made_by. Both stand behind paths ninja sees as unchanged (the
# CMake cache holds emcc's path, not its version), and the Emscripten's path
# is in the tree's CMake files (emsdk_tree_made_by says why), so it is
# called after emsdk_use. The native table
# generators are not in it: their binaries are inputs of every generated
# file, which ninja regenerates when they change.
llvm_made_by() {
  local emsdk
  # Assigned first: a failure inside printf's argument would be lost.
  emsdk=$(emsdk_tree_made_by) || return 1
  printf 'llvm %s %s\n%s' "$LLVM_VERSION" "$LLVM_SHA256" "$emsdk"
}

# llvm_lld_sources: makes $CACHE/llvm-project-$LLVM_VERSION.src/lld the
# release's lld/ with patches/wasm-ld-only.patch applied, extracting it
# again when its .patched record (the tarball's SHA-256 and the patch's)
# differs. build-runner.sh compiles it into cc.wasm; build-cross.sh needs it
# only to exist, because LLVM's CMake refuses LLVM_ENABLE_PROJECTS=lld
# without llvm/../lld, even with LLVM_EXTERNAL_LLD_SOURCE_DIR set elsewhere,
# and it runs first on a clean machine. Run from $CACHE, after the
# compilers unit's sources step (toolchains/compilers/toolchain.sh).
llvm_lld_sources() {
  local src="$CACHE/llvm-project-$LLVM_VERSION.src" patch="$BUILD_LIB_DIR/patches/wasm-ld-only.patch" want
  want=$({ echo "$LLVM_SHA256"; cat "$patch"; } | sha256sum | cut -d' ' -f1)
  [ "$(cat "$src/lld/.patched" 2>/dev/null)" != "$want" ] || return 0
  rm -rf "$src/lld"
  tar xJf "llvm-project-$LLVM_VERSION.src.tar.xz" "llvm-project-$LLVM_VERSION.src/lld"
  patch -s -d "$src" -p1 < "$patch"
  echo "$want" > "$src/lld/.patched"
}

# llvm_wasm_common_args <array> <environment> <targets> <lld-source-dir>
#     <default-triple> <default-unwindlib>
# sets the array named <array> to the cmake arguments of an Emscripten build
# of clang and lld as one multi-call binary (LLVM's llvm-driver), which
# build-runner.sh (cc.wasm) and build-cross.sh (cc-cross.wasm) both are. The
# five parameters are everything in which the two differ: Emscripten's
# ENVIRONMENT, LLVM_TARGETS_TO_BUILD, the lld source tree, the default target
# triple and the default unwind library (empty for none).
#
# The order and spelling of the arguments are part of the compilers' stamps
# (artifacts/*/STAMP hashes them one per line), so they are kept exactly as
# the two scripts spelled them before they shared this: a reordering, or a
# change in the link flags' whitespace, rebuilds both compilers.
#
# The link flags: an ES module factory (createCC) with a file system and
# callMain, memory that grows to 4 GB, and 8 MB of stack, because clang's
# parser recurses deeply. No threads, so compiling needs no SharedArrayBuffer;
# the driver runs cc1 in-process (CLANG_SPAWN_CC1 off, the default) and the
# link is a second call, because a browser cannot spawn the linker. The
# native table generators are build-clangd.sh's ($CACHE/build-native).
llvm_wasm_common_args() {
  local -n args=$1
  local ldflags="-sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createCC -sENVIRONMENT=$2 \
  -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=FS,callMain \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=8MB"
  # shellcheck disable=SC2034 # args is a nameref to the caller's array
  args=(-G Ninja
    -DCMAKE_BUILD_TYPE=MinSizeRel -DCMAKE_EXE_LINKER_FLAGS="$ldflags"
    -DCMAKE_EXE_LINKER_FLAGS_MINSIZEREL="-Oz"
    -DLLVM_ENABLE_PROJECTS="clang;lld" -DLLVM_TARGETS_TO_BUILD="$3"
    -DLLVM_EXTERNAL_LLD_SOURCE_DIR="$4"
    -DLLVM_TOOL_LLVM_DRIVER_BUILD=ON -DLLVM_DISTRIBUTION_COMPONENTS="clang;lld"
    -DLLVM_HOST_TRIPLE=wasm32-unknown-emscripten -DLLVM_DEFAULT_TARGET_TRIPLE="$5"
    -DCLANG_DEFAULT_CXX_STDLIB=libc++ -DCLANG_DEFAULT_RTLIB=compiler-rt -DCLANG_DEFAULT_UNWINDLIB="$6"
    -DCLANG_DEFAULT_LINKER=lld
    -DLLVM_NATIVE_TOOL_DIR="$CACHE/build-native/bin"
    -DLLVM_TABLEGEN="$CACHE/build-native/bin/llvm-tblgen" -DCLANG_TABLEGEN="$CACHE/build-native/bin/clang-tblgen"
    -DLLVM_ENABLE_THREADS=OFF -DLLVM_ENABLE_PIC=OFF -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF
    -DLLVM_ENABLE_LIBXML2=OFF -DLLVM_ENABLE_LIBEDIT=OFF -DLLVM_ENABLE_LIBPFM=OFF -DLLVM_ENABLE_CURL=OFF
    -DLLVM_ENABLE_BACKTRACES=OFF -DLLVM_ENABLE_CRASH_OVERRIDES=OFF -DLLVM_ENABLE_UNWIND_TABLES=OFF
    -DLLVM_ENABLE_PLUGINS=OFF -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF
    -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_UTILS=OFF -DLLVM_BUILD_UTILS=OFF -DLLVM_INCLUDE_DOCS=OFF
    -DCLANG_ENABLE_STATIC_ANALYZER=OFF -DCLANG_ENABLE_OBJC_REWRITER=OFF -DCLANG_PLUGIN_SUPPORT=OFF
    -DCLANG_INCLUDE_TESTS=OFF -DCLANG_INCLUDE_DOCS=OFF)
}
