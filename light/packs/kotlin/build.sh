#!/usr/bin/env bash
# Builds the Kotlin pack into ../../app/static/packs/kotlin/:
#
#   tree-sitter.js, tree-sitter.wasm   web-tree-sitter $WEB_TREE_SITTER_VERSION (the
#                                      tree-sitter runtime, compiled to WebAssembly)
#   tree-sitter-kotlin.wasm            the Kotlin grammar (tree-sitter-grammars/
#                                      tree-sitter-kotlin $KOTLIN_GRAMMAR_VERSION), as published
#   kc.js, kc.js.wasm                  kotlinc (K2), compiled to WebAssembly GC by GraalVM
#                                      Web Image (kotlinc/build.sh, kotlinc/README.md)
#   kotlin-stdlib-wasm-wasi.klib,      the libraries a Kotlin/Wasm WASI compilation reads,
#   kotlin-test-wasm-wasi.klib         with stored zip entries
#   kotlinc.js                         loads kotlinc into a worker (src/kotlinc.js)
#   server.js, check.js                the language server worker, and its kotlinc worker
#   runner.js, program.js              the runner (CONTRACT.md, "Running a program"), and
#                                      the worker a program runs in
#   manifest.json                      file names, sizes and versions
#   LICENSE-*.txt, SOURCES.txt         the packages' licences, and where the source of kc.js.wasm's GPL
#                                      parts is (kotlinc/build.sh)
#   *.gz, *.br                         compressed siblings
#
# Idempotent; the npm tarballs are cached in $PACK_CACHE/kotlin (default
# ~/.cache/yukibana-packs/kotlin) and checked against the registry's sha512.
# kotlinc in WebAssembly is built by kotlinc/build.sh, which pins its own
# downloads by sha256, into $PACK_CACHE/kotlin/kotlinc-<key>, where <key> is
# a hash of kotlinc/'s build inputs: an edit of the pack's JavaScript reuses
# it, an edit of kotlinc/build.sh or its Java builds it again (about 6
# minutes and 11 GB of memory, 15 minutes with the downloads). Needs curl,
# node 22+, python3, zip and unzip.
set -euo pipefail

WEB_TREE_SITTER_VERSION=0.25.10
WEB_TREE_SITTER_SHA512=Y09sF44/13XvgVKgO2cNDw5rGk6s26MgoZPXLESvMXeefBf7i6/73eFurre0IsTW6E14Y0ArIzhUMmjoc7xyzA==
KOTLIN_GRAMMAR_VERSION=1.1.0
KOTLIN_GRAMMAR_SHA512=vlVXaxEE8t2kpJgfZpa8XVvxcnKw9AYtRTgy7KWjsDmAsadk06RxAT80IXOgGQnmM9i/orQn1nD84gPNUHu6DQ==
REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(cd "$HERE/../.." && pwd)/app/static/packs/kotlin"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/kotlin"
rm -rf "$OUT"
mkdir -p "$CACHE" "$OUT"

fetch() { # fetch <url> <file> <sha512 base64>: into $CACHE, verified
    local dst="$CACHE/$2"
    if [ ! -f "$dst" ]; then
        curl -fsSL -o "$dst.part" "$1"
        mv "$dst.part" "$dst"
    fi
    if [ "$(openssl dgst -sha512 -binary "$dst" | base64 -w0)" != "$3" ]; then
        rm -f "$dst"
        echo "checksum mismatch: $2" >&2
        exit 1
    fi
}
fetch "$REGISTRY/web-tree-sitter/-/web-tree-sitter-$WEB_TREE_SITTER_VERSION.tgz" \
    "web-tree-sitter-$WEB_TREE_SITTER_VERSION.tgz" "$WEB_TREE_SITTER_SHA512"
fetch "$REGISTRY/@tree-sitter-grammars/tree-sitter-kotlin/-/tree-sitter-kotlin-$KOTLIN_GRAMMAR_VERSION.tgz" \
    "tree-sitter-kotlin-$KOTLIN_GRAMMAR_VERSION.tgz" "$KOTLIN_GRAMMAR_SHA512"

# Only the files the pack serves, straight from the tarballs.
python3 -I "$HERE/scripts/extract.py" "$CACHE/web-tree-sitter-$WEB_TREE_SITTER_VERSION.tgz" "$OUT" \
    package/tree-sitter.js package/tree-sitter.wasm package/LICENSE=LICENSE-web-tree-sitter.txt
python3 -I "$HERE/scripts/extract.py" "$CACHE/tree-sitter-kotlin-$KOTLIN_GRAMMAR_VERSION.tgz" "$OUT" \
    package/tree-sitter-kotlin.wasm package/LICENSE=LICENSE-tree-sitter-kotlin.txt

# kotlinc, from the cache when kotlinc/ is unchanged. Its kc.js.wasm is
# compressed there too: brotli at quality 11 takes minutes on 91 MB.
# The key covers what the image is built from, not the README or the tests.
KEY="$(cd "$HERE/kotlinc" && find build.sh config service substitutions tools trace -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16)"
KC="$CACHE/kotlinc-$KEY"
if [ ! -f "$KC/kc.js.wasm.br" ]; then
    find "$CACHE" -maxdepth 1 -name 'kotlinc-*' ! -name kotlinc-build -exec rm -rf {} +
    YK_CACHE="$CACHE/kotlinc-build" "$HERE/kotlinc/build.sh" "$KC.part"
    node "$HERE/scripts/compress.mjs" "$KC.part/kc.js.wasm"
    mv "$KC.part" "$KC"
fi
# kc.js takes the wasm bytes the pack's loader downloaded (src/kotlinc.js),
# so that the download reports its progress.
sed 's|const file = await runtime.fetchData(wasmPath);|const file = globalThis.ykWasmBytes \|\| await runtime.fetchData(wasmPath);|' "$KC/kc.js" > "$OUT/kc.js"
grep -q ykWasmBytes "$OUT/kc.js" || { echo "kc.js: the line that fetches the wasm moved" >&2; exit 1; }
cp "$KC/kc.js.wasm" "$KC/kc.js.wasm.gz" "$KC/kc.js.wasm.br" "$OUT/"
cp "$KC/lib/kotlin-stdlib-wasm-wasi.klib" "$KC/lib/kotlin-test-wasm-wasi.klib" "$OUT/"
cp "$KC/LICENSE-graalvm.txt" "$KC/LICENSE-kotlin.txt" "$KC/LICENSE-openjdk.txt" "$KC/SOURCES.txt" "$OUT/"

cp "$HERE"/src/server.js "$HERE"/src/check.js "$HERE"/src/kotlinc.js "$HERE"/src/runner.js "$HERE"/src/program.js "$OUT/"
node "$HERE/scripts/finish.mjs" "$OUT" "$WEB_TREE_SITTER_VERSION" "$KOTLIN_GRAMMAR_VERSION" "$KC/versions.json"
