# shellcheck shell=bash disable=SC2034
# The compilers unit's pins: what rustc.wasm, rustc-cross.wasm and
# miri.wasm are built from (toolchain.sh). Plain NAME=value lines. The
# sysroots unit reads them too, from this unit's build-only/pins.sh (its
# needs): its rust-std, its native Miri and its crates are of the same
# release, since a crate loads only into a compiler of the same version
# string.

# Rust's source tarball, static.rust-lang.org.
RUST_VERSION=1.98.1
RUST_SRC_SHA256=be1816e7f6c40abb90245ad6e024bed2a7e88d7dda4561e4d5470207df616b9f
# wasi-sdk, whose clang builds LLVM and links rustc for the wasm host.
WASI_SDK_VERSION=34.0
WASI_SDK_SHA256=b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4
