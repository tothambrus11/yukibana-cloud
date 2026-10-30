#!/usr/bin/env bash
# Builds the Rust pack's compilers and Miri from Rust's source, for a
# wasm32-wasip1-threads host (../README.md, "The compiler"), into $OUT:
#
#   rustc.wasm          rustc with LLVM's WebAssembly code generator and
#                       lld's wasm linker: the default target, wasm32-wasip1
#   rustc-cross.wasm    the same with LLVM's x86-64, AArch64 and RISC-V
#                       code generators and lld's ELF linker too: the Linux
#                       targets (musl, static)
#   miri.wasm           Miri, of the same tree
#   sysroot-<triple>.tar          the standard library of each target, for
#                                 rustc (rlibs and their .rmeta)
#   miri-sysroot-<triple>.tar     the standard library built for Miri (cfg
#                                 miri, MIR of everything; .rmeta only)
#
# From nothing this is hours (on 4 cores: about 55 minutes of native LLVM,
# 65 of LLVM for wasm, then rustc twice, native and wasm); everything is
# kept under $CACHE, so a rebuild redoes what changed. Needs curl, xz,
# python3, cmake, ninja, gcc/g++ and about 40 GB of disk.
#
#   RUST_VERSION        the release whose source tarball is built
#   rustc/patches/      applied in order: 00xx homescoop's patches for a
#                       WASI-hosted rustc (Apache-2.0, see patches/README.md),
#                       01xx LLVM fixes backported from LLVM 23.1.1, 02xx ours
set -euo pipefail

RUST_VERSION=1.98.1
RUST_SRC_SHA256=be1816e7f6c40abb90245ad6e024bed2a7e88d7dda4561e4d5470207df616b9f
WASI_SDK_VERSION=34.0
WASI_SDK_SHA256=b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/rust/rustc"
: "${OUT:=$CACHE/out}"
mkdir -p "$CACHE" "$OUT"
step() { printf '\n== %s\n' "$*" >&2; }
fetch() { # url sha256 file
    [ -f "$3" ] || { curl -sSfL --retry 4 -o "$3.part" "$1" && mv "$3.part" "$3"; }
    echo "$2  $3" | sha256sum -c --quiet - || { echo "$3 is not the file pinned" >&2; exit 1; }
}

step "sources"
fetch "https://static.rust-lang.org/dist/rustc-$RUST_VERSION-src.tar.xz" "$RUST_SRC_SHA256" "$CACHE/rustc-$RUST_VERSION-src.tar.xz"
fetch "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_VERSION%%.*}/wasi-sdk-$WASI_SDK_VERSION-x86_64-linux.tar.gz" "$WASI_SDK_SHA256" "$CACHE/wasi-sdk-$WASI_SDK_VERSION.tar.gz"
SDK="$CACHE/wasi-sdk-$WASI_SDK_VERSION-x86_64-linux"
[ -d "$SDK" ] || tar -xzf "$CACHE/wasi-sdk-$WASI_SDK_VERSION.tar.gz" -C "$CACHE"

