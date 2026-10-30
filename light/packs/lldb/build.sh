#!/usr/bin/env bash
# Builds the LLDB pack into ../../app/static/packs/lldb/ on this machine: its
# two toolchain units (toolchains/<unit>/; README, "Build") taken from the
# local toolchain cache, fetched from the toolchain store, or built here,
# each after the units it needs, then the pack assembled over them with the
# glue (glue.sh), in seconds. Both halves are
# light/scripts/pack-toolchain.sh's; this script only names the pack, and
# makes it one a release ships (light-release.yml takes every pack with a
# build.sh).
#
#   lldb        lldb-dap for the browser          (needs cpp/emsdk)
#   instrument  the instrumenter, instrument.wasm
#   glue        debugger.js, runtime.js
#
# Arguments go to `pack-toolchain.sh ensure lldb`, as the C/C++ pack's
# build.sh says. From nothing, lldb takes 2 to 3 hours on four cores.
#
#   JOBS=4 ./build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLCHAIN="$HERE/../../scripts/pack-toolchain.sh"
dirs="$("$TOOLCHAIN" ensure lldb --build-dirty "$@")"
mapfile -t units <<<"$dirs"
"$TOOLCHAIN" assemble lldb "${units[@]}"
