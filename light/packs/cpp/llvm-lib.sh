# shellcheck shell=bash
# What the scripts that build LLVM with the pack's Emscripten share: the
# compilers unit's (build-clangd.sh, build-runner.sh, build-cross.sh) and
# the tidy unit's (build-clangd-tidy.sh). Sourced after build-lib.sh, and
# named in toolchains/compilers/paths and toolchains/tidy/paths, so an edit
# here rebuilds the compilers, clangd with clang-tidy and the units built
# with them (libs), never the VM. Defines functions only.

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

# llvm_clangd_sources <tarball>: makes $CACHE/llvm-project-$LLVM_VERSION.src
# the parts of the release that clang, clangd and clang-tidy are made of,
# with patches/clangd-browser.patch applied, from <tarball>, checked
# against LLVM_SHA256 first. .patched holds a SHA-256 of the tarball's pin
# and the patch: another tarball or patch means a fresh tree. tar keeps the
# release's timestamps, so each build tree that compiles it recompiles what
# the old or the new patch touched, and nothing else (follow_patch,
# build-lib.sh). Prints the tree's path.
llvm_clangd_sources() {
  local tarball=$1 src="$CACHE/llvm-project-$LLVM_VERSION.src" want
  want=$({ echo "$LLVM_SHA256"; cat "$BUILD_LIB_DIR/patches/clangd-browser.patch"; } | sha256sum | cut -d' ' -f1)
  if [ "$(cat "$src/.patched" 2>/dev/null)" != "$want" ]; then
    echo "$LLVM_SHA256  $tarball" | sha256sum -c --quiet - >&2 || die "$tarball is not the LLVM tarball pinned"
    rm -rf "$src"
    # Only the parts the compilers are made of. The runtimes and the headers
    # the libs unit needs, it extracts from the same tarball itself.
    tar xJf "$tarball" -C "$CACHE" \
      "llvm-project-$LLVM_VERSION.src"/{llvm,clang,clang-tools-extra,cmake,third-party}
    # Input from the embedding Worker, and config files never cached; see the patch.
    patch -s -d "$src" -p1 < "$BUILD_LIB_DIR/patches/clangd-browser.patch" >&2
    echo "$want" > "$src/.patched"
  fi
  echo "$src"
}

# llvm_native_tools <src>: builds the native table generators the wasm
# builds run on the host (they cannot run their own) in $CACHE/build-native,
# from the source tree <src>. Configured once, so its arguments are in what
# made it, and so is the host's clang, which ninja sees only by path. ninja
# runs every time: with nothing changed it only checks (it used to be
# skipped while the last tool existed, whatever source or compiler had made
# it). clang-tidy-confusable-chars-gen is clang-tidy's (misc-confusable-
# identifiers), which only the tidy unit's clangd links.
llvm_native_tools() {
  local src=$1
  local tools="llvm-tblgen llvm-min-tblgen clang-tblgen clang-tidy-confusable-chars-gen"
  local native_args=(-G Ninja -DCMAKE_BUILD_TYPE=Release
    -DLLVM_ENABLE_PROJECTS="clang;clang-tools-extra" -DLLVM_TARGETS_TO_BUILD=X86
    -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ -DLLVM_USE_LINKER=lld
    -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF -DLLVM_INCLUDE_EXAMPLES=OFF)
  keep_tree "$CACHE/build-native" "$(printf 'llvm %s %s\nhost %s\n' "$LLVM_VERSION" "$LLVM_SHA256" "$(clang --version | head -1)"
    printf '%s\n' "${native_args[@]}")"
  follow_patch "$CACHE/build-native" "$BUILD_LIB_DIR/patches/clangd-browser.patch" "$src"
  [ -f "$CACHE/build-native/build.ninja" ] || cmake -S "$src/llvm" -B "$CACHE/build-native" "${native_args[@]}" >/dev/null
  # shellcheck disable=SC2086
  $NICE ninja -C "$CACHE/build-native" -j"$JOBS" $tools
}

