#!/usr/bin/env bash
# Builds the Go pack into ../../app/static/packs/go/ from one pinned Go
# release, checked by sha256: its compiler and linker built for
# wasip1/wasm, the pack's own tool (tool/, the language server and the
# build planner) built the same way, and the standard library's archives
# for each target. Idempotent: downloads, the Go build cache and the
# compressed siblings are kept in $PACK_CACHE (default
# ~/.cache/yukibana-packs)/go. Needs curl, tar, node and an x86-64 Linux
# machine (the Go release below is that machine's). About 15 minutes from
# nothing, most of it brotli; a minute after that. The browser tests are
# `npm test` (test.mjs, test-run.mjs).
set -euo pipefail

# The Go release: its binary distribution, which holds the sources too.
GO_VERSION=1.27.3
GO_SHA256=65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40

# Targets the standard library is built for, the default first; the same
# list as tool/internal/project's Targets.
TARGETS=(wasip1/wasm linux/amd64 linux/arm64 linux/riscv64)

# The standard library packages a project may import; what they import is
# shipped too. Left out: networking (no network in the browser or the
# VM), os/exec (no other program to run), cgo, crypto beyond hashes and
# randomness, and the toolchain's own packages (go/..., debug/...), to keep
# the archives at about 60 MB a target. An import of one of the others
# says so (tool/internal/project, Library.ImportProblem).
STD_PACKAGES=(
    bufio bytes cmp context errors flag fmt io io/fs iter log maps os os/signal path path/filepath
    reflect runtime runtime/debug slices sort strconv strings structs sync sync/atomic syscall time
    unicode unicode/utf16 unicode/utf8 unique unsafe weak
    container/heap container/list container/ring
    math math/big math/bits math/cmplx math/rand math/rand/v2
    regexp text/scanner text/tabwriter text/template html
    encoding encoding/base32 encoding/base64 encoding/binary encoding/csv encoding/hex encoding/json encoding/xml
    compress/flate compress/gzip compress/zlib
    hash hash/adler32 hash/crc32 hash/crc64 hash/fnv hash/maphash
    crypto/md5 crypto/rand crypto/sha1 crypto/sha256 crypto/sha512
    testing testing/internal/testdeps testing/quick
)

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(cd "$HERE/../.." && pwd)/app/static/packs/go"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/go"
mkdir -p "$CACHE/dl" "$OUT"

# fetch URL FILE SHA256: downloads once, and checks the file every time.
fetch() {
    if [ ! -f "$2" ]; then
        curl -fsSL --retry 3 -o "$2.part" "$1"
        mv "$2.part" "$2"
    fi
    echo "$3  $2" | sha256sum -c --quiet - || { echo "$2: checksum mismatch (from $1)" >&2; rm -f "$2"; exit 1; }
}

# 1. Go, unpacked once.
TARBALL="$CACHE/dl/go$GO_VERSION.linux-amd64.tar.gz"
fetch "https://dl.google.com/go/go$GO_VERSION.linux-amd64.tar.gz" "$TARBALL" "$GO_SHA256"
GOROOT_DIR="$CACHE/go$GO_VERSION"
if [ ! -f "$GOROOT_DIR/.done" ]; then
    rm -rf "$GOROOT_DIR" && mkdir -p "$GOROOT_DIR"
    tar -xzf "$TARBALL" -C "$GOROOT_DIR" --strip-components=1
    touch "$GOROOT_DIR/.done"
fi
GO="$GOROOT_DIR/bin/go"
# Nothing of this machine's Go setup leaks in: no environment file, no
# toolchain switching, no cgo, a cache of the pack's own.
export GOENV=off GOTOOLCHAIN=local GOFLAGS= CGO_ENABLED=0 GOCACHE="$CACHE/gocache" GOPATH="$CACHE/gopath"
unset GOOS GOARCH GOAMD64 GOARM64 GORISCV64 GOEXPERIMENT
[ "$("$GO" env GOVERSION)" = "go$GO_VERSION" ] || { echo "$GO is not go$GO_VERSION" >&2; exit 1; }

