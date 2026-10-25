# shellcheck shell=bash
# What the C/C++ pack's build scripts share, whichever toolchain unit they
# build: every unit's toolchain.sh, the build-*.sh scripts, pack-runner.sh
# and vm/'s scripts source this file after their pins. It is named in the
# `paths` of every unit (toolchains/<unit>/paths), so it is an input of
# every unit's key: what only one unit uses lives with that unit instead
# (llvm-lib.sh, libs-lib.sh, toolchains/emsdk/emsdk.sh,
# toolchains/musl/alpine.sh), and an edit to it rebuilds only that unit and
# the ones that need it; what only the glue uses is glue-lib.sh's, in no
# unit's key. It defines functions and two constants
# (BUILD_LIB_DIR, YK_TREE_FORMAT) and nothing else, so sourcing it runs no
# command, and a script keeps its own HERE, CACHE, OUT and JOBS. The
# functions that use the cache read CACHE, which every script sets to
# $PACK_CACHE/cpp before calling them.
#
# A unit is built by light/scripts/pack-toolchain.sh in a stage holding
# only its inputs, with OUT its toolchain's directory and each unit it
# needs read-only at $DEP_<UNIT> (README, "Units"); need_unit, emsdk_use
# and apk_of are how a script reaches those, and fail by name when it runs
# outside such a build.
#
# Every function exits the script through die() when it cannot do what it
# says (the scripts run under `set -euo pipefail`), naming the script, so a
# step never goes on with a missing or unverified input.

# The pack's directory, as the files beside this one (llvm-lib.sh,
# libs-lib.sh) find the patches and sources they name.
# shellcheck disable=SC2034 # read by the files sourced after this one
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
# toolchain release and that archive's SHA-256, from the emsdk unit's pins
# (sourced by emsdk_use, or by the emsdk unit itself). Every tree or step
# compiled with emcc records it, because emcc is found by a path (CMake's
# cache, the PATH emsdk_env.sh sets) that stays the same when the
# Emscripten behind it changes. One line for every user (clangd's, the
# compilers' and QEMU's trees), so that no user can name the Emscripten by
# a part the others leave out.
emsdk_made_by() {
  printf 'emsdk %s %s %s %s' "$EMSDK_VERSION" "$EMSDK_COMMIT" "$EMSDK_RELEASE" "$EMSDK_BINARIES_SHA256"
}

# need_unit <unit>: checks that the build was given the cpp unit <unit> it
# needs (its toolchains/<this unit>/needs names cpp/<unit>), at
# $DEP_<UNIT>, and sources that unit's exported pins
# ($DEP_<UNIT>/build-only/pins.sh) when it has them, so what this build
# reads of it (LLVM_VERSION, MUSL_VERSION, the Emscripten's pins) is the
# dependency's own and pinned nowhere else. Dies naming the unit when it is
# not there: the script was run outside pack-toolchain.sh, or by a unit
# whose needs file does not name it.
need_unit() {
  local var="DEP_${1^^}" dir
  var=${var//-/_}
  dir=${!var:-}
  [ -n "$dir" ] && [ -d "$dir" ] ||
    die "needs the cpp/$1 unit at \$$var: build through light/scripts/pack-toolchain.sh ensure, from a unit whose needs file names cpp/$1"
  if [ -f "$dir/build-only/pins.sh" ]; then
    # shellcheck source=/dev/null
    source "$dir/build-only/pins.sh"
  fi
}

# emsdk_use: makes the pack's one Emscripten, the emsdk unit's install at
# $DEP_EMSDK/build-only/emsdk, the one this script compiles with: sources
# its pins (emsdk_made_by) and its emsdk_env.sh, which puts its emcc and
# upstream/bin (clang, llvm-strip, llvm-ar) on PATH.
# The install is read-only, as every dependency is, and emcc writes the
# system libraries it compiles on first use into its cache, so EM_CACHE is
# $CACHE/em-cache, which records the Emscripten that filled it (keep_tree)
# and is emptied for another. It is set after emsdk_env.sh, which clears
# an EM_CACHE it finds. Nothing writes into the install (plan D52).
emsdk_use() {
  need_unit emsdk
  local dir="$DEP_EMSDK/build-only/emsdk"
  [ -x "$dir/upstream/emscripten/emcc" ] && [ -f "$dir/.emscripten" ] ||
    die "the emsdk unit at $DEP_EMSDK has no installed Emscripten (build-only/emsdk/upstream/emscripten/emcc)"
  # shellcheck disable=SC1091
  source "$dir/emsdk_env.sh" >/dev/null 2>&1
  keep_tree "$CACHE/em-cache" "$(emsdk_made_by)"
  export EM_CACHE="$CACHE/em-cache"
}

# apk_of <arch> <package>: prints the path of the musl unit's checked copy
# of one of Alpine's packages for <arch> ($DEP_MUSL/build-only/apk/<arch>/
# <package>.apk, pinned by SHA-256 in toolchains/musl/pins.sh), and dies
# naming it when the unit has none.
apk_of() {
  need_unit musl
  local file="$DEP_MUSL/build-only/apk/$1/$2.apk"
  [ -f "$file" ] || die "the musl unit has no $2 for $1 ($file): add it to toolchains/musl/toolchain.sh's list, with its pins"
  echo "$file"
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
# compiles with) takes this, and so does RapidCheck's tree pin
# (libs-lib.sh).
files_sha256() {
  (cd "$1" && find . -path ./.git -prune -o -type f -print | LC_ALL=C sort | xargs -r sha256sum | sha256sum | cut -d' ' -f1)
}

