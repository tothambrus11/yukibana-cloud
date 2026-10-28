#!/usr/bin/env bash
# Builds the Zig pack into ../../app/static/packs/zig/ from one pinned Zig
# release, checked by sha256: the compiler built from its sources for
# wasm32-wasi without LLVM (so its own backends: WebAssembly and x86-64),
# compiler_rt prebuilt for each target, the standard library's sources,
# and ZLS's own wasm32-wasi release. Idempotent: downloads and the
# compiler's build are kept in $PACK_CACHE (default
# ~/.cache/yukibana-packs)/zig. Needs curl, tar, xz, node and an x86-64
# Linux machine (the Zig that builds the compiler is that machine's). About
# 6 minutes from nothing, most of it the compiler; seconds after that. The
# browser tests are `npm test` (test.mjs, test-run.mjs).
set -euo pipefail

ZIG_VERSION=0.17.0
# The source release, which zig.wasm is built from.
ZIG_SRC_SHA256=b6c7f1728f043700d6529bac980800792f824256a9d2f1839b3d62beed0b8abd
# The x86-64 Linux release: it builds zig.wasm and compiler_rt, and its
# lib/ is the standard library the pack ships.
ZIG_LINUX_SHA256=1cbe9df9f27e6b78d14ccbca43b6703a404ef79ef1c463de901d7f088d4e2026
# ZLS, the Zig language server, as zigtools publishes it for wasm32-wasi
# (builds.zigtools.org/index.json), the release matching Zig's.
ZLS_VERSION=0.17.0
ZLS_SHA256=93bca68284aca1e14cb06665cee8cc4708f010855cf9539b34f4243fd29acd8c

# The targets a project can build for, the default first: the names
# src/zig.js uses, and what -target takes.
TARGETS=(wasm32-wasi x86_64-linux)

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(cd "$HERE/../.." && pwd)/app/static/packs/zig"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/zig"
mkdir -p "$CACHE/dl" "$OUT"

# fetch URL FILE SHA256: downloads once, and checks the file every time.
fetch() {
    if [ ! -f "$2" ]; then
        curl -fsSL --retry 3 -o "$2.part" "$1"
        mv "$2.part" "$2"
    fi
    echo "$3  $2" | sha256sum -c --quiet - || { echo "$2: checksum mismatch (from $1)" >&2; rm -f "$2"; exit 1; }
}

# unpack TARBALL DIR: unpacks once, into DIR.
unpack() {
    if [ ! -f "$2/.done" ]; then
        rm -rf "$2" && mkdir -p "$2"
        tar -xJf "$1" -C "$2" --strip-components=1
        touch "$2/.done"
    fi
}

# 1. The releases.
fetch "https://ziglang.org/download/$ZIG_VERSION/zig-$ZIG_VERSION.tar.xz" "$CACHE/dl/zig-$ZIG_VERSION.tar.xz" "$ZIG_SRC_SHA256"
fetch "https://ziglang.org/download/$ZIG_VERSION/zig-x86_64-linux-$ZIG_VERSION.tar.xz" "$CACHE/dl/zig-x86_64-linux-$ZIG_VERSION.tar.xz" "$ZIG_LINUX_SHA256"
fetch "https://builds.zigtools.org/zls-wasm32-wasi-$ZLS_VERSION.tar.xz" "$CACHE/dl/zls-wasm32-wasi-$ZLS_VERSION.tar.xz" "$ZLS_SHA256"
SRC="$CACHE/zig-$ZIG_VERSION"
ZIG_DIR="$CACHE/zig-x86_64-linux-$ZIG_VERSION"
ZLS_DIR="$CACHE/zls-$ZLS_VERSION"
unpack "$CACHE/dl/zig-$ZIG_VERSION.tar.xz" "$SRC"
unpack "$CACHE/dl/zig-x86_64-linux-$ZIG_VERSION.tar.xz" "$ZIG_DIR"
if [ ! -f "$ZLS_DIR/.done" ]; then
    rm -rf "$ZLS_DIR" && mkdir -p "$ZLS_DIR"
    tar -xJf "$CACHE/dl/zls-wasm32-wasi-$ZLS_VERSION.tar.xz" -C "$ZLS_DIR"
    touch "$ZLS_DIR/.done"
