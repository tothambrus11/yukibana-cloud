#!/usr/bin/env bash
# The Linux pack's glue (light/scripts/pack-toolchain.sh assemble runs it,
# from this directory): vm.js, the VM's runtime (src/run-linux.js), bundled
# over the vm unit's toolchain, already linked into OUT, with the raw size
# of every file under vm/ and user/ (VM_SIZES), because a host that sends
# .br gives a compressed Content-Length and progress needs the decoded
# total. It compiles nothing.
#
#   vm.js         what a language's runner imports, by URL, to run a Linux
#                 program (README.md, "For a runner")
#
# with .gz and .br siblings. It prints each file it adds, relative to OUT,
# one per line, and nothing else on stdout.
#
# With --check-versions (and no OUT) it checks that the vm unit's versions
# file, at $TOOLCHAIN_DIR_VM, is a JSON object.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNITS=(vm)

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
want=$(sha256sum < "$HERE/pnpm-lock.yaml" | cut -d' ' -f1)
if [ "$(cat "$HERE/node_modules/.yk-lock" 2>/dev/null)" != "$want" ]; then
  (cd "$HERE" && pnpm install --frozen-lockfile --filter . >&2)
  echo "$want" > "$HERE/node_modules/.yk-lock"
fi
esbuild() { "$HERE/node_modules/.bin/esbuild" "$@" --format=esm --minify --target=es2022 --log-level=warning; }

# sizes_json <path...>: a JSON object of each regular file under the paths
# (relative to OUT; .gz and .br siblings left out) to its raw size, keys
# sorted.
sizes_json() {
  local body
  body=$(cd "$OUT" && find "$@" -type f ! -name '*.br' ! -name '*.gz' | LC_ALL=C sort |
    while read -r f; do printf '"%s":%s,' "$f" "$(stat -c %s "$f")"; done)
  printf '{%s}\n' "${body%,}"
}

dirs=()
for d in vm user; do [ -d "$OUT/$d" ] && dirs+=("$d"); done
[ -d "$OUT/vm" ] || { echo "glue.sh: $OUT has no vm/: the vm unit did not build it" >&2; exit 1; }
esbuild "$HERE/src/run-linux.js" --bundle --define:VM_SIZES="$(sizes_json "${dirs[@]}")" --outfile="$OUT/vm.js"

made=(vm.js)
node "$HERE/compress.mjs" "${made[@]/#/$OUT/}" >&2
for f in "${made[@]}"; do printf '%s\n%s.gz\n%s.br\n' "$f" "$f" "$f"; done
