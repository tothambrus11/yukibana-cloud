#!/usr/bin/env bash
# Builds the Linux pack into ../../app/static/packs/linux/ on this machine:
# its toolchain unit (toolchains/vm/; README, "Build") taken from the local
# toolchain cache, fetched from the toolchain store, or built here, after
# the C/C++ pack's units it needs, then the pack assembled over it with the
# glue (glue.sh), in seconds. Both halves are
# light/scripts/pack-toolchain.sh's; this script only names the pack, and
# makes it one a release ships (light-release.yml takes every pack with a
# build.sh).
#
#   vm     QEMU-Wasm, the kernels, init, strace     (needs cpp/emsdk, cpp/musl)
#   glue   vm.js
#
# Arguments go to `pack-toolchain.sh ensure linux`, as the C/C++ pack's
# build.sh says. From nothing, vm takes hours on four cores.
#
#   JOBS=4 ./build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLCHAIN="$HERE/../../scripts/pack-toolchain.sh"
dirs="$("$TOOLCHAIN" ensure linux --build-dirty "$@")"
mapfile -t units <<<"$dirs"
"$TOOLCHAIN" assemble linux "${units[@]}"
