# shellcheck shell=bash
# Helpers shared by the pack and toolchain store scripts (pack-store.sh,
# pack-toolchain.sh), so each is written once and behaves the same in both.
# Sourced, never run.
#
# Part of no key: no toolchain build reads this file (it is never staged),
# so a change here rebuilds nothing. That is why shared helpers live here and
# not in toolchain-build-env.sh, whose every byte is a line of every
# toolchain's key, nor in toolchain-key.sh, whose changes of meaning bump
# the key's format. A helper that a toolchain.sh would need belongs in
# toolchain-build-env.sh instead, and costs a rebuild of everything.

# Removes the tree $1 (nothing when there is none, a dangling symlink
# included), which may hold read-only files and directories: a toolchain's
# files are read-only, and an assembled pack's files are hard links to them,
# the same inodes. So only its directories are made writable, which is all
# removing their entries needs, and no file is ever chmodded: a chmod on a
# linked file would make the toolchain in the cache writable too.
remove_tree() {
  [ -e "$1" ] || [ -L "$1" ] || return 0
  find "$1" -type d -exec chmod u+w {} +
  rm -rf "$1"
}

# Exits 2, naming why on stderr, unless pack $1 has a plain name, exists as
# $LIGHT/packs/$1 (LIGHT is the caller's light/ directory) and is split: has
# toolchains/. 2 is "bad usage or not a split pack" in both store scripts;
# pack-store.sh once exited 1 for a bad name where pack-toolchain.sh exited
# 2, so a caller testing for 2 saw two meanings. The message starts with the
# running script's name.
split_pack() {
  local me="${0##*/}"
  if [[ ! "$1" =~ ^[a-z][a-z0-9]*$ ]]; then
    echo "$me: '$1' is not a pack name" >&2
    exit 2
  fi
  if [ ! -d "$LIGHT/packs/$1" ]; then
    echo "$me: no pack $1 (packs/$1)" >&2
    exit 2
  fi
  if [ ! -d "$LIGHT/packs/$1/toolchains" ]; then
    echo "$me: $1 has no toolchain units (packs/$1/toolchains/): it is built whole by its build.sh, and its tree is its key" >&2
    exit 2
  fi
}

# Exits 2 like split_pack unless $1 names a toolchain unit, <pack>/<unit>,
# of a split pack: the directory packs/<pack>/toolchains/<unit>/ exists.
split_unit() {
  local me="${0##*/}"
  case "$1" in
    */*) ;;
    *)
      echo "$me: '$1' is not a toolchain unit, <pack>/<unit>" >&2
      exit 2
      ;;
  esac
  split_pack "${1%%/*}"
  if [[ ! "${1#*/}" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] || [ ! -d "$LIGHT/packs/${1%%/*}/toolchains/${1#*/}" ]; then
    echo "$me: no toolchain unit $1 (packs/${1%%/*}/toolchains/${1#*/}/)" >&2
    exit 2
  fi
}

# Whether the asset list $2 (lines "<name> <sha256> <created_at> <url>", as
# pack-store.sh's assets prints them) holds an asset named exactly $1. The
# list is a string, never a pipe: a reader that stopped at the first match
# would end the writer with SIGPIPE, which pipefail turns into a failure,
# and a failure here reads as "not there".
asset_listed() {
  awk -v w="$1" '$1 == w { found = 1 } END { exit !found }' <<<"$2"
}
