#!/usr/bin/env bash
# The Rust pack's glue (light/scripts/pack-toolchain.sh assemble runs it,
# from this directory): bundles the workers over the units' toolchains,
# already linked into OUT. It compiles nothing.
#
#   server.js        rust-analyzer's worker (src/server.js), with the sizes
#                    of rust-analyzer.wasm and std-src.tar (server) and the
#                    crates' sources (sysroots) for its progress
#   runner.js        Run and Test (src/runner.js, harness.rs inside), with
#                    every download's size and the crates' archives
#   explorer.js      the compiler output views (src/explorer.js)
#   thread.js        one thread of rustc or Miri (src/thread.js)
#   linux-worker.js  a Linux program under the C/C++ pack's QEMU
#   LICENSES.txt
#
# each script with .gz and .br siblings. It prints each file it adds,
# relative to OUT, one per line, and nothing else on stdout.
#
# With --check-versions (and no OUT) it checks that each unit's versions
# file, at $TOOLCHAIN_DIR_<UNIT>, is a JSON object.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNITS=(compilers server sysroots)

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
for f in rustc.wasm rustc-cross.wasm miri.wasm rust-analyzer.wasm std-src.tar versions-sysroots.json; do
  [ -f "$OUT/$f" ] || { echo "glue.sh: $OUT/$f is missing: a unit did not build it" >&2; exit 1; }
done

# What the sysroots unit built for: its targets, Miri's, and the crates.
json() { node -e "$1" "$OUT/versions-sysroots.json"; }
mapfile -t triples < <(json 'for (const t of require(process.argv[1]).targets) console.log(t)')
mapfile -t miri_triples < <(json 'for (const t of require(process.argv[1]).miri) console.log(t)')
quickcheck="$(json 'console.log(require(process.argv[1]).quickcheck)')"
crates="quickcheck-$quickcheck"
files_of() { # prefix triple...: {"<triple>":"<prefix><triple>.tar",...}
  local prefix="$1" t sep=''
  shift
  printf '{'
  for t in "$@"; do
    [ -f "$OUT/$prefix$t.tar" ] || { echo "glue.sh: $OUT/$prefix$t.tar is missing" >&2; exit 1; }
    printf '%s"%s":"%s%s.tar"' "$sep" "$t" "$prefix" "$t"
    sep=,
  done
  printf '}'
}
crates_files="$(files_of "$crates-" "${triples[@]}")"
miri_crates_files="$(files_of "$crates-miri-" "${miri_triples[@]}")"
crates_direct="{\"quickcheck\":\"$quickcheck\"}"
size() { stat -L -c %s "$OUT/$1"; }
# Every download's raw size, for the progress bars' totals.
sizes="{$(cd "$OUT" && for f in *.wasm *.tar; do printf '"%s":%s,' "$f" "$(stat -L -c %s "$f")"; done | sed 's/,$//')}"

esbuild() { "$HERE/node_modules/.bin/esbuild" "$@" --bundle --format=esm --minify --target=es2022 --log-level=warning; }
esbuild "$HERE/src/server.js" \
  --define:SERVER_WASM_SIZE="$(size rust-analyzer.wasm)" --define:STD_SRC_SIZE="$(size std-src.tar)" \
  --define:CRATES_SRC_FILE="\"$crates-src.tar\"" --define:CRATES_SRC_SIZE="$(size "$crates-src.tar")" --define:CRATES_DIRECT="$crates_direct" \
  --outfile="$OUT/server.js"
esbuild "$HERE/src/runner.js" --loader:.rs=text \
  --define:SIZES_JSON="$sizes" --define:CRATES_FILES="$crates_files" --define:MIRI_CRATES_FILES="$miri_crates_files" --define:CRATES_DIRECT="$crates_direct" \
  --outfile="$OUT/runner.js"
esbuild "$HERE/src/explorer.js" \
  --define:SIZES_JSON="$sizes" --define:CRATES_FILES="$crates_files" --define:MIRI_CRATES_FILES="$miri_crates_files" --define:CRATES_DIRECT="$crates_direct" \
  --outfile="$OUT/explorer.js"
esbuild "$HERE/src/thread.js" --outfile="$OUT/thread.js"
esbuild "$HERE/src/linux-worker.js" --outfile="$OUT/linux-worker.js"
cp "$HERE/LICENSES.txt" "$OUT/LICENSES.txt"

made=(server.js runner.js explorer.js thread.js linux-worker.js)
node "$HERE/scripts/compress.mjs" "${made[@]/#/$OUT/}" >&2
for f in "${made[@]}"; do printf '%s\n%s.gz\n%s.br\n' "$f" "$f" "$f"; done
echo LICENSES.txt
