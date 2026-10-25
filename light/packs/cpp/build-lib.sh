# shellcheck shell=bash
# What the C/C++ pack's build scripts share: each build-*.sh and
# pack-runner.sh sources this file after pins.sh. It defines functions and
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

# rapidcheck_tree_sha256 <dir>: prints the SHA-256 that RAPIDCHECK_TREE_SHA256
# pins: every file's SHA-256 outside .git, sorted by path, hashed.
rapidcheck_tree_sha256() {
  (cd "$1" && find . -path ./.git -prune -o -type f -print | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -d' ' -f1)
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
