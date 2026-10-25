# shellcheck shell=bash disable=SC2034
# Every pinned input of the C/C++ pack's build but the Linux VM's own: each
# build-*.sh, pack-runner.sh and vm/build-*.sh sources this file (and
# build-lib.sh), and none of them names a version, commit or checksum of its
# own. The VM's own pins (QEMU, its dependencies, Linux, strace, firmware)
# are vm/pins.sh, the vm unit's pins once T4 cuts the units; it also says
# where the GPL sources are. No input is pinned in both files: the VM takes
# Emscripten and musl from here.
#
# Plain NAME=value assignments only, no commands: sourcing it does nothing but
# set variables, so any script (or a test) may read it. A download is checked
# against its SHA-256 before it is used; a git source is pinned by commit.
#
# A change here changes the stamps of the steps that use the value (the
# compilers' artifacts/*/STAMP hash the LLVM version and their cmake
# arguments; the cached runtime and framework steps hash this file; the VM's
# steps hash vm/pins.sh and name the Emscripten by build-lib.sh's
# emsdk_made_by, so no other pin here rebuilds QEMU), so the next build
# redoes exactly those steps.

# LLVM: clangd, cc.wasm, cc-cross.wasm and the demangler are built from this
# release tarball, and the libc++ headers in sysroot.tar.gz come from it.
LLVM_VERSION=21.1.8
LLVM_SHA256=4633a23617fa31a3ea51242586ea7fb1da7140e426bd62fc164261fe036aa142

# musl's headers for sysroot.tar.gz and for the user-mode QEMU's compat
# directory (vm/build-qemu-user.sh); the Linux targets' libraries are
# Alpine's build of the same release, below.
MUSL_VERSION=1.2.5
MUSL_SHA256=a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4

# Emscripten 6.0.13, the one Emscripten of the pack: clangd, cc.wasm,
# cc-cross.wasm, the demangler and QEMU-Wasm are compiled with it, the
# sanitizers' WebAssembly runtimes are compiled from its compiler-rt sources,
# and its llvm-strip and llvm-ar handle the Linux targets' libraries. Not
# older than 5.0.5, whose proxying fix (emscripten-core/emscripten#26582)
# clangd and QEMU both need: before it a synchronous proxied call was
# signalled after its mutex was unlocked, which froze QEMU and made clangd
# trap on "unaligned accesses" (vm/README.md, README "Emscripten's
# proxying"). build-lib.sh's emsdk_install installs it into
# $PACK_CACHE/cpp/emsdk, and nothing patches it there. Pinned here once;
# T4 moves this block, unchanged, into the pins.sh of the unit that installs
# it, and every other unit that runs it names that unit in its needs.
#
# The emsdk tag's commit, and the two archives `emsdk install` fetches for it
# (the toolchain, named by the release revision in that commit's
# emscripten-releases-tags.json, and the node its emsdk_manifest.json names,
# whose SHA-256 is also nodejs.org's). emsdk checks no checksums itself, so
# emsdk_install fetches and checks them and hands them to it as kept
# downloads.
EMSDK_VERSION=6.0.13
EMSDK_COMMIT=35659964bc2762fffec0d257997fb61475f765b7
EMSDK_RELEASE=eb132757325583b787fe9414b09afea9442b72ad
EMSDK_BINARIES_SHA256=cda6801012ff3319a539111826ed02a9abd7eff135c2ef261c8941caf5a3763e
EMSDK_NODE=node-v24.19.0-linux-x64.tar.xz
EMSDK_NODE_SHA256=14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647

# wasi-sdk 30, the newest release whose libc++ is LLVM 21 (WASI_SDK_LLVM_VERSION,
# the same major version as the clang that compiles against it): its native
# clang builds the runtime and the frameworks (WASI_SDK_SHA256), and its
# sysroot and compiler-rt builtins go into wasi-sysroot.tar.gz.
WASI_SDK_VERSION=30
WASI_SDK_LLVM_VERSION=21.1.4
WASI_SDK_SHA256=0507679dff16814b74516cd969a9b16d2ced1347388024bc7966264648c78bfb
WASI_SYSROOT_SHA256=0c8f3e0acab6d3061834395a16550c359766909fda046af3d9b8cf3bfdb1c2cc
WASI_RT_SHA256=1aaf34d5f30227206d9d6dd3aa0d8af4019a201a1d73fc64a44fe0a6058c54c3
# The sysroot tarball carries no licence; its VERSION file names this
# wasi-libc commit, whose LICENSE pack-runner.sh ships.
WASI_LIBC_COMMIT=ec0effd769df
WASI_LIBC_LICENSE_SHA256=2711a8b5a5cdfef0e639f96c1aca12ae23d7d64a02d0507f1bdf14d2b27bbc3a

# GoogleTest's release tarball. app/src/lib/export.ts names the same version
# and checksum for the Download's CMake build.
GTEST_VERSION=1.18.0
GTEST_SHA256=6e3191c1455468b3fc35a417fb565c1c5071aee1b7e7f85e30cf48a98d37d8b5

# Catch2: the commit its tag names (a shallow clone of the tag, checked
# against it; Catch2 publishes no source tarball of its own).
CATCH2_VERSION=3.16.1
CATCH2_COMMIT=08092139210881f01a34e60c5f2fd6afa0ea4024

