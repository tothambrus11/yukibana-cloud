#!/usr/bin/env bash
# The stub pack's glue: writes server.js over the units' toolchains, already
# linked into OUT, and prints the one file it adds. With --check-versions
# (and no OUT) it checks that each unit's versions file, at
# $TOOLCHAIN_DIR_<UNIT>, names the version the glue reads, as a real pack's
# glue does before it is assembled over another commit's toolchains.
set -euo pipefail

if [ "${1:-}" = --check-versions ]; then
  bad=0
  for pair in "COMPILERS:compilers:cc" "VM:vm:kernel" "LIBS:libs:framework"; do
    IFS=: read -r var unit name <<<"$pair"
    dir_var="TOOLCHAIN_DIR_$var"
    file="${!dir_var:?$dir_var is not set}/versions-$unit.json"
    if ! grep -q "\"$name\"" "$file" 2>/dev/null; then
      echo "glue.sh: $file has no version of $name" >&2
      bad=1
    fi
  done
  exit "$bad"
fi

: "${OUT:?OUT is the pack being assembled}"
cp src/server.js "$OUT/server.js"
echo server.js
