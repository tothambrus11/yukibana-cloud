# shellcheck shell=bash
# What the C/C++ pack's build scripts share: each build-*.sh and
# pack-runner.sh, and vm/'s scripts, source this file after their pins. It
# defines functions and two constants (BUILD_LIB_DIR, YK_TREE_FORMAT) and
# nothing else, so sourcing it runs no command, and a script keeps its own
# HERE, CACHE, OUT and JOBS. The functions that use the cache read CACHE,
# which every script sets to $PACK_CACHE/cpp before calling them.
#
# Every function exits the script through die() when it cannot do what it
# says (the scripts run under `set -euo pipefail`), naming the script, so a
# step never goes on with a missing or unverified input.

BUILD_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# step <words...>: prints a step's heading, the way the build's log is read.
step() { printf '\n== %s\n' "$*"; }

# die <message...>: prints "<script>: message" on stderr and exits 1.
die() { echo "$(basename "$0"): $*" >&2; exit 1; }

# fetch <url> <sha256> <file>: makes <file> a copy of <url> whose SHA-256 is
# <sha256>. A file already there with that checksum is kept and nothing is
# downloaded; otherwise the download goes to <file>.part and is renamed only
# once it is checked, so <file> is never a partial or unverified download.
fetch() {
  if [ ! -f "$3" ] || ! echo "$2  $3" | sha256sum -c --quiet - 2>/dev/null; then
    curl -sSfL -o "$3.part" "$1"
    echo "$2  $3.part" | sha256sum -c --quiet - || die "checksum mismatch for $1"
    mv "$3.part" "$3"
  fi
}

# reproducible_tar <tar arguments...>: tar with the flags that make an archive
# depend only on the files' names, contents and modes (ustar, sorted, mtime 0,
# owner and group 0), so the same inputs give the same bytes on any machine.
reproducible_tar() {
  tar --format=ustar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner "$@"
}

