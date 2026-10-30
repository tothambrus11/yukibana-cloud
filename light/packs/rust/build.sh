#!/usr/bin/env bash
# Builds the Rust pack into ../../app/static/packs/rust/. Idempotent: each
# step is skipped when its output is in the cache ($PACK_CACHE, default
# ~/.cache/yukibana-packs). Needs curl, python3, node 22, npm, xz and
# rustup (the pinned toolchains are installed by this script). About 20
# minutes from nothing, most of it brotli; the compilers are downloaded,
# not built (step 4).
#
#   server     rust-analyzer's IDE crates (ra_ap_ide, crates.io) and our LSP
#              layer (server/), compiled to wasm32-wasip1 with Rust 1.98.0
#   std-src    core, alloc and std from rust-src 1.98.0, for rust-analyzer
#   compilers  rustc.wasm, rustc-cross.wasm and miri.wasm, from the release
#              light-rust-toolchain.yml made with rustc/build.sh (step 4)
#   sysroots   for each target, the standard library Rust ships for it
#              (rust-std 1.98.1, static.rust-lang.org, sha256 pinned), and
#              for each of Miri's the standard library built for Miri by
#              Rust 1.98.1's own Miri (`cargo miri setup`)
#   crates     quickcheck and its dependencies from crates.io
#              (crates/Cargo.lock pins versions and checksums), compiled
#              for every target and for Miri's, and packed as sources for
#              the server
#   workers    server.js, runner.js, thread.js, linux-worker.js, explorer.js
set -euo pipefail

RUST_TOOLCHAIN=1.98.0          # ra_ap_* 0.0.358 needs rustc >= 1.98
# The standard library rust-analyzer reads: the release the server is built
# with (see README).
RA_STD_VERSION=1.98.0
RA_STD_SHA256=0e977492aed5ff137815bf9b4b796e8a85b80fb2367ed64e82d5c5839870f2bf
# The release rustc.wasm is built from (rustc/pins.sh): its rust-std, and
# the toolchain whose Miri builds Miri's standard library and whose Cargo
# builds the crates, since a crate loads only into a compiler of the same
# version string.
# shellcheck source=rustc/pins.sh
. "$(dirname "${BASH_SOURCE[0]}")/rustc/pins.sh"
# rust-std-1.98.1-<triple>.tar.xz, as static.rust-lang.org's .sha256 say.
declare -A RUST_STD_SHA256=(
    [wasm32-wasip1]=b5e91be9ed75c632a4c576d3c4c725ab143cd48c27c345133b97ccdf217b23e7
    [x86_64-unknown-linux-musl]=bd9f35880de21dab0e387e84009c00001ae7836a4ba565cb16823f13f75f325f
    [aarch64-unknown-linux-musl]=7e0ad2e67817f224b7a6331e48d6397303fc050edaccf81784ed786ffddc884a
    [riscv64gc-unknown-linux-musl]=4144e47bb60bbc3172345095ad4e5e7ea7dc28c9b900eab888a4a5944f34d157
)
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(cd "$HERE/../.." && pwd)/app/static/packs/rust"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/rust"
NICE="nice -n 10"
mkdir -p "$CACHE" "$OUT"

# 1. The toolchain that builds the server.
if ! rustup run "$RUST_TOOLCHAIN" rustc --print target-list >/dev/null 2>&1 \
    || ! rustup target list --toolchain "$RUST_TOOLCHAIN" --installed | grep -qx wasm32-wasip1; then
    rustup toolchain install "$RUST_TOOLCHAIN" --profile minimal --target wasm32-wasip1
fi

# 2. The server: Cargo.lock pins every crate; the target directory is cached.
(cd "$HERE/server" && CARGO_TARGET_DIR="$CACHE/target" $NICE cargo "+$RUST_TOOLCHAIN" build --release --locked --target wasm32-wasip1)
cp "$CACHE/target/wasm32-wasip1/release/yukibana_rust_analyzer.wasm" "$OUT/rust-analyzer.wasm"

# 3. The standard library's sources, for rust-analyzer.
SRC_TAR="$CACHE/rust-src-$RA_STD_VERSION.tar.xz"
if [ ! -f "$SRC_TAR" ]; then
    curl -sSfL -o "$SRC_TAR.part" "https://static.rust-lang.org/dist/rust-src-$RA_STD_VERSION.tar.xz"
    mv "$SRC_TAR.part" "$SRC_TAR"
