# shellcheck shell=bash disable=SC2034
# The emsdk unit's pins (cpp/emsdk): plain NAME=value lines, no commands.
# The unit exports this file as build-only/pins.sh, which every unit that
# needs it reads (build-lib.sh's emsdk_use), so a tree or stamp it compiles
# names the Emscripten by these values (emsdk_made_by) and no unit pins it
# again.

# Emscripten 6.0.13, the one Emscripten of the pack: clangd, cc.wasm,
# cc-cross.wasm, the demangler and QEMU-Wasm are compiled with it, the
# sanitizers' WebAssembly runtimes are compiled from its compiler-rt sources,
# and its llvm-strip and llvm-ar handle the Linux targets' libraries. Not
# older than 5.0.5, whose proxying fix (emscripten-core/emscripten#26582)
# clangd and QEMU both need: before it a synchronous proxied call was
# signalled after its mutex was unlocked, which froze QEMU and made clangd
# trap on "unaligned accesses" (vm/README.md, README "Emscripten's
# proxying"). This unit's emsdk.sh installs it, nothing patches it, and
# every unit that compiles with it (compilers, libs, vm) names cpp/emsdk in
# its needs and finds it at $DEP_EMSDK (build-lib.sh's emsdk_use).
#
# The emsdk tag's commit, and the two archives `emsdk install` fetches for it
# (the toolchain, named by the release revision in that commit's
# emscripten-releases-tags.json, and the node its emsdk_manifest.json names,
# whose SHA-256 is also nodejs.org's). emsdk checks no checksums itself, so
# emsdk_install (emsdk.sh) fetches and checks them and hands them to it as kept
# downloads.
EMSDK_VERSION=6.0.13
EMSDK_COMMIT=35659964bc2762fffec0d257997fb61475f765b7
EMSDK_RELEASE=eb132757325583b787fe9414b09afea9442b72ad
EMSDK_BINARIES_SHA256=cda6801012ff3319a539111826ed02a9abd7eff135c2ef261c8941caf5a3763e
EMSDK_NODE=node-v24.19.0-linux-x64.tar.xz
EMSDK_NODE_SHA256=14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647
