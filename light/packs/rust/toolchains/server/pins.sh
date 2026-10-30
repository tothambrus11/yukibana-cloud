# shellcheck shell=bash disable=SC2034
# The server unit's pins: plain NAME=value lines. The crates are pinned by
# ../../server/Cargo.lock.

# The Rust the server is compiled with: ra_ap_* 0.0.358 needs rustc 1.98.
RUST_TOOLCHAIN=1.98.0
# The standard library rust-analyzer reads, that release's (README, "Why
# std 1.98.0 for analysis and 1.98.1 for running").
RA_STD_VERSION=1.98.0
RA_STD_SHA256=0e977492aed5ff137815bf9b4b796e8a85b80fb2367ed64e82d5c5839870f2bf
