#!/usr/bin/env bash
# Builds the Rust pack into ../../app/static/packs/rust/ on this machine: its
# three toolchain units (toolchains/<unit>/; README, "Building and testing")
# taken from the local toolchain cache, fetched from the toolchain store, or
# built here, each after the units it needs, then the pack assembled over
# them with the glue (glue.sh), in seconds. Both halves are
# light/scripts/pack-toolchain.sh's; this script only names the pack, and
# makes it one a release ships (light-release.yml takes every pack with a
# build.sh).
#
#   compilers  rustc.wasm, rustc-cross.wasm, miri.wasm (hours)
#   server     rust-analyzer.wasm, std-src.tar (minutes)
#   sysroots   rust-std per target, Miri's std per Miri target, the crates
#   glue       server.js, runner.js, explorer.js, thread.js, linux-worker.js
#
# Arguments go to `pack-toolchain.sh ensure rust`, as the C/C++ pack's
# build.sh says.
#
#   JOBS=4 ./build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLCHAIN="$HERE/../../scripts/pack-toolchain.sh"
dirs="$("$TOOLCHAIN" ensure rust --build-dirty "$@")"
mapfile -t units <<<"$dirs"
"$TOOLCHAIN" assemble rust "${units[@]}"