# llvm_clangd_args <array> <tidy>: sets the array named <array> to the cmake
# arguments of clangd for WebAssembly, with clang-tidy's checks linked in
# when <tidy> is ON (the tidy unit's clangd-tidy.wasm) and without them when
# it is OFF (the compilers unit's clangd.wasm, the one the editor starts
# with). Everything else is the same, so the two parse alike.
#
# Threads are Web Workers sharing one memory, so the page must be
# cross-origin isolated (SharedArrayBuffer). main() runs on a thread of its
# own (PROXY_TO_PTHREAD), which leaves the Worker that loaded clangd free to
# receive the client's messages and hand them to it (clangd_input, in the
# patch). Stacks: clang's parser recurses deeply, and Emscripten's default
# 64 KiB overflows on ordinary code. The static analyzer is off in both:
# clangd runs none of its checks (ParsedAST.cpp), so clang-analyzer-* are
# not linked either.
llvm_clangd_args() {
  local -n args=$1
  local ldflags="-pthread -sPROXY_TO_PTHREAD -sPTHREAD_POOL_SIZE=4 -sMODULARIZE -sEXPORT_ES6 \
  -sEXPORT_NAME=createClangd -sENVIRONMENT=worker -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 \
  -sEXPORTED_RUNTIME_METHODS=FS,callMain,stringToUTF8,lengthBytesUTF8 -sEXPORTED_FUNCTIONS=_main,_malloc,_free \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=128MB -sMAXIMUM_MEMORY=2GB \
  -sSTACK_SIZE=8MB -sDEFAULT_PTHREAD_STACK_SIZE=8MB"
  # shellcheck disable=SC2034 # args is a nameref to the caller's array
  args=(-G Ninja
    -DCMAKE_BUILD_TYPE=MinSizeRel -DCMAKE_EXE_LINKER_FLAGS="$ldflags"
    -DCMAKE_C_FLAGS=-pthread -DCMAKE_CXX_FLAGS=-pthread
    -DCMAKE_EXE_LINKER_FLAGS_MINSIZEREL="-Oz"
    -DLLVM_ENABLE_PROJECTS="clang;clang-tools-extra" -DLLVM_TARGETS_TO_BUILD=X86
    -DLLVM_HOST_TRIPLE=wasm32-unknown-emscripten -DLLVM_DEFAULT_TARGET_TRIPLE=x86_64-linux-musl
    -DCLANG_DEFAULT_CXX_STDLIB=libc++ -DLLVM_NATIVE_TOOL_DIR="$CACHE/build-native/bin"
    -DLLVM_TABLEGEN="$CACHE/build-native/bin/llvm-tblgen" -DCLANG_TABLEGEN="$CACHE/build-native/bin/clang-tblgen"
    -DLLVM_ENABLE_THREADS=ON -DLLVM_ENABLE_PIC=OFF -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF
    -DLLVM_ENABLE_LIBXML2=OFF -DLLVM_ENABLE_LIBEDIT=OFF -DLLVM_ENABLE_LIBPFM=OFF
    -DLLVM_ENABLE_BACKTRACES=OFF -DLLVM_ENABLE_CRASH_OVERRIDES=OFF -DLLVM_ENABLE_UNWIND_TABLES=OFF
    -DLLVM_ENABLE_PLUGINS=OFF -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF
    -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_UTILS=OFF -DLLVM_BUILD_UTILS=OFF -DLLVM_INCLUDE_DOCS=OFF
    -DCLANG_ENABLE_CLANGD=ON -DCLANG_ENABLE_STATIC_ANALYZER=OFF -DCLANG_ENABLE_OBJC_REWRITER=OFF
    -DCLANG_PLUGIN_SUPPORT=OFF -DCLANG_INCLUDE_TESTS=OFF -DCLANG_INCLUDE_DOCS=OFF
    -DCLANG_TIDY_ENABLE_STATIC_ANALYZER=OFF -DCLANGD_TIDY_CHECKS="$2" -DCLANGD_BUILD_DEXP=OFF
    -DCLANGD_BUILD_XPC=OFF -DCLANGD_ENABLE_REMOTE=OFF -DCLANGD_MALLOC_TRIM=OFF)
}
