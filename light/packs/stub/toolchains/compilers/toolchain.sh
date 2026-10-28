#!/bin/sh
# shellcheck source-path=SCRIPTDIR
# Builds the stub's compilers unit into $OUT: bin/cc, a compiler that knows
# its own version, and build-only/flags, the flags a unit built with it
# must pass, which the libs unit reads and no pack serves. Run from its
# staged directory; the pack is two up.
set -eu
. ./pins.sh
. ../../lib.sh
mkdir -p "$OUT/bin" "$OUT/share"
{
  echo '#!/bin/sh'
  echo "STUB_CC_VERSION=$CC_VERSION; export STUB_CC_VERSION"
  sed 1d ../../compiler/cc.sh
} > "$OUT/bin/cc"
chmod +x "$OUT/bin/cc"
stub_versions compilers cc "$CC_VERSION"
mkdir -p "$OUT/build-only"
echo "-std=stub$CC_VERSION" > "$OUT/build-only/flags"
env | sed 's/=.*//' | sort > "$OUT/share/env-compilers.txt"
