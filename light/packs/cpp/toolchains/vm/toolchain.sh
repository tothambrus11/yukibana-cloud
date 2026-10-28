#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Builds the C/C++ pack's vm unit (cpp/vm) into $OUT, run by
# light/scripts/pack-toolchain.sh from this directory of its stage, with the
# emsdk unit at $DEP_EMSDK (the Emscripten that compiles QEMU) and the musl
# unit at $DEP_MUSL (the guest tools' musl, user mode's headers): the Linux
# VM, QEMU-Wasm with its kernels, init and strace (build-vm.sh says what,
# vm/README.md why). It needs neither the compilers nor the libraries, so a
# change to either never rebuilds it, and it builds beside them.
#
#   vm/<arch>/, user/<arch>/, LICENSE-{qemu,linux,strace,opensbi,qboot}.txt
#   versions-vm.json
#
# Hours from nothing, in $PACK_CACHE/qemu-wasm and $PACK_CACHE/cpp/vm-artifacts,
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