# The tree is extracted again when the patches change; its build/ (hours of
# LLVM and rustc) is moved across, so only what the patches touch rebuilds.
SRC="$CACHE/rustc-$RUST_VERSION-src"
STAMP="$(cat "$HERE"/patches/*.patch "$HERE/build.sh" | sha256sum | cut -c1-16)"
if [ "$(cat "$SRC/.yukibana-patches" 2>/dev/null)" != "$STAMP" ]; then
    step "extract and patch"
    [ -d "$SRC/build" ] && mv "$SRC/build" "$CACHE/build.keep"
    rm -rf "$SRC"
    tar -xJf "$CACHE/rustc-$RUST_VERSION-src.tar.xz" -C "$CACHE"
    [ -d "$CACHE/build.keep" ] && mv "$CACHE/build.keep" "$SRC/build"
    for p in "$HERE"/patches/*.patch; do
        case "$(basename "$p")" in
            # LLVM's own commits: paths from llvm-project's root; their
            # tests are not in Rust's tarball.
            01*) dir=(--directory=src/llvm-project --exclude='*/test/*') ;;
            *) dir=() ;;
        esac
        echo "patch $(basename "$p")" >&2
        (cd "$SRC" && GIT_CEILING_DIRECTORIES="$CACHE" git apply "${dir[@]}" "$p")
    done
    echo "$STAMP" > "$SRC/.yukibana-patches"
fi

step "bootstrap config"
S="$SDK/share/wasi-sysroot"
cat > "$SRC/config.yukibana.toml" <<EOF
# Written by packs/rust/rustc/build.sh.
profile = "compiler"
change-id = "ignore"

[build]
build = "x86_64-unknown-linux-gnu"
host = ["wasm32-wasip1-threads"]
target = ["x86_64-unknown-linux-gnu", "wasm32-wasip1", "wasm32-wasip1-threads"]
docs = false
compiler-docs = false
extended = false
tools = []
cargo-native-static = true

[rust]
codegen-backends = ["llvm"]
deny-warnings = false
debug = false
debuginfo-level = 0
# Line tables in std, as in Rust's own releases: a backtrace and a
# debugger's stepping into std have file and line.
debuginfo-level-std = 1
incremental = false
remap-debuginfo = true
strip = false
llvm-bitcode-linker = false
llvm-tools = false

[llvm]
static-libstdcpp = true
ninja = true
download-ci-llvm = false
link-shared = false
# One LLVM for both compilers: rustc.wasm links only its WebAssembly code
# generator (RUSTC_LLVM_ONLY_TARGETS, patch 0201).
targets = "WebAssembly;X86;AArch64;RISCV"
experimental-targets = ""

[target.'wasm32-wasip1']
wasi-root = "$S"
linker = "$SDK/bin/clang"
codegen-backends = ["llvm"]

[target.'wasm32-wasip1-threads']
wasi-root = "$S"
# rustc.wasm itself links with wasi-sdk's clang++ (its libc++ for LLVM).
linker = "$SDK/bin/clang++"
rustflags = [
  "-Clink-self-contained=no",
  "-Clink-arg=--sysroot=$S",
  "-Clink-arg=-pthread",
  "-Clink-arg=-lc++abi",
  "-Clink-arg=-ldl",
  "-Clink-arg=-lwasi-emulated-mman",
  "-Clink-arg=-Wl,--max-memory=4294967296",
]
cc = "$SDK/bin/wasm32-wasip1-threads-clang"
cxx = "$SDK/bin/wasm32-wasip1-threads-clang++"
ar = "$SDK/bin/ar"
ranlib = "$SDK/bin/ranlib"
codegen-backends = ["llvm"]

[target.'x86_64-unknown-linux-gnu']
cc = "gcc"
EOF

export WASI_SDK_PATH="$SDK" WASI_SYSROOT="$S"
export RUSTFLAGS_NOT_BOOTSTRAP=""
export CFLAGS_wasm32_wasip1_threads="--target=wasm32-wasip1-threads" CXXFLAGS_wasm32_wasip1_threads="--target=wasm32-wasip1-threads"
unset RUSTFLAGS CARGO_TARGET_WASM32_WASIP1_RUSTFLAGS CARGO_TARGET_WASM32_WASIP1_THREADS_RUSTFLAGS RUSTC_LLVM_ONLY_TARGETS || true
X() { (cd "$SRC" && ./x.py "$@" --config config.yukibana.toml); }
STAGE2="$SRC/build/wasm32-wasip1-threads/stage2/bin"

step "rustc-cross.wasm (every target) and the standard library"
X build --stage 2 compiler/rustc library
cp "$STAGE2/rustc.wasm" "$CACHE/rustc-cross.wasm"

step "rustc.wasm (WebAssembly only)"
RUSTC_LLVM_ONLY_TARGETS=webassembly X build --stage 2 compiler/rustc
cp "$STAGE2/rustc.wasm" "$CACHE/rustc.wasm"

for c in rustc rustc-cross; do cp "$CACHE/$c.wasm" "$OUT/$c.wasm"; done
echo "built $(ls "$OUT")" >&2
