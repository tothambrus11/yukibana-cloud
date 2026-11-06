# shellcheck shell=bash
# What the Linux pack's vm unit builds with, sourced by build-vm.sh and
# vm/'s scripts after their pins: the helpers the C/C++ pack's build-lib.sh
# has too (a unit's inputs are its own pack's files, so they are repeated
# here, not reached from ../cpp, as the LLDB pack's lib.sh does), and how a
# build reaches the units it needs of the C/C++ pack, cpp/emsdk (the one
# Emscripten, which compiles QEMU) and cpp/musl (the guest tools' musl,
# user mode's headers). It defines functions and one constant
# (YK_TREE_FORMAT) and nothing else, so sourcing it runs no command. The
# functions that use the cache read CACHE, which the scripts set to
# $PACK_CACHE/linux before calling them.
#
# Every function exits the script through die() when it cannot do what it
# says (the scripts run under `set -euo pipefail`), naming the script.

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

# Reused trees: a tree records what made it (.yk-made-by) that its own
# build cannot see, and is used only when that record is the one the
# build would write now (../cpp/build-lib.sh, "Reused trees", says why).
# The record's format is the first line of .yk-made-by.
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

# emsdk_made_by: prints the line that names the C/C++ pack's Emscripten as a
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

# emsdk_tree_made_by: prints emsdk_made_by and, on a second line, where
# that Emscripten is installed ("emsdk at <dir>", as emsdk_use found it),
# for keep_tree of a tree configured with it: the em-cache, the LLVM trees
# (llvm_made_by), QEMU's build trees. CMake's CMakeSystem.cmake includes
# Emscripten.cmake by that absolute path, and a QEMU tree configured once
# calls emcc by it, so a tree kept after the install moved failed at
# configure (CMake: "include could not find requested file") or at build,
# and emcc empties its cache itself when the LLVM_ROOT under it moves.
# pack-toolchain.sh stages a unit at the same path every time (stage_of),
# so the path moves only with TMPDIR, and then the trees start from empty
# instead of failing. A stamp names the Emscripten by emsdk_made_by alone:
# it says what the outputs are made of, not where their maker was. Dies
# unless emsdk_use has run.
emsdk_tree_made_by() {
  [ -n "${EMSDK_AT:-}" ] || die "emsdk_tree_made_by: no Emscripten in use; call emsdk_use first"
  printf '%s\nemsdk at %s' "$(emsdk_made_by)" "$EMSDK_AT"
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

# emsdk_use: makes the C/C++ pack's one Emscripten, its emsdk unit's install at
# $DEP_EMSDK/build-only/emsdk, the one this script compiles with: sources
# its pins (emsdk_made_by) and its emsdk_env.sh, which puts its emcc and
# upstream/bin (clang, llvm-strip, llvm-ar) on PATH.
# The install is read-only, as every dependency is, and emcc writes the
# system libraries it compiles on first use into its cache, so EM_CACHE is
# $CACHE/em-cache, which records the Emscripten that filled it and where
# (keep_tree, emsdk_tree_made_by) and is emptied for another. It is set
# after emsdk_env.sh, which clears an EM_CACHE it finds. Nothing writes into
# the install (plan D52). Sets EMSDK_AT, the install's physical path, which
# emsdk_tree_made_by records.
emsdk_use() {
  need_unit emsdk
  local dir="$DEP_EMSDK/build-only/emsdk"
  [ -x "$dir/upstream/emscripten/emcc" ] && [ -f "$dir/.emscripten" ] ||
    die "the emsdk unit at $DEP_EMSDK has no installed Emscripten (build-only/emsdk/upstream/emscripten/emcc)"
  EMSDK_AT="$(cd "$dir" && pwd -P)"
  # shellcheck disable=SC1091
  source "$dir/emsdk_env.sh" >/dev/null 2>&1
  keep_tree "$CACHE/em-cache" "$(emsdk_tree_made_by)"
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

# files_sha256 <dir>: prints the SHA-256 of a directory's files: every
# file's SHA-256 and path outside .git, sorted by path, hashed: what a
# stamp takes for a directory, the musl headers vm/build-qemu-user.sh
# compiles with.
files_sha256() {
  (cd "$1" && find . -path ./.git -prune -o -type f -print | LC_ALL=C sort | xargs -r sha256sum | sha256sum | cut -d' ' -f1)
}
