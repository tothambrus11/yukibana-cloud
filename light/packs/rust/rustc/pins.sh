# shellcheck shell=bash disable=SC2034
# What the Rust pack's compilers are built from (rustc/build.sh), and what
# the pack's build.sh builds Miri's native twin from: plain NAME=value
# lines, sourced by both. A change here is a new toolchain release
# (light-rust-toolchain.yml) and new pins in build.sh.

# Rust's source tarball, static.rust-lang.org. Its version is the one
# rust-std, the native Miri and the crates are built with (build.sh): a crate
# loads only into a compiler of the same version string.
RUST_VERSION=1.98.1
RUST_SRC_SHA256=be1816e7f6c40abb90245ad6e024bed2a7e88d7dda4561e4d5470207df616b9f
# wasi-sdk, whose clang builds LLVM and links rustc for the wasm host.
WASI_SDK_VERSION=34.0
WASI_SDK_SHA256=b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4
