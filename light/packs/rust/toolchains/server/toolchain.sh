#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Builds the Rust pack's server unit into $OUT, run by
# light/scripts/pack-toolchain.sh from this directory of its stage:
#
#   rust-analyzer.wasm  rust-analyzer's IDE crates (ra_ap_ide, crates.io) and
#                       our LSP layer (../../server), compiled to wasm32-wasip1
#   std-src.tar         core, alloc and std from rust-src, what rust-analyzer
#                       reads for the standard library
#   versions-server.json
#
# each with .gz and .br siblings. About 5 minutes from nothing, most of it
# rust-analyzer's crates. Needs rustup; the pinned toolchain and its target
# are installed here.
set -euo pipefail

UNIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK="$(cd "$UNIT/../.." && pwd)"
# shellcheck source=pins.sh
source "$UNIT/pins.sh"
: "${OUT:?OUT is the toolchain directory of this unit (pack-toolchain.sh sets it)}"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/rust"
mkdir -p "$CACHE"

if ! rustup target list --toolchain "$RUST_TOOLCHAIN" --installed 2>/dev/null | grep -qx wasm32-wasip1; then
    rustup toolchain install "$RUST_TOOLCHAIN" --profile minimal --target wasm32-wasip1
fi
# server/Cargo.lock pins every crate; the target directory is cached.
(cd "$PACK/server" && CARGO_TARGET_DIR="$CACHE/target" ${NICE:-} cargo "+$RUST_TOOLCHAIN" build --release --locked --target wasm32-wasip1)
cp "$CACHE/target/wasm32-wasip1/release/yukibana_rust_analyzer.wasm" "$OUT/rust-analyzer.wasm"

SRC_TAR="$CACHE/rust-src-$RA_STD_VERSION.tar.xz"
if [ ! -f "$SRC_TAR" ] || ! echo "$RA_STD_SHA256  $SRC_TAR" | sha256sum -c --quiet - 2>/dev/null; then
    curl -sSfL --retry 4 -o "$SRC_TAR.part" "https://static.rust-lang.org/dist/rust-src-$RA_STD_VERSION.tar.xz"
    echo "$RA_STD_SHA256  $SRC_TAR.part" | sha256sum -c --quiet -
    mv "$SRC_TAR.part" "$SRC_TAR"
fi
LIBRARY="$CACHE/rust-src-$RA_STD_VERSION/rust-src/lib/rustlib/src/rust/library"
[ -d "$LIBRARY/core" ] || tar -xJf "$SRC_TAR" -C "$CACHE"
python3 -I "$PACK/scripts/make-sysroot-src.py" "$LIBRARY" "$OUT/std-src.tar" >&2

node "$PACK/scripts/compress.mjs" "$OUT/rust-analyzer.wasm" "$OUT/std-src.tar" >&2
printf '{"ra_ap_ide":"%s","rust":"%s","rust-src":"%s"}\n' \
    "$(awk '/^name = "ra_ap_ide"$/ { getline; gsub(/"/, "", $3); print $3; exit }' "$PACK/server/Cargo.lock")" "$RUST_TOOLCHAIN" "$RA_STD_VERSION" > "$OUT/versions-server.json"