# doctest: header-only, so doctest.h and its licence at the tag's commit.
DOCTEST_VERSION=2.5.3
DOCTEST_COMMIT=2d0a9359a60c51affe2a9bebb1be1dca47868151
DOCTEST_H_SHA256=cfd518a3ef90f67e1f3ba514df23fb3627437de1a2feeba78cf5062a40021421
DOCTEST_LICENSE_SHA256=0fe0b331fa1513dcce8604ff1fa925f32d1cea17d8aeb1c2471fad40d291adc5

# RapidCheck has no releases or tags: its master on 2026-10-05 (merge of PR
# #348), and the SHA-256 of that commit's tree as rapidcheck_tree_sha256
# (build-lib.sh) prints it. app/src/lib/export.ts fetches the same commit.
RAPIDCHECK_COMMIT=2c3c4365aca21ef4e612768fdc95b1ce8b39a651
RAPIDCHECK_TREE_SHA256=176d9a58c1f1a3a4add6a4e932fb98d35168108b7dcbc7fd8959efd378514670

# Alpine's packages for the Linux targets (build-targets.sh) and their
# sanitizers (build-sanitizers.sh). Alpine replaces a package in place when it
# publishes a new revision, so the revision can vanish from its mirrors
# (ALPINE_MIRROR, build-lib.sh's fetch_apk); the SHA-256 decides either way.
#
# A package is APK_<NAME>: NAME is the package's name in capitals with `+` as
# X and `-` as `_` (libc++-static is LIBCXX_STATIC); APK_<NAME>_VERSION is its
# version and APK_<NAME>_<ARCH> its SHA-256 for that arch (X86_64, AARCH64,
# RISCV64). apk_pin in build-lib.sh reads them.
ALPINE_REPO=https://dl-cdn.alpinelinux.org/alpine/v3.23/main

APK_MUSL_VERSION=1.2.5-r24
APK_MUSL_X86_64=d49d703392f1a6d2fe822db1b57e61735063077e1ad846d5f40d79fe507ec727
APK_MUSL_AARCH64=d7043c549029c98d438e9bc94213b006e5c88540eb58d1f5b0f0d1d56dbf9c98
APK_MUSL_RISCV64=d2b9760fca0bf386f0eee1b7e68ad55c2497a2c2b12fdc34496956ef81404a83

APK_MUSL_DEV_VERSION=1.2.5-r24
APK_MUSL_DEV_X86_64=9a45a27051991319c020abd2e4f300f01b85febd745634d9e71cdbf133363448
APK_MUSL_DEV_AARCH64=8e3a2e5b78069ebd1307cb092972de2f95deb0b21b866a788d1ac7d6972db43e
APK_MUSL_DEV_RISCV64=1753854396e8a6418f2f97bb14ee600ae9ff5affc92c806f21806039fb41f752

APK_COMPILER_RT_VERSION=21.1.2-r0
APK_COMPILER_RT_X86_64=1c2f55bf9d4c6d1dc3a95d67be09114a08f4befcaee06444b563ef0e3571285b
APK_COMPILER_RT_AARCH64=c8dc9a9e98a23a30f4b5c89f44b7978e1d45db637742824304e0031aca12b200
APK_COMPILER_RT_RISCV64=57934443df08a24a1b67870ba38233395e0169b7992b0769c2a2e97bdf3dcb41

APK_LIBCXX_STATIC_VERSION=21.1.2-r0
APK_LIBCXX_STATIC_X86_64=462b1465e6a145b4dad325e34b893bead2dc0cd988972cdf91aa75373034405b
APK_LIBCXX_STATIC_AARCH64=b29caf77824cb00f8e55431224d27d006ecef4f7d0cb8a66df1e7c7f63a7d4df
APK_LIBCXX_STATIC_RISCV64=6fee0c817ce90e7eb44adf894cf8a3b114e7a5be1a57ca6b49cce3b912332dc0

# Fetched only for the check of its __config_site; nothing of it is shipped.
APK_LIBCXX_DEV_VERSION=21.1.2-r0
APK_LIBCXX_DEV_X86_64=70b781ec7ed77dcce24b6fbd8276ba6fbd8bc89a14cb92846f75e679c0021751
APK_LIBCXX_DEV_AARCH64=8ab36249db6ec1eb4221b5e150819119b5eb2a720141c70be5c53ead42582119
APK_LIBCXX_DEV_RISCV64=cea0c9bec0b7c2ec47afbb78970ee0ece174766dadf2eb68039a81f262aa3315

APK_LLVM_LIBUNWIND_STATIC_VERSION=21.1.2-r0
APK_LLVM_LIBUNWIND_STATIC_X86_64=ef10086c62cf87b04b9d2be598d5124539092a031a18bdc70d89c2082022f47f
APK_LLVM_LIBUNWIND_STATIC_AARCH64=277fa9b4a92241037097b682de52a3c9536c2065da6b037ff92aa7fe9faf2a7d
APK_LLVM_LIBUNWIND_STATIC_RISCV64=dedc558c5a8969b7ceb39d0c639f74691e302bd7597e042270191866b044eff5
