#!/bin/sh
# shellcheck source-path=SCRIPTDIR
# Builds the stub's vm unit into $OUT: a "kernel". It needs no other unit,
# so no DEP_ variable reaches it and no other unit's files are in its stage.
set -eu
. ./pins.sh
. ../../lib.sh
mkdir -p "$OUT/vm" "$OUT/share"
printf 'kernel %s\n' "$KERNEL_VERSION" > "$OUT/vm/kernel"
stub_versions vm kernel "$KERNEL_VERSION"
env | sed 's/=.*//' | sort > "$OUT/share/env-vm.txt"
