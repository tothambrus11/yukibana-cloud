#!/usr/bin/env bash
# The C/C++ pack's glue (light/scripts/pack-toolchain.sh assemble runs it,
# from this directory): the workers, bundled over the units' toolchains,
# already linked into OUT, in seconds. It compiles nothing; every compiler,
# library and VM file is a unit's (toolchains/<unit>/), and what it reads
# besides them is what glue.paths names.
#
#   server.js       clangd's module Worker (src/server.js), with the sizes of
#                   clangd.wasm (compilers) and sysroot.tar.gz (libs)
#   runner.js, runner-linux.js, explorer.js, sanitizer.js
#                   the run and the views' workers, with the size of every
#                   file they fetch (compilers, libs: CC_WASM_SIZE ...
#                   TARGET_SIZES)
#   vm.js           the Linux VM's runtime (src/vm/run-linux.js), with the
#                   size of every file under vm/ and user/ (vm: VM_SIZES)
#
# each with .gz and .br siblings. It prints each file it adds, relative to
# OUT, one per line, and nothing else on stdout; it never writes a file of
# a toolchain. The sizes are defined into the bundles because a host that
# sends .br gives a compressed Content-Length, and progress needs the
# decoded total.
#
# With --check-versions (and no OUT) it checks that each unit's versions
# file, at $TOOLCHAIN_DIR_<UNIT>, is there and is a JSON object: the glue
# reads no version of its own, so any unit built at any commit that wrote
# its versions file fits it, and one that wrote none is refused by name.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=glue-lib.sh
source "$HERE/glue-lib.sh"
UNITS=(emsdk musl compilers libs vm)

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
npm_deps "$HERE"
esbuild() { "$HERE/node_modules/.bin/esbuild" "$@" --format=esm --minify --target=es2022 --log-level=warning; }
for f in clangd.wasm sysroot.tar.gz cc.wasm cc-cross.wasm wasi-sysroot.tar.gz demangle.wasm; do
  [ -f "$OUT/$f" ] || { echo "glue.sh: $OUT/$f is missing: a unit did not build it" >&2; exit 1; }
done

# server.js imports src/targets.js (and its targets.json), for the Linux
# targets' headers; clangd.js stays a file of its own.
esbuild "$HERE/src/server.js" --bundle --external:./clangd.js --outfile="$OUT/server.js" \
  --define:CLANGD_WASM_SIZE="$(raw_size "$OUT/clangd.wasm")" --define:SYSROOT_SIZE="$(raw_size "$OUT/sysroot.tar.gz")"

# runner-linux.js (linking and running for a Linux target) and vm.js are
# imported by runner.js only for a Linux target, and sanitizer.js (a
# sanitized program's host half and report symbolizer) only for a project
# that asks for a sanitizer, so they stay separate files; the compilers'
# and the demangler's glue are imported by URL at run time.
defines=(--define:CC_WASM_SIZE="$(raw_size "$OUT/cc.wasm")" --define:CC_CROSS_WASM_SIZE="$(raw_size "$OUT/cc-cross.wasm")"
  --define:WASI_SYSROOT_SIZE="$(raw_size "$OUT/wasi-sysroot.tar.gz")" --define:SYSROOT_SIZE="$(raw_size "$OUT/sysroot.tar.gz")"
  --define:GTEST_SIZE="$(raw_size "$OUT/gtest.tar")" --define:CATCH2_SIZE="$(raw_size "$OUT/catch2.tar")"
  --define:DOCTEST_SIZE="$(raw_size "$OUT/doctest.tar")" --define:RAPIDCHECK_SIZE="$(raw_size "$OUT/rapidcheck.tar")"
  --define:DEMANGLE_WASM_SIZE="$(raw_size "$OUT/demangle.wasm")"
  --define:ASAN_SIZE="$(raw_size "$OUT/asan.tar")" --define:UBSAN_SIZE="$(raw_size "$OUT/ubsan.tar")"
  --define:TARGET_SIZES="$(sizes_json "$OUT" targets)")
for worker in runner runner-linux explorer sanitizer; do
  esbuild "$HERE/src/$worker.js" --bundle --outfile="$OUT/$worker.js" \
    --external:./runner-linux.js --external:./vm.js --external:./cc.js --external:./cc-cross.js \
    --external:./sanitizer.js "${defines[@]}"
done

# vm.js, with the raw size of every file it may fetch.
vmdirs=()
for d in vm user; do [ -d "$OUT/$d" ] && vmdirs+=("$d"); done
[ ${#vmdirs[@]} -gt 0 ] || { echo "glue.sh: $OUT has no vm/: the vm unit did not build it" >&2; exit 1; }
esbuild "$HERE/src/vm/run-linux.js" --bundle --define:VM_SIZES="$(sizes_json "$OUT" "${vmdirs[@]}")" --outfile="$OUT/vm.js"

made=(server.js runner.js runner-linux.js explorer.js sanitizer.js vm.js)
node "$HERE/compress.mjs" "${made[@]/#/$OUT/}" >&2
for f in "${made[@]}"; do printf '%s\n%s.gz\n%s.br\n' "$f" "$f" "$f"; done
