#!/usr/bin/env bash
# Builds the LLDB pack's instrument unit (lldb/instrument) into $OUT, run by
# light/scripts/pack-toolchain.sh from this directory of its stage:
#
#   instrument.wasm   the instrumenter (../../instrument, README.md,
#                     "Instrumenting"), compiled to wasm32-unknown-unknown:
#                     what a runner calls on the program it linked before it
#                     runs it under the debugger
#   versions-instrument.json
#
# A minute from nothing. Needs rustup; the pinned toolchain and the target
# are installed here.
set -euo pipefail

UNIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK="$(cd "$UNIT/../.." && pwd)"
# shellcheck source=pins.sh
source "$UNIT/pins.sh"
: "${OUT:?OUT is the toolchain directory of this unit (pack-toolchain.sh sets it)}"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/lldb"
mkdir -p "$CACHE"

if ! rustup target list --toolchain "$RUST_TOOLCHAIN" --installed 2>/dev/null | grep -qx wasm32-unknown-unknown; then
  rustup toolchain install "$RUST_TOOLCHAIN" --profile minimal --target wasm32-unknown-unknown
fi
(cd "$PACK/instrument" && CARGO_TARGET_DIR="$CACHE/instrument-target" cargo "+$RUST_TOOLCHAIN" build --release --locked --lib --target wasm32-unknown-unknown)
cp "$CACHE/instrument-target/wasm32-unknown-unknown/release/yukibana_instrument.wasm" "$OUT/instrument.wasm"
node "$PACK/compress.mjs" "$OUT/instrument.wasm"
printf '{"instrument":"%s","rust":"%s"}\n' "$(sed -n 's/^version = "\(.*\)"/\1/p' "$PACK/instrument/Cargo.toml" | head -1)" "$RUST_TOOLCHAIN" > "$OUT/versions-instrument.json"
