# shellcheck shell=bash
# What the LLDB pack's units share, sourced after their pins.sh: the few
# helpers the C/C++ pack's build-lib.sh has too (a unit's inputs are its own
# pack's files, so they are repeated here, not reached from ../cpp), and
# emsdk_use, which takes the C/C++ pack's one Emscripten from the cpp/emsdk
# unit at $DEP_EMSDK.

# step <title...>: a heading in the build log.
step() { printf '\n== %s\n' "$*"; }

# die <message...>: prints "<script>: message" on stderr and exits 1.
die() { echo "$(basename "$0"): $*" >&2; exit 1; }

# fetch <url> <sha256> <file>: makes <file> a copy of <url> whose SHA-256 is
# <sha256>. A file already there with that checksum is kept; a download goes
# to <file>.part and is renamed only once it is checked.
fetch() {
  if [ ! -f "$3" ] || ! echo "$2  $3" | sha256sum -c --quiet - 2>/dev/null; then
    curl -sSfL -o "$3.part" "$1"
    echo "$2  $3.part" | sha256sum -c --quiet - || die "checksum mismatch for $1"
    mv "$3.part" "$3"
  fi
}

# emsdk_use: puts the cpp/emsdk unit's Emscripten (read-only at $DEP_EMSDK)
# on PATH, with a cache of this pack's own for the system libraries emcc
# compiles on first use. The cache is emptied when it was filled by another
# Emscripten, so what it holds is always this one's.
emsdk_use() {
  local dir="${DEP_EMSDK:?needs the cpp/emsdk unit at \$DEP_EMSDK: build through light/scripts/pack-toolchain.sh ensure}/build-only/emsdk"
  [ -x "$dir/upstream/emscripten/emcc" ] || die "the emsdk unit at $DEP_EMSDK has no installed Emscripten"
  # shellcheck source=/dev/null
  source "$DEP_EMSDK/build-only/pins.sh"
  # shellcheck disable=SC1091
  source "$dir/emsdk_env.sh" >/dev/null 2>&1
  export EM_CACHE="$CACHE/em-cache"
  if [ "$(cat "$EM_CACHE/.made-by" 2>/dev/null)" != "$EMSDK_VERSION $EMSDK_COMMIT" ]; then
    rm -rf "$EM_CACHE"
    mkdir -p "$EM_CACHE"
    echo "$EMSDK_VERSION $EMSDK_COMMIT" > "$EM_CACHE/.made-by"
  fi
}
