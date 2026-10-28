# shellcheck shell=bash disable=SC2034
# The musl unit's pins (cpp/musl): plain NAME=value lines, no commands. The
# unit only downloads and checks: musl's release tarball and Alpine's
# packages of musl and of LLVM's runtimes built for it, which the libs unit
# (the Linux targets, their sanitizers, sysroot.tar.gz's headers) and the
# vm unit (the guest's tools, user mode's headers) both build with, so one
# musl is pinned once. It exports this file as build-only/pins.sh.

# musl's release tarball: its headers go into sysroot.tar.gz (libs) and the
# user-mode QEMU's compat directory (vm/build-qemu-user.sh); the Linux
# targets' libraries are Alpine's build of the same release, below.
MUSL_VERSION=1.2.5
MUSL_SHA256=a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4

# Alpine's packages for the Linux targets (build-targets.sh), their
# sanitizers (build-sanitizers.sh) and the VM's guest tools
# (vm/build-sysroot.sh). Alpine replaces a package in place when it
# publishes a new revision, so the revision can vanish from its mirrors
# (ALPINE_MIRROR, alpine.sh's fetch_apk); the SHA-256 decides either way.
#
# A package is APK_<NAME>: NAME is the package's name in capitals with `+` as
# X and `-` as `_` (libc++-static is LIBCXX_STATIC); APK_<NAME>_VERSION is its
# version and APK_<NAME>_<ARCH> its SHA-256 for that arch (X86_64, AARCH64,
# RISCV64). apk_pin in alpine.sh reads them.
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