fi
echo "$RA_STD_SHA256  $SRC_TAR" | sha256sum -c --quiet
LIBRARY="$CACHE/rust-src-$RA_STD_VERSION/rust-src/lib/rustlib/src/rust/library"
if [ ! -d "$LIBRARY/core" ]; then
    tar -xJf "$SRC_TAR" -C "$CACHE"
fi
python3 -I "$HERE/scripts/make-sysroot-src.py" "$LIBRARY" "$OUT/std-src.tar"

# 4. The compilers: the release light-rust-toolchain.yml published from
#    rustc/build.sh, each file checked against its pin; or, with RUSTC_OUT
#    set, the ones in that directory (a local rustc/build.sh's $OUT); or,
#    with RUSTC_BUILD=1, rustc/build.sh run here (hours).
RUSTC_RELEASE=""   # rust-1.98.1-wasm-<n>, once the workflow has published one
declare -A RUSTC_SHA256=(
    [rustc.wasm]=""
    [rustc-cross.wasm]=""
    [miri.wasm]=""
)
if [ -n "${RUSTC_OUT:-}" ]; then
    COMPILERS="$RUSTC_OUT"
elif [ "${RUSTC_BUILD:-}" = 1 ]; then
    COMPILERS="$CACHE/rustc/out"
    OUT="$COMPILERS" PACK_CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}" $NICE "$HERE/rustc/build.sh"
elif [ -n "$RUSTC_RELEASE" ]; then
    COMPILERS="$CACHE/$RUSTC_RELEASE"
    mkdir -p "$COMPILERS"
    for c in "${!RUSTC_SHA256[@]}"; do
        if [ ! -f "$COMPILERS/$c" ]; then
            curl -sSfL --retry 4 -o "$COMPILERS/$c.part" "https://github.com/tothambrus11/yukibana-cloud/releases/download/$RUSTC_RELEASE/$c"
            mv "$COMPILERS/$c.part" "$COMPILERS/$c"
        fi
        echo "${RUSTC_SHA256[$c]}  $COMPILERS/$c" | sha256sum -c --quiet
    done
else
    echo "build.sh: no compilers: set RUSTC_OUT to a directory with rustc.wasm, rustc-cross.wasm and miri.wasm," >&2
    echo "RUSTC_BUILD=1 to build them here (rustc/build.sh, hours), or pin a release of light-rust-toolchain.yml" >&2
    exit 1
fi
for c in rustc rustc-cross miri; do cp "$COMPILERS/$c.wasm" "$OUT/$c.wasm"; done

# The targets: rustc's (src/targets.json) and Miri's (src/miri-targets.json).
triples() { node -e 'for (const t of require(process.argv[1])) console.log(t.triple)' "$1"; }
mapfile -t TRIPLES < <(triples "$HERE/src/targets.json")
mapfile -t MIRI_TRIPLES < <(triples "$HERE/src/miri-targets.json")

# 5. The standard library of each target, Rust's own build of it. Left out:
#    the sanitizers' runtimes, the profiler's, the dynamic libstd and
#    proc_macro (nothing here links one, runs one, or loads one), which are
#    most of its size.
rm -f "$OUT"/sysroot-*.tar*
for triple in "${TRIPLES[@]}"; do
    tarball="$CACHE/rust-std-$RUST_VERSION-$triple.tar.xz"
    if [ ! -f "$tarball" ]; then
        curl -sSfL --retry 4 -o "$tarball.part" "https://static.rust-lang.org/dist/rust-std-$RUST_VERSION-$triple.tar.xz"
        mv "$tarball.part" "$tarball"
    fi
    echo "${RUST_STD_SHA256[$triple]}  $tarball" | sha256sum -c --quiet
    if [ ! -f "$CACHE/sysroot-$triple.tar" ] || [ "$HERE/build.sh" -nt "$CACHE/sysroot-$triple.tar" ]; then
        work="$(mktemp -d)"
        tar -xJf "$tarball" -C "$work" --strip-components=2 "rust-std-$RUST_VERSION-$triple/rust-std-$triple/lib"
        lib="$work/lib/rustlib/$triple/lib"
        find "$lib" -maxdepth 1 \( -name 'librustc-*_rt.*.a' -o -name '*.so' -o -name 'libproc_macro-*' -o -name 'libprofiler_builtins-*' \) -delete
        tar --format=ustar --owner=0 --group=0 --numeric-owner --mtime=@0 --sort=name -C "$work" -cf "$CACHE/sysroot-$triple.tar.part" lib
        mv "$CACHE/sysroot-$triple.tar.part" "$CACHE/sysroot-$triple.tar"
        rm -rf "$work"
    fi
    cp "$CACHE/sysroot-$triple.tar" "$OUT/"
