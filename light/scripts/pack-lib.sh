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
