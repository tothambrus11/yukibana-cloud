#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Builds the C/C++ pack's emsdk unit (cpp/emsdk) into $OUT, run by
# light/scripts/pack-toolchain.sh from this directory of its stage: the
# pack's one Emscripten, which the compilers, libs and vm units all compile
# with (plan D52), and nothing the page downloads:
#
#   build-only/emsdk/     the emsdk at EMSDK_COMMIT with EMSDK_VERSION
#                         installed and activated (emsdk.sh), without its
#                         git history; relocatable (its .emscripten finds
#                         everything relative to itself), so it works read-only
#                         at $DEP_EMSDK in a dependent's stage
#   build-only/pins.sh    this unit's pins: emsdk_made_by in a dependent
#                         names this Emscripten by them
#   versions-emsdk.json
#
# Only downloads and unpacks, in minutes. A dependent never writes into
# it: build-lib.sh's emsdk_use gives emcc a cache of the dependent's own.
set -euo pipefail

UNIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK="$(cd "$UNIT/../.." && pwd)"
# shellcheck source=pins.sh
source "$UNIT/pins.sh"
# shellcheck source=../../build-lib.sh
source "$PACK/build-lib.sh"
# shellcheck source=emsdk.sh
source "$UNIT/emsdk.sh"
: "${OUT:?OUT is the toolchain directory of this unit (pack-toolchain.sh sets it)}"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp"
mkdir -p "$CACHE"

step "Emscripten $EMSDK_VERSION"
emsdk_install
mkdir -p "$OUT/build-only"
tar -C "$CACHE" --exclude=emsdk/.git -cf - emsdk | tar -C "$OUT/build-only" -xf -
cp "$UNIT/pins.sh" "$OUT/build-only/pins.sh"
printf '{"emscripten":"%s"}\n' "$EMSDK_VERSION" > "$OUT/versions-emsdk.json"
du -sh "$OUT/build-only/emsdk"
