#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Builds the Rust pack's sysroots unit into $OUT, run by
# light/scripts/pack-toolchain.sh from this directory of its stage: what the
# compilers compile against, all of the compilers unit's release (its
# build-only/pins.sh, at $DEP_COMPILERS), since a crate loads only into a
# compiler of the same version string:
#
#   sysroot-<triple>.tar       for each target (src/targets.json), Rust's own
#                              rust-std, sha256 pinned
#   miri-sysroot-<triple>.tar  for each Miri target (src/miri-targets.json),
#                              the standard library built for Miri by the
#                              release's own Miri (`cargo miri setup`)
#   <crates>-<triple>.tar, <crates>-miri-<triple>.tar, <crates>-src.tar
#                              the crates.io packages a project may depend
#                              on (crates/), compiled by the release's Cargo
#                              for every target and for Miri's, and their
#                              sources (scripts/build-crates.mjs)
#   versions-sysroots.json
#
# each .tar with .gz and .br siblings. About 25 minutes from nothing on 4
# cores, most of it brotli. Needs rustup; the release's toolchain, with
# rustc-dev for Miri, is installed here.
set -euo pipefail

UNIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK="$(cd "$UNIT/../.." && pwd)"
: "${DEP_COMPILERS:?needs the rust/compilers unit at \$DEP_COMPILERS: build through light/scripts/pack-toolchain.sh ensure}"
# shellcheck source=../compilers/pins.sh
source "$DEP_COMPILERS/build-only/pins.sh"
# shellcheck source=pins.sh
source "$UNIT/pins.sh"
: "${OUT:?OUT is the toolchain directory of this unit (pack-toolchain.sh sets it)}"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/rust"
NICE="${NICE:-}"
mkdir -p "$CACHE"
TAR=(tar --format=ustar --owner=0 --group=0 --numeric-owner --mtime=@0 --sort=name)
fetch() { # url sha256 file
    if [ ! -f "$3" ] || ! echo "$2  $3" | sha256sum -c --quiet - 2>/dev/null; then
        curl -sSfL --retry 4 -o "$3.part" "$1"
        echo "$2  $3.part" | sha256sum -c --quiet - || { echo "toolchain.sh: $1 is not the file pinned" >&2; exit 1; }
        mv "$3.part" "$3"
    fi
}
triples() { node -e 'for (const t of require(process.argv[1])) console.log(t.triple)' "$1"; }
mapfile -t TRIPLES < <(triples "$PACK/src/targets.json")
mapfile -t MIRI_TRIPLES < <(triples "$PACK/src/miri-targets.json")

# The standard library of each target, Rust's own build of it. Left out:
# the sanitizers' runtimes, the profiler's, the dynamic libstd and
# proc_macro (nothing here links one, runs one, or loads one), which are
# most of its size.
for triple in "${TRIPLES[@]}"; do
    pin="RUST_STD_$(echo "$triple" | tr 'a-z-' 'A-Z_')_SHA256"
    [ -n "${!pin:-}" ] || { echo "toolchain.sh: no $pin in pins.sh for $triple (src/targets.json)" >&2; exit 1; }
    tarball="$CACHE/rust-std-$RUST_VERSION-$triple.tar.xz"
    fetch "https://static.rust-lang.org/dist/rust-std-$RUST_VERSION-$triple.tar.xz" "${!pin}" "$tarball"
    work="$(mktemp -d)"
    tar -xJf "$tarball" -C "$work" --strip-components=2 "rust-std-$RUST_VERSION-$triple/rust-std-$triple/lib"
    find "$work/lib/rustlib/$triple/lib" -maxdepth 1 \( -name 'librustc-*_rt.*.a' -o -name '*.so' -o -name 'libproc_macro-*' -o -name 'libprofiler_builtins-*' \) -delete
    "${TAR[@]}" -C "$work" -cf "$OUT/sysroot-$triple.tar" lib
    rm -rf "$work"
done