done

# 6. Rust 1.98.1's own Miri, built natively from the same tree's
#    src/tools/miri (it needs the release's rustc-dev), which builds the
#    standard library for Miri (`cargo miri setup`: cfg miri, every
#    function's MIR, metadata only) for each of Miri's targets, and the
#    crates below.
if ! rustup run "$RUST_VERSION" rustc --print sysroot >/dev/null 2>&1 \
    || ! rustup component list --toolchain "$RUST_VERSION" --installed | grep -q '^rustc-dev'; then
    rustup toolchain install "$RUST_VERSION" --profile minimal --component rustc-dev,llvm-tools,rust-src
fi
# Miri's sources, from the release's source tarball (only src/tools/miri).
SRC_TARBALL="$CACHE/rustc-$RUST_VERSION-src.tar.xz"
if [ ! -f "$SRC_TARBALL" ]; then
    curl -sSfL --retry 4 -o "$SRC_TARBALL.part" "https://static.rust-lang.org/dist/rustc-$RUST_VERSION-src.tar.xz"
    mv "$SRC_TARBALL.part" "$SRC_TARBALL"
fi
echo "$RUST_SRC_SHA256  $SRC_TARBALL" | sha256sum -c --quiet
MIRI_SRC="$CACHE/rustc-$RUST_VERSION-src/src/tools/miri"
[ -f "$MIRI_SRC/Cargo.toml" ] || tar -xJf "$SRC_TARBALL" -C "$CACHE" "rustc-$RUST_VERSION-src/src/tools/miri"
# Miri links the release's librustc_driver, which is in its sysroot's lib.
export RUSTC_BOOTSTRAP=1 LD_LIBRARY_PATH="$(rustup run "$RUST_VERSION" rustc --print sysroot)/lib"
(cd "$MIRI_SRC" && CARGO_TARGET_DIR="$CACHE/miri-target" $NICE cargo "+$RUST_VERSION" build --release --locked)
(cd "$MIRI_SRC/cargo-miri" && CARGO_TARGET_DIR="$CACHE/miri-target" $NICE cargo "+$RUST_VERSION" build --release --locked)
export MIRI="$CACHE/miri-target/release/miri" CARGO_MIRI="$CACHE/miri-target/release/cargo-miri" MIRI_SYSROOTS="$CACHE/miri-sysroots"
rm -f "$OUT"/miri-sysroot-*.tar*
for triple in "${MIRI_TRIPLES[@]}"; do
    RUSTUP_TOOLCHAIN="$RUST_VERSION" MIRI_SYSROOT="$MIRI_SYSROOTS/$triple" $NICE "$CARGO_MIRI" miri setup --target "$triple"
    work="$(mktemp -d)"
    (cd "$MIRI_SYSROOTS/$triple" && find lib -name '*.rmeta' -print0 | tar --format=ustar --owner=0 --group=0 --numeric-owner --mtime=@0 --null -T - -cf "$work/s.tar")
    # In name order, so that the archive is the same every time.
    mkdir "$work/x" && tar -xf "$work/s.tar" -C "$work/x"
    tar --format=ustar --owner=0 --group=0 --numeric-owner --mtime=@0 --sort=name -C "$work/x" -cf "$OUT/miri-sysroot-$triple.tar" lib
    rm -rf "$work"
done

