#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Builds the C/C++ pack's tidy unit (cpp/tidy) into $OUT, run by
# light/scripts/pack-toolchain.sh from this directory of its stage, with the
# compilers unit at $DEP_COMPILERS and the emsdk unit at $DEP_EMSDK:
#
#   clangd-tidy.js, clangd-tidy.wasm   clangd with clang-tidy's checks
#                                      (build-clangd-tidy.sh)
#   tidy-checks.json                   the checks it has (tidy-checks.mjs)
#   versions-tidy.json
#
# the first two with .gz and .br siblings. A unit of its own, not a step of
# the compilers unit: it is a second clangd, as long to build as the first,
# and in its own job it neither waits for nor lengthens the compilers'
# (185 of a job's 355 minutes cold). It is built from the compilers unit's
# LLVM tarball and pins, so a change to the compilers re-keys it, and
# nothing of the libraries, the VM or the glue does.
set -euo pipefail

UNIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK="$(cd "$UNIT/../.." && pwd)"
# shellcheck source=../../build-lib.sh
source "$PACK/build-lib.sh"
: "${OUT:?OUT is the toolchain directory of this unit (pack-toolchain.sh sets it)}"
export OUT

"$PACK/build-clangd-tidy.sh"
