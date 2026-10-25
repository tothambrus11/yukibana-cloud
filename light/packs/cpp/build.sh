#!/usr/bin/env bash
# Builds the C/C++ pack into ../../app/static/packs/cpp/ on this machine: each
# of its five toolchain units (toolchains/<unit>/; README, "Units") taken
# from the local toolchain cache, fetched from the toolchain store, or built
# here, each after the units it needs, then the pack assembled over them with
# the glue (glue.sh), in seconds. Both halves are
# light/scripts/pack-toolchain.sh's; this script only names the pack.
#
#   emsdk      the pack's one Emscripten (build-only: never served)
#   musl       musl and Alpine's packages, checked (build-only)
#   compilers  clangd, cc, cc-cross, the demangler           (needs emsdk)
#   libs       the sysroots, runtimes, frameworks, sanitizers, Linux targets'
#              files                               (needs compilers, emsdk, musl)
#   vm         QEMU-Wasm, the kernels, init, strace          (needs emsdk, musl)
#   glue       server.js, runner.js, runner-linux.js, explorer.js,
#              sanitizer.js, vm.js
#
# Arguments go to `pack-toolchain.sh ensure cpp`: --no-fetch builds every
# unit here, --rebuild ignores the local cache, --any takes each unit's
# newest stored toolchain (with ALLOW_OTHER_TOOLCHAIN=1 for the assembly).
# Uncommitted changes are built (--build-dirty), for this machine only.
# A unit's build caches its trees in $PACK_CACHE/cpp (default
# ~/.cache/yukibana-packs/cpp); its system packages are its deps.apt
# (light/setup.sh installs them). From nothing, the compilers take hours
# (clangd about an hour at -j3 on this machine; README, "Build").
#
#   JOBS=3 ./build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLCHAIN="$HERE/../../scripts/pack-toolchain.sh"
dirs="$("$TOOLCHAIN" ensure cpp --build-dirty "$@")"
mapfile -t units <<<"$dirs"
"$TOOLCHAIN" assemble cpp "${units[@]}"