# The release's own Miri, built natively from its source tarball's
# src/tools/miri (it needs the release's rustc-dev), which builds the
# standard library for Miri (cfg miri, every function's MIR, no code) for
# each of Miri's targets, and the crates below.
if ! rustup component list --toolchain "$RUST_VERSION" --installed 2>/dev/null | grep -q '^rustc-dev'; then
    rustup toolchain install "$RUST_VERSION" --profile minimal --component rustc-dev,llvm-tools,rust-src
fi
for t in "${TRIPLES[@]}"; do rustup target add --toolchain "$RUST_VERSION" "$t" >&2; done
SRC_TARBALL="$CACHE/rustc-$RUST_VERSION-src.tar.xz"
fetch "https://static.rust-lang.org/dist/rustc-$RUST_VERSION-src.tar.xz" "$RUST_SRC_SHA256" "$SRC_TARBALL"
MIRI_SRC="$CACHE/rustc-$RUST_VERSION-src/src/tools/miri"
[ -f "$MIRI_SRC/Cargo.toml" ] || tar -xJf "$SRC_TARBALL" -C "$CACHE" "rustc-$RUST_VERSION-src/src/tools/miri"
# Miri links the release's librustc_driver, which is in its sysroot's lib.
RUSTC_BOOTSTRAP=1 LD_LIBRARY_PATH="$(rustup run "$RUST_VERSION" rustc --print sysroot)/lib"
export RUSTC_BOOTSTRAP LD_LIBRARY_PATH
(cd "$MIRI_SRC" && CARGO_TARGET_DIR="$CACHE/miri-target" $NICE cargo "+$RUST_VERSION" build --release --locked >&2)
(cd "$MIRI_SRC/cargo-miri" && CARGO_TARGET_DIR="$CACHE/miri-target" $NICE cargo "+$RUST_VERSION" build --release --locked >&2)
MIRI="$CACHE/miri-target/release/miri" CARGO_MIRI="$CACHE/miri-target/release/cargo-miri" MIRI_SYSROOTS="$(mktemp -d)"
export MIRI CARGO_MIRI MIRI_SYSROOTS
for triple in "${MIRI_TRIPLES[@]}"; do
    RUSTUP_TOOLCHAIN="$RUST_VERSION" MIRI_SYSROOT="$MIRI_SYSROOTS/$triple" $NICE "$CARGO_MIRI" miri setup --target "$triple" >&2
    # Its rlibs: std has no .rmeta of its own. In name order, so that the
    # archive is the same every time.
    work="$(mktemp -d)"
    (cd "$MIRI_SYSROOTS/$triple" && find lib -name '*.rlib' -exec cp --parents {} "$work/" \;)
    "${TAR[@]}" -C "$work" -cf "$OUT/miri-sysroot-$triple.tar" lib
    rm -rf "$work"
done

# The crates.io packages a project may depend on, compiled by Cargo for
# every target and for Miri's.
QUICKCHECK_VERSION="$(awk '/^name = "quickcheck"$/ { getline; gsub(/"/, "", $3); print $3; exit }' "$PACK/crates/Cargo.lock")"
join() { local IFS=,; echo "$*"; }
crates_target="$(mktemp -d)"
$NICE node "$PACK/scripts/build-crates.mjs" "$RUST_VERSION" "$crates_target" "$OUT" "quickcheck-$QUICKCHECK_VERSION" "$(join "${TRIPLES[@]}")" "$(join "${MIRI_TRIPLES[@]}")" >&2
rm -rf "$crates_target" "$MIRI_SYSROOTS"

mapfile -t made < <(find "$OUT" -maxdepth 1 -name '*.tar' | sort)
node "$PACK/scripts/compress.mjs" "${made[@]}" >&2
printf '{"rust":"%s","quickcheck":"%s","targets":%s,"miri":%s}\n' "$RUST_VERSION" "$QUICKCHECK_VERSION" \
    "$(printf '%s\n' "${TRIPLES[@]}" | node -e 'console.log(JSON.stringify(require("fs").readFileSync(0, "utf8").trim().split("\n")))')" \
    "$(printf '%s\n' "${MIRI_TRIPLES[@]}" | node -e 'console.log(JSON.stringify(require("fs").readFileSync(0, "utf8").trim().split("\n")))')" > "$OUT/versions-sysroots.json"
