# shellcheck shell=bash disable=SC2034
# The sysroots unit's pins: plain NAME=value lines. The release is the
# compilers unit's (RUST_VERSION and the source tarball's RUST_SRC_SHA256,
# read from its build-only/pins.sh at $DEP_COMPILERS); the crates are
# pinned by ../../crates/Cargo.lock.

# rust-std-<RUST_VERSION>-<triple>.tar.xz, as static.rust-lang.org's .sha256
# say, for each of src/targets.json's triples.
RUST_STD_WASM32_WASIP1_SHA256=b5e91be9ed75c632a4c576d3c4c725ab143cd48c27c345133b97ccdf217b23e7
RUST_STD_X86_64_UNKNOWN_LINUX_MUSL_SHA256=bd9f35880de21dab0e387e84009c00001ae7836a4ba565cb16823f13f75f325f
RUST_STD_AARCH64_UNKNOWN_LINUX_MUSL_SHA256=7e0ad2e67817f224b7a6331e48d6397303fc050edaccf81784ed786ffddc884a
RUST_STD_RISCV64GC_UNKNOWN_LINUX_MUSL_SHA256=4144e47bb60bbc3172345095ad4e5e7ea7dc28c9b900eab888a4a5944f34d157
