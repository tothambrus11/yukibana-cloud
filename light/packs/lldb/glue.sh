#!/usr/bin/env bash
# The LLDB pack's glue (light/scripts/pack-toolchain.sh assemble runs it,
# from this directory): bundles the workers over the units' toolchains,
# already linked into OUT. It compiles nothing.
#
#   debugger.js   lldb-dap's module Worker (src/debugger.js), with the raw
#                 size of lldb-dap.wasm (lldb) for its progress
#   runtime.js    what a runner imports to debug its program
#                 (src/runtime.js, with stub.js and channel.js)
#
# each with .gz and .br siblings. It prints each file it adds, relative to
# OUT, one per line, and nothing else on stdout.
#
# With --check-versions (and no OUT) it checks that each unit's versions
# file, at $TOOLCHAIN_DIR_<UNIT>, is a JSON object.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNITS=(lldb instrument)

if [ "${1:-}" = --check-versions ]; then
  bad=0
  for unit in "${UNITS[@]}"; do
    var="TOOLCHAIN_DIR_${unit^^}"
    file="${!var:?$var is not set}/versions-$unit.json"
    if ! node -e 'const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.exit(v && typeof v === "object" && !Array.isArray(v) ? 0 : 1)' "$file" 2>/dev/null; then
      echo "glue.sh: $file is missing or not a JSON object" >&2
      bad=1
    fi
  done
  exit "$bad"
fi

: "${OUT:?OUT is the pack being assembled, every unit already linked into it}"
want=$(sha256sum < "$HERE/package-lock.json" | cut -d' ' -f1)
if [ "$(cat "$HERE/node_modules/.yk-lock" 2>/dev/null)" != "$want" ]; then
  (cd "$HERE" && npm ci --no-audit --no-fund >&2)
  echo "$want" > "$HERE/node_modules/.yk-lock"
fi
for f in lldb-dap.js lldb-dap.wasm instrument.wasm; do
  [ -f "$OUT/$f" ] || { echo "glue.sh: $OUT/$f is missing: a unit did not build it" >&2; exit 1; }
done
esbuild() { "$HERE/node_modules/.bin/esbuild" "$@" --format=esm --minify --target=es2022 --log-level=warning; }
esbuild "$HERE/src/debugger.js" --bundle --external:./lldb-dap.js --define:LLDB_WASM_SIZE="$(stat -c %s "$OUT/lldb-dap.wasm")" --outfile="$OUT/debugger.js"
esbuild "$HERE/src/runtime.js" --bundle --outfile="$OUT/runtime.js"

made=(debugger.js runtime.js)
node "$HERE/compress.mjs" "${made[@]/#/$OUT/}" >&2
for f in "${made[@]}"; do printf '%s\n%s.gz\n%s.br\n' "$f" "$f" "$f"; done