fi
ZIG="$ZIG_DIR/zig"
export ZIG_GLOBAL_CACHE_DIR="$CACHE/global-cache" ZIG_LOCAL_CACHE_DIR="$CACHE/local-cache"
[ "$("$ZIG" version)" = "$ZIG_VERSION" ] || { echo "$ZIG is not $ZIG_VERSION" >&2; exit 1; }

# 2. The compiler for wasm32-wasi: without LLVM (which has not been built
#    for WebAssembly here), so it has Zig's own backends and linkers;
#    single-threaded, as a browser worker running WASI is; without lib/,
#    which ships as lib.tar. Rebuilt when the cached one is missing.
if [ ! -f "$CACHE/zig.wasm" ]; then
    (cd "$SRC" && "$ZIG" build -Dtarget=wasm32-wasi -Doptimize=ReleaseSmall -Denable-llvm=false -Dno-lib \
        -Dversion-string="$ZIG_VERSION" -Dsingle-threaded=true --prefix "$CACHE/zig-wasm")
    cp "$CACHE/zig-wasm/bin/zig.wasm" "$CACHE/zig.wasm"
fi
cp "$CACHE/zig.wasm" "$OUT/zig.wasm"
cp "$ZLS_DIR/zls.wasm" "$OUT/zls.wasm"

# 3. compiler_rt for each target, built once here with LLVM: the runner
#    passes it with -fno-compiler-rt rather than having the compiler build
#    it in the browser (the WebAssembly linker cannot read the archive its
#    own backend writes, and the x86-64 one takes seconds a run).
mkdir -p "$OUT/rt"
for target in "${TARGETS[@]}"; do
    "$ZIG" build-lib "$ZIG_DIR/lib/compiler_rt.zig" -target "$target" -O ReleaseSmall -fstrip --name compiler_rt \
        -femit-bin="$OUT/rt/compiler_rt-$target.a"
done
rm -f "$OUT"/rt/*.o

# 4. The standard library's sources, and what a build or a test reads
#    besides (lib/*.zig, the test runner), as one ustar archive (src/files.js, untar).
rm -f "$OUT/lib.tar"
(cd "$ZIG_DIR" && tar --format=ustar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf "$OUT/lib.tar" \
    lib/std lib/c.zig lib/compiler_rt.zig lib/fuzzer.zig lib/ubsan_rt.zig lib/compiler/test_runner.zig)

# 5. The workers, bundled with browser_wasi_shim; PACK_SIZES gives the
#    downloads' progress bars their totals.
[ -d "$HERE/node_modules/esbuild" ] || (cd "$HERE" && npm ci --no-audit --no-fund)
size() { stat -c %s "$OUT/$1"; }
SIZES="{\"zig.wasm\":$(size zig.wasm),\"zls.wasm\":$(size zls.wasm),\"lib.tar\":$(size lib.tar)"
for target in "${TARGETS[@]}"; do SIZES+=",\"rt/compiler_rt-$target.a\":$(size "rt/compiler_rt-$target.a")"; done
SIZES+="}"
for worker in server zls check runner linux-worker; do
    "$HERE/node_modules/.bin/esbuild" "$HERE/src/$worker.js" --bundle --format=esm --minify --target=es2022 --log-level=warning \
        --define:PACK_SIZES="$SIZES" --outfile="$OUT/$worker.js"
done

# 6. Licences and precompressed siblings.
cp "$ZIG_DIR/LICENSE" "$OUT/LICENSE-zig.txt"
cp "$ZLS_DIR/LICENSE" "$OUT/LICENSE-zls.txt"
cp "$HERE/node_modules/@bjorn3/browser_wasi_shim/LICENSE-MIT" "$OUT/LICENSE-browser_wasi_shim.txt"
find "$OUT" -name '*.gz' -delete -o -name '*.br' -delete
mapfile -t files < <(find "$OUT" -type f \( -name '*.wasm' -o -name '*.js' -o -name '*.tar' -o -name '*.a' \) | sort)
node "$HERE/scripts/compress.mjs" "$CACHE/compressed" "${files[@]}"
echo "built $(du -sh --exclude='*.gz' --exclude='*.br' "$OUT" | cut -f1) into $OUT"