# tarball <dir> <out> [member...]: writes the members of <dir> (default usr)
# as a reproducible tar to <out>. It is written beside <out> and renamed over
# it: the app's build may hold a hard link to the old file, which must not
# change under it.
tarball() {
  local dir=$1 out=$2; shift 2
  [ $# -gt 0 ] || set -- usr
  reproducible_tar -C "$dir" -c "$@" > "$out.part"
  mv "$out.part" "$out"
}

# multiarch <arch>: prints the multiarch directory clang's Linux driver uses
# for a Linux target's arch (x86_64-linux-gnu for x86_64), as src/targets.json
# says; dies when no target has that arch.
multiarch() {
  node -e 'const t = require(process.argv[1]).find((t) => t.arch === process.argv[2]); if (!t) process.exit(1); console.log(t.multiarch)' \
    "$BUILD_LIB_DIR/src/targets.json" "$1" || die "no target with arch $1 in src/targets.json"
}

# apk_pin <package> <arch>: prints "<package>-<version> <sha256>" for one of
# Alpine's packages, from pins.sh's APK_<NAME>_VERSION and APK_<NAME>_<ARCH>
# (that file says how NAME is spelled); dies when either is not pinned.
apk_pin() {
  local name=${1^^}
  name=${name//+/X}
  name=APK_${name//-/_}
  local version_var=${name}_VERSION sha_var=${name}_${2^^}
  [ -n "${!version_var:-}" ] || die "$1 has no $version_var in pins.sh"
  [ -n "${!sha_var:-}" ] || die "$1 has no $sha_var in pins.sh"
  echo "$1-${!version_var} ${!sha_var}"
}

# fetch_apk <arch> <package-version> <sha256>: prints the path of a verified
# copy of that Alpine package, cached in $CACHE/targets/dl/<arch>/. It is
# taken from $ALPINE_MIRROR/<arch>/ first when that is set (a directory or a
# URL holding copies, for a revision Alpine no longer serves), then from
# ALPINE_REPO; a copy whose SHA-256 differs is named on stderr and skipped.
fetch_apk() {
  local file="$CACHE/targets/dl/$1/$2.apk" from
  mkdir -p "$CACHE/targets/dl/$1"
  if [ ! -f "$file" ] || ! echo "$3  $file" | sha256sum -c --quiet - 2>/dev/null; then
    for from in ${ALPINE_MIRROR:+"$ALPINE_MIRROR"} "$ALPINE_REPO"; do
      rm -f "$file.part"
      case $from in
        http://*|https://*) curl -sSfL -o "$file.part" "$from/$1/$2.apk" || continue ;;
        *) cp "$from/$1/$2.apk" "$file.part" 2>/dev/null || continue ;;
      esac
      echo "$3  $file.part" | sha256sum -c --quiet - 2>/dev/null && break
      echo "$(basename "$0"): checksum mismatch for $from/$1/$2.apk" >&2
      rm -f "$file.part"
    done
    [ -f "$file.part" ] || die "no copy of $1/$2.apk with sha256 $3 (ALPINE_MIRROR=${ALPINE_MIRROR:-unset}, $ALPINE_REPO)"
    mv "$file.part" "$file"
  fi
  echo "$file"
}

# Reused trees. The cache keeps build trees between runs (and CI restores
# it from another run's), so that ninja recompiles only what changed. Ninja
# sees a changed source, header, flag or CMakeLists.txt; it does not see a
# different compiler under the same path, a source tree extracted again with
# its release timestamps, or a configure step that is run only once. Each
# reused tree therefore records what made it, and is used only when that
# record is the one the build would write now:
#
#   keep_tree    a tree's .yk-made-by: the lines naming what made it that
#                its own build cannot see (the source tarball, the compiler,
#                arguments given only at its first configure). Any other
#                record, or none, and the tree is deleted and built again
#                from empty: a wrong reuse would be a stale compiler served
#                under a key that says otherwise (plan D8).
#   follow_patch a patch applied to a source the tree compiles: the tree
#                keeps a copy of the patch it was last built with, and when
#                the patch changes every file the old or the new copy
#                touches is given a fresh time, so that ninja recompiles
#                exactly those files (a file the old patch changed and the
#                new one does not is back to its release time when the
#                source is extracted again, older than its object, and
#                would otherwise never be recompiled).
#
# The record's format is the first line of .yk-made-by; a change in what a
# record means changes that line, which rebuilds every tree once.
YK_TREE_FORMAT="yukibana-tree/1"

# keep_tree <dir> <made-by>: keeps <dir> when its .yk-made-by holds
# YK_TREE_FORMAT and then exactly <made-by> (lines, no trailing newline);
# otherwise names the reason on stderr, deletes it, and leaves <dir> empty
# but for that record, so the build that follows starts from nothing.
keep_tree() {
  local dir=$1 want
  want=$(printf '%s\n%s' "$YK_TREE_FORMAT" "$2")
  if [ -d "$dir" ] && [ "$(cat "$dir/.yk-made-by" 2>/dev/null)" = "$want" ]; then return 0; fi
  if [ -e "$dir/.yk-made-by" ]; then
    echo "$(basename "$0"): $dir was made by something else; building it again from empty:" >&2
    diff <(cat "$dir/.yk-made-by") <(printf '%s\n' "$want") | sed -n 's/^[<>] /  /p' >&2 || true
  elif [ -e "$dir" ]; then
    echo "$(basename "$0"): $dir does not say what made it; building it again from empty" >&2
  fi
  rm -rf "$dir"
  mkdir -p "$dir"
  printf '%s\n' "$want" > "$dir/.yk-made-by"
}

# patch_files <patch>: prints the paths a unified diff changes, one per
# line, sorted, as they are named after a/ or b/ (a created or deleted
# file's /dev/null side is not a path).
patch_files() {
  sed -n -E 's#^(\+\+\+|---) [ab]/([^\t]*).*#\2#p' "$1" | LC_ALL=C sort -u
}

# follow_patch <tree> <patch> <source-dir>: makes the build tree <tree>,
# which compiles <source-dir> with <patch> applied (patch -p1 there), see a
# change of the patch, as the comment above says. The copy is
# <tree>/.yk-patches/<patch's name>. A tree that holds a build but no copy
# cannot say which version it was built with, so it is started again
# (keep_tree's record is kept): call this after keep_tree. The copies of the
# tree's other patches are kept too: an empty tree compiles everything, so
# they stay true, and deleting them once made a tree that follows two
# patches (cc's, or cross's on cc's tree) be built again on the next
# unchanged run, because the first patch's copy was gone.
follow_patch() {
  local tree=$1 patch=$2 src=$3 copy f
  copy="$tree/.yk-patches/$(basename "$patch")"
  cmp -s "$patch" "$copy" && return 0
  if [ -f "$copy" ]; then
    { patch_files "$copy"; patch_files "$patch"; } | LC_ALL=C sort -u | while IFS= read -r f; do
      if [ -e "$src/$f" ]; then touch "$src/$f"; fi
    done
  elif [ -n "$(find "$tree" -mindepth 1 -maxdepth 1 ! -name .yk-made-by ! -name .yk-patches -print -quit)" ]; then
    echo "$(basename "$0"): $tree does not say which $(basename "$patch") it was built with; building it again from empty" >&2
    find "$tree" -mindepth 1 -maxdepth 1 ! -name .yk-made-by ! -name .yk-patches -exec rm -rf {} +
  fi
  mkdir -p "$tree/.yk-patches"
  cp "$patch" "$copy"
}

# emsdk_made_by: prints the line that names the pack's Emscripten as a
# maker, for keep_tree and for a stamp: the emsdk tag, its commit, the
# toolchain release and that archive's SHA-256. Every tree or step compiled
# with emcc records it, because emcc is found by a path (CMake's cache, the
# PATH emsdk_env.sh sets) that stays the same when the Emscripten behind it
# changes. One line for every user (clangd's, the compilers' and QEMU's
# trees), so that no user can name the Emscripten by a part the others leave
# out.
emsdk_made_by() {
  printf 'emsdk %s %s %s %s' "$EMSDK_VERSION" "$EMSDK_COMMIT" "$EMSDK_RELEASE" "$EMSDK_BINARIES_SHA256"
}

# emsdk_install: makes $CACHE/emsdk the emsdk at EMSDK_COMMIT with
# EMSDK_VERSION installed and activated, from the two archives pins.sh pins
# (fetched and checked here, since emsdk checks nothing, and handed to it as
# kept downloads), and returns at once when it already is. An emsdk at
# another commit, or one whose install did not finish (no emcc, or no
# .emscripten, which activating writes last), is deleted
# and installed again. The install is never modified afterwards: what the
# pack's builds compile with is exactly the release pinned, and a fix
# Emscripten lacks is a newer pin, not a patch to the cached copy (plan D52;
# the cpp pack once patched proxying.c there, and had to delete prebuilt
# libraries and keep a sentinel to make the patch reach the build). Every
# entry point that compiles with emcc calls it before compiling (build.sh,
# before the sub-scripts it runs; vm/build-qemu.sh; vm/build-qemu-user.sh,
# which may run while qemu-system is up to date), so any may run first, and none
# compiles with an emsdk another checkout left under the same path. That is
# what makes the stamps and trees true: emsdk_made_by prints the pins, not
# what is installed.
emsdk_install() {
  local em="$CACHE/emsdk"
  if [ -x "$em/upstream/emscripten/emcc" ] && [ -f "$em/.emscripten" ] &&
    [ "$(git -C "$em" rev-parse HEAD 2>/dev/null)" = "$EMSDK_COMMIT" ]; then
    return 0
  fi
  rm -rf "$em"
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$EMSDK_VERSION" https://github.com/emscripten-core/emsdk "$em"
  [ "$(git -C "$em" rev-parse HEAD)" = "$EMSDK_COMMIT" ] || die "emsdk $EMSDK_VERSION is not commit $EMSDK_COMMIT"
  mkdir -p "$em/downloads"
  fetch "https://storage.googleapis.com/webassembly/emscripten-releases-builds/linux/$EMSDK_RELEASE/wasm-binaries.tar.xz" \
    "$EMSDK_BINARIES_SHA256" "$em/downloads/$EMSDK_RELEASE-wasm-binaries.tar.xz"
  fetch "https://storage.googleapis.com/webassembly/emscripten-releases-builds/deps/$EMSDK_NODE" \
    "$EMSDK_NODE_SHA256" "$em/downloads/$EMSDK_NODE"
  (cd "$em" && EMSDK_KEEP_DOWNLOADS=1 ./emsdk install "$EMSDK_VERSION" >/dev/null && ./emsdk activate "$EMSDK_VERSION" >/dev/null) ||
    die "emsdk could not install $EMSDK_VERSION from the checked downloads"
  [ -x "$em/upstream/emscripten/emcc" ] || die "emsdk installed $EMSDK_VERSION without upstream/emscripten/emcc"
  rm -rf "$em/downloads"
}

# llvm_made_by: prints what made a build tree of the LLVM source with the
# pack's Emscripten (clangd's, cc's and cc-cross's: the same lines, so that
# build-cross.sh may still be pointed at cc's tree): the source tarball and
# emsdk_made_by. Both stand behind paths ninja sees as unchanged (the
# CMake cache holds emcc's path, not its version). The native table
# generators are not in it: their binaries are inputs of every generated
# file, which ninja regenerates when they change.
llvm_made_by() {
  printf 'llvm %s %s\n%s' "$LLVM_VERSION" "$LLVM_SHA256" "$(emsdk_made_by)"
}

# llvm_lld_sources: makes $CACHE/llvm-project-$LLVM_VERSION.src/lld the
# release's lld/ with patches/wasm-ld-only.patch applied, extracting it
# again when its .patched record (the tarball's SHA-256 and the patch's)
# differs. build-runner.sh compiles it into cc.wasm; build-cross.sh needs it
# only to exist, because LLVM's CMake refuses LLVM_ENABLE_PROJECTS=lld
# without llvm/../lld, even with LLVM_EXTERNAL_LLD_SOURCE_DIR set elsewhere,
# and it runs first on a clean machine. Run from $CACHE, after build.sh's
# sources step.
llvm_lld_sources() {
  local src="$CACHE/llvm-project-$LLVM_VERSION.src" patch="$BUILD_LIB_DIR/patches/wasm-ld-only.patch" want
  want=$({ echo "$LLVM_SHA256"; cat "$patch"; } | sha256sum | cut -d' ' -f1)
  [ "$(cat "$src/lld/.patched" 2>/dev/null)" != "$want" ] || return 0
  rm -rf "$src/lld"
  tar xJf "llvm-project-$LLVM_VERSION.src.tar.xz" "llvm-project-$LLVM_VERSION.src/lld"
  patch -s -d "$src" -p1 < "$patch"
  echo "$want" > "$src/lld/.patched"
}

# npm_deps <dir>: installs <dir>'s package-lock.json into its node_modules
# (npm ci) unless node_modules/.yk-lock holds that lock file's SHA-256, so a
# changed lock (esbuild's version, say) reaches the build instead of the
# node_modules a previous one installed.
npm_deps() {
  local want
  want=$(sha256sum < "$1/package-lock.json" | cut -d' ' -f1)
  [ "$(cat "$1/node_modules/.yk-lock" 2>/dev/null)" != "$want" ] || return 0
  (cd "$1" && npm ci --no-audit --no-fund >/dev/null)
  echo "$want" > "$1/node_modules/.yk-lock"
}

# linux_testfw_inputs <out>: prints, one per line, every file that makes
# the Linux targets' gtest.tar and rapidcheck.tar (build-test-frameworks-
# linux.sh): the scripts, the
# pins, the compile driver build-test-libs-linux.mjs and what it imports
# (src/toolchain.js, which decides the compiler's arguments and file
# system; src/targets.js and targets.json), and from <out> the compiler
# (cc-cross.wasm and its glue cc-cross.js), the headers every object is
# compiled against (sysroot.tar.gz, targets/<arch>/include.tar). Their
# stamp_of is that step's stamp.
linux_testfw_inputs() {
  local here=$BUILD_LIB_DIR
  printf '%s\n' "$here/build-test-frameworks-linux.sh" "$here/pins.sh" "$here/build-lib.sh" \
    "$here/build-test-libs-linux.mjs" "$here/src/toolchain.js" "$here/src/targets.js" "$here/src/targets.json" \
    "$1/cc-cross.wasm" "$1/cc-cross.js" "$1/sysroot.tar.gz" \
    "$1/targets/x86_64/include.tar" "$1/targets/aarch64/include.tar" "$1/targets/riscv64/include.tar"
}

# sanitizer_inputs: prints, one per line, every file of the pack that makes
# the sanitizer runtimes (build-sanitizers.sh), whose stamp_of is that
# step's stamp: the script, the pins (wasi-sdk, Emscripten,
# whose compiler-rt sources are compiled, and the Alpine packages), the
# patch, every file under src/sanitizer-rt, and src/targets.json, which
# names each arch's multiarch directory.
sanitizer_inputs() {
  local here=$BUILD_LIB_DIR
  printf '%s\n' "$here/build-sanitizers.sh" "$here/pins.sh" "$here/build-lib.sh" \
    "$here/patches/compiler-rt-wasi.patch" "$here/src/targets.json"
  find "$here/src/sanitizer-rt" -type f | LC_ALL=C sort
}

# stamp_of <file...>: prints the SHA-256 of the files' own SHA-256s, one per
# line in the order given: the contents and their order, not where the
# files are, so a checkout elsewhere (or a staged copy) keeps the stamp.
# A missing file is named, and the stamp fails rather than leave it out.
stamp_of() {
  local f
  for f in "$@"; do
    [ -f "$f" ] || die "$f is missing (an input of a stamp)"
  done
  for f in "$@"; do sha256sum < "$f" | cut -d' ' -f1; done | sha256sum | cut -d' ' -f1
}

# files_sha256 <dir>: prints the SHA-256 of a directory's files: every
# file's SHA-256 and path outside .git, sorted by path, hashed. A stamp that
# takes a directory as an input (the musl headers vm/build-qemu-user.sh
# compiles with) takes this.
files_sha256() {
  (cd "$1" && find . -path ./.git -prune -o -type f -print | LC_ALL=C sort | xargs -r sha256sum | sha256sum | cut -d' ' -f1)
}

# rapidcheck_tree_sha256 <dir>: prints the SHA-256 that RAPIDCHECK_TREE_SHA256
# pins, which is files_sha256 of the checkout.
rapidcheck_tree_sha256() {
  files_sha256 "$1"
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
# native table generators are build.sh's ($CACHE/build-native).
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