# 7. The crates.io packages a project may depend on (crates/), compiled by
#    Cargo for every target and for Miri's (scripts/build-crates.mjs).
#    Rebuilt when the lock file or the script changes.
[ -d "$HERE/node_modules/esbuild" ] || (cd "$HERE" && npm ci --no-audit --no-fund)
QUICKCHECK_VERSION="$(awk '/^name = "quickcheck"$/ { getline; gsub(/"/, "", $3); print $3 }' "$HERE/crates/Cargo.lock")"
CRATES="quickcheck-$QUICKCHECK_VERSION"
join() { local IFS=,; echo "$*"; }
if [ ! -f "$CACHE/$CRATES-src.tar" ] || [ "$HERE/crates/Cargo.lock" -nt "$CACHE/$CRATES-src.tar" ] || [ "$HERE/scripts/build-crates.mjs" -nt "$CACHE/$CRATES-src.tar" ]; then
    rm -rf "$CACHE/crates-target"
    for t in "${TRIPLES[@]}"; do rustup target add --toolchain "$RUST_VERSION" "$t" >/dev/null; done
    $NICE node "$HERE/scripts/build-crates.mjs" "$RUST_VERSION" "$CACHE/crates-target" "$CACHE" "$CRATES" "$(join "${TRIPLES[@]}")" "$(join "${MIRI_TRIPLES[@]}")"
fi
rm -f "$OUT"/quickcheck-*.tar*
cp "$CACHE/$CRATES-src.tar" "$OUT/"
CRATES_FILES="{$(for t in "${TRIPLES[@]}"; do cp "$CACHE/$CRATES-$t.tar" "$OUT/"; printf '"%s":"%s",' "$t" "$CRATES-$t.tar"; done | sed 's/,$//')}"
MIRI_CRATES_FILES="{$(for t in "${MIRI_TRIPLES[@]}"; do cp "$CACHE/$CRATES-miri-$t.tar" "$OUT/"; printf '"%s":"%s",' "$t" "$CRATES-miri-$t.tar"; done | sed 's/,$//')}"
CRATES_DIRECT="{\"quickcheck\":\"$QUICKCHECK_VERSION\"}"

# 8. The workers, bundled (the WASI file system comes from npm). SIZES_JSON
#    gives the downloads' progress bars their totals.
size() { stat -c %s "$OUT/$1"; }
SIZES_JSON="{$(cd "$OUT" && for f in *.wasm *.tar; do printf '"%s":%s,' "$f" "$(stat -c %s "$f")"; done | sed 's/,$//')}"
ESBUILD=("$HERE/node_modules/.bin/esbuild" --bundle --format=esm --minify --target=es2022 --log-level=warning)
"${ESBUILD[@]}" "$HERE/src/server.js" \
    --define:SERVER_WASM_SIZE="$(size rust-analyzer.wasm)" --define:STD_SRC_SIZE="$(size std-src.tar)" \
    --define:CRATES_SRC_FILE="\"$CRATES-src.tar\"" --define:CRATES_SRC_SIZE="$(size "$CRATES-src.tar")" --define:CRATES_DIRECT="$CRATES_DIRECT" --outfile="$OUT/server.js"
for worker in runner explorer; do
    "${ESBUILD[@]}" "$HERE/src/$worker.js" --loader:.rs=text \
        --define:SIZES_JSON="$SIZES_JSON" --define:CRATES_FILES="$CRATES_FILES" --define:MIRI_CRATES_FILES="$MIRI_CRATES_FILES" --define:CRATES_DIRECT="$CRATES_DIRECT" \
        --outfile="$OUT/$worker.js"
done
for worker in thread linux-worker; do "${ESBUILD[@]}" "$HERE/src/$worker.js" --outfile="$OUT/$worker.js"; done
rm -f "$OUT/sysroot.tar"* "$OUT/quickcheck-1.0.3.tar"*

# 9. Licences and precompressed siblings.
cp "$HERE/LICENSES.txt" "$OUT/LICENSES.txt"
find "$OUT" -name '*.gz' -delete -o -name '*.br' -delete
mapfile -t files < <(find "$OUT" -maxdepth 1 -type f \( -name '*.wasm' -o -name '*.js' -o -name '*.tar' \) | sort)
node "$HERE/scripts/compress.mjs" "${files[@]}"
echo "built $(du -sh --exclude='*.gz' --exclude='*.br' "$OUT" | cut -f1) into $OUT"
