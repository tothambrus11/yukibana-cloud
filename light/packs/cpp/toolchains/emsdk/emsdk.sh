# shellcheck shell=bash
# The emsdk unit's installer, sourced by its toolchain.sh (and by
# test-build-lib.mjs) after build-lib.sh and the unit's pins.sh. Defines
# one function.

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
# libraries and keep a sentinel to make the patch reach the build). It is
# the emsdk unit's alone: the units that compile with Emscripten take this
# install from the unit's toolchain at $DEP_EMSDK (build-lib.sh's
# emsdk_use), never from a cache where another checkout may have left
# another release under the same path. That is what makes the stamps and
# trees true: emsdk_made_by prints the pins, and the install the pins name
# is the only one any build reaches.
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
