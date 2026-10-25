#!/bin/sh
# shellcheck source-path=SCRIPTDIR
# Builds the stub's libs unit into $OUT: a "framework" compiled by the
# compilers unit's bin/cc, which it finds at $DEP_COMPILERS (read-only, and
# there only because its needs file declares stub/compilers).
set -eu
. ./pins.sh
mkdir -p "$OUT/lib" "$OUT/share"
{
  "$DEP_COMPILERS/bin/cc" framework.c
  printf 'framework %s, level %s\n' "$FRAMEWORK_VERSION" "${STUB_LEVEL:-0}"
} > "$OUT/lib/libframework.a"
printf '{"framework":"%s"}\n' "$FRAMEWORK_VERSION" > "$OUT/versions-libs.json"
env | sed 's/=.*//' | sort > "$OUT/share/env-libs.txt"
