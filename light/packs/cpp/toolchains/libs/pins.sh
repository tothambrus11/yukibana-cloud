# shellcheck shell=bash disable=SC2034
# The libs unit's pins (cpp/libs): plain NAME=value lines, no commands. A
# framework pin here rebuilds the libs unit and nothing else.

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
# (libs-lib.sh) prints it. app/src/lib/export.ts fetches the same commit.
RAPIDCHECK_COMMIT=2c3c4365aca21ef4e612768fdc95b1ce8b39a651
RAPIDCHECK_TREE_SHA256=176d9a58c1f1a3a4add6a4e932fb98d35168108b7dcbc7fd8959efd378514670