# 2. The pack's tool's own tests (the planner against this machine's
#    compiler and linker, the language server against its standard
#    library), then the compiler and the linker, and the tool, for
#    wasip1/wasm.
#    -s -w: no symbol table or DWARF; a crash still has Go's traceback.
(cd "$HERE/tool" && "$GO" vet ./... && "$GO" test ./...)
for tool in compile link; do
    GOOS=wasip1 GOARCH=wasm "$GO" build -trimpath -ldflags='-s -w' -o "$OUT/$tool.wasm" "cmd/$tool"
done
(cd "$HERE/tool" && GOOS=wasip1 GOARCH=wasm "$GO" build -trimpath -buildmode=c-shared -ldflags='-s -w' -o "$OUT/gotool.wasm" .)

# 3. The standard library: each shipped package's archive (export data and
#    object code, as `go build` leaves them in its cache), built without
#    DWARF since programs are linked with -w, and the index of them.
#    -trimpath keeps this machine's paths out of the archives (a panic
#    names "fmt/print.go").
rm -rf "$OUT/std" && mkdir -p "$OUT/std"
for target in "${TARGETS[@]}"; do
    name="${target/\//-}"
    export GOOS="${target%/*}" GOARCH="${target#*/}"
    "$GO" list -trimpath -gcflags=all=-dwarf=false -export -deps \
        -f '{{if .Export}}{{.ImportPath}}|{{join .Imports " "}}|{{.Export}}{{end}}' "${STD_PACKAGES[@]}" >"$OUT/std/$name.tsv"
    # | between the fields: a tab is whitespace to read, and two of them
    # around an empty import list would read as one.
    while IFS='|' read -r path _ archive; do
        mkdir -p "$OUT/std/$name/$(dirname "$path")"
        cp "$archive" "$OUT/std/$name/$path.a"
    done <"$OUT/std/$name.tsv"
    cut -d'|' -f1,2 "$OUT/std/$name.tsv" | tr '|' '\t' >"$OUT/std/$name.list"
    "$GO" list std >"$OUT/std/$name.all"
    unset GOOS GOARCH
done
node "$HERE/scripts/std-index.mjs" "$GO_VERSION" "$OUT/std" "${TARGETS[@]}"
rm -f "$OUT"/std/*.tsv "$OUT"/std/*.list "$OUT"/std/*.all

# 4. The workers, bundled with browser_wasi_shim; PACK_SIZES gives the
#    downloads' progress bars their totals.
[ -d "$HERE/node_modules/esbuild" ] || (cd "$HERE" && npm ci --no-audit --no-fund)
size() { stat -c %s "$OUT/$1"; }
SIZES="{\"gotool.wasm\":$(size gotool.wasm),\"compile.wasm\":$(size compile.wasm),\"link.wasm\":$(size link.wasm),\"std/index.json\":$(size std/index.json)}"
for worker in server runner linux-worker; do
    "$HERE/node_modules/.bin/esbuild" "$HERE/src/$worker.js" --bundle --format=esm --minify --target=es2022 --log-level=warning \
        --define:PACK_SIZES="$SIZES" --outfile="$OUT/$worker.js"
done

# 5. Licences and precompressed siblings.
cp "$GOROOT_DIR/LICENSE" "$OUT/LICENSE-go.txt"
cp "$HERE/node_modules/@bjorn3/browser_wasi_shim/LICENSE-MIT" "$OUT/LICENSE-browser_wasi_shim.txt"
find "$OUT" -name '*.gz' -delete -o -name '*.br' -delete
mapfile -t files < <(find "$OUT" -type f \( -name '*.wasm' -o -name '*.js' -o -name '*.json' -o -name '*.a' \) | sort)
node "$HERE/scripts/compress.mjs" "$CACHE/compressed" "${files[@]}"
echo "built $(du -sh --exclude='*.gz' --exclude='*.br' "$OUT" | cut -f1) into $OUT"
