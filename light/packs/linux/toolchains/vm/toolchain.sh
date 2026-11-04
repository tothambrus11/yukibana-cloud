#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Builds the Linux pack's vm unit (linux/vm) into $OUT, run by
# light/scripts/pack-toolchain.sh from this directory of its stage, with the
# C/C++ pack's emsdk unit at $DEP_EMSDK (the Emscripten that compiles QEMU)
# and its musl unit at $DEP_MUSL (the guest tools' musl, user mode's
# headers): the Linux VM, QEMU-Wasm with its kernels, init and strace
# (build-vm.sh says what, README.md why). It needs no language's compiler,
# so a change to one never rebuilds it.
#
#   vm/<arch>/, user/<arch>/, LICENSE-{qemu,linux,strace,opensbi,qboot}.txt
#   versions-vm.json
#
# Hours from nothing, in $PACK_CACHE/qemu-wasm and $PACK_CACHE/linux/vm-artifacts,
# whose stamps make a warm build redo only what changed.
set -euo pipefail

UNIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK="$(cd "$UNIT/../.." && pwd)"
# shellcheck source=pins.sh
source "$UNIT/pins.sh"
: "${OUT:?OUT is the toolchain directory of this unit (pack-toolchain.sh sets it)}"

"$PACK/build-vm.sh"

printf '{"qemu-wasm":"%s","linux":"%s","strace":"%s","user-mode":%s}\n' \
  "$QEMU_WASM_COMMIT" "$LINUX_VERSION" "$STRACE_VERSION" "$([ "${USER_MODE:-1}" = 1 ] && echo true || echo false)" \
  > "$OUT/versions-vm.json"
