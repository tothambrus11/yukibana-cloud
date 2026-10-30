#!/usr/bin/env bash
# Stage 41 — pack the sysroots the cross compiler (SWIFT_CROSS=1) links Linux programs
# against: one tar per target, from Swift's official Static Linux SDK (musl, static).
#
# The layout is the SDK's own, rooted at the tar's top, so the argument vectors are
# what `swiftc -v -static-executable` prints for the same SDK with its paths
# replaced: `-sdk /` and `-resource-dir /usr/lib/swift_static` for the frontend,
# `--sysroot=/` for ld.lld. Nothing is renamed, so a native run of the same vectors
# (tests/cross) checks the browser's.
#
# The SDK ships x86_64 and aarch64 only. riscv64 has no official Swift SDK; Stage
# 42 builds one, and this stage packs it when it is there.
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
source "${TOOLCHAIN_ROOT}/scripts/linux-sdk.sh"

fetch_linux_sdk
: "${LINUX_TARGETS:=x86_64 aarch64 riscv64}"

# llvm-objcopy from the native Swift toolchain, which knows every target.
OBJCOPY="$(command -v llvm-objcopy || true)"
[[ -n "$OBJCOPY" ]] || die "llvm-objcopy not found (install the native Swift toolchain)"

for arch in $LINUX_TARGETS; do
  src="$(linux_sdk_root "$arch")" || { warn "no Swift SDK for ${arch}; skipping it"; continue; }
  stage="${TC_BUILD}/linux-sysroot-${arch}"
  log "packing the ${arch} Linux sysroot from ${src}"
  rm -rf "$stage"
  mkdir -p "$stage/usr/lib"
  cp -a "${src}/usr/include" "${stage}/usr/"
  # C++ interoperability is off in the browser, and the rest are headers of the
  # libraries pruned below.
  rm -rf "${stage}/usr/include/"{c++,curl,libxml2,openssl,archive.h,archive_entry.h,bzlib.h,lzma,lzma.h,zlib.h,zconf.h,mimalloc*}

  # The C side of a static link: musl, libc++ for the runtime's C++, libunwind.
  for f in Scrt1.o crt1.o crti.o crtn.o rcrt1.o libc.a libm.a libpthread.a libdl.a librt.a libutil.a \
           libc++.a libc++abi.a libunwind.a; do
    cp -a "${src}/usr/lib/${f}" "${stage}/usr/lib/"
  done

  # Swift's static resource directory. Two of its parts live in the dynamic one,
  # usr/lib/swift, and the frontend looks for them there: swift_static/clang is a
  # symlink to swift/clang (the clang resource directory: headers and
  # compiler-rt), and SwiftShims is found as <sdk>/usr/lib/swift/shims. The rest of
  # usr/lib/swift (the modules again, for dynamic linking) stays out.
  cp -a "${src}/usr/lib/swift_static" "${stage}/usr/lib/"
  mkdir -p "${stage}/usr/lib/swift"
  cp -a "${src}/usr/lib/swift/clang" "${src}/usr/lib/swift/shims" "${stage}/usr/lib/swift/"

  res="${stage}/usr/lib/swift_static"
  # Foundation (and the ICU data that is most of it) is out, as in the wasm core
  # sysroot (Stage 40); Dispatch stays, because the Concurrency runtime links it.
  rm -rf "${res}/"{CoreFoundation,_FoundationCShims,_foundation_unicode}
  find "${res}/linux-static" -maxdepth 2 \( -name '*Foundation*' -o -name 'lib_CF*' -o -name 'lib_Foundation*' \) \
    -exec rm -rf {} +
  # Modules hold every architecture of the SDK bundle; keep this one's binary module.
  find "${res}/linux-static" -path '*.swiftmodule/*' ! -name "${arch}-swift-linux-musl.swiftmodule" -delete

  # The runtime's own debug info is three quarters of every program linked against
  # it (41 MB against 10.5 MB for hello world); the program keeps its own. The SDK has
  # empty crtbeginT.o and crtend.o placeholders, which are not objects at all.
  find "$stage" \( -name '*.a' -o -name '*.o' \) -size +0 -print0 | xargs -0 -n 1 -P "$JOBS" "$OBJCOPY" --strip-debug

  out="${TC_OUT}/swift-sysroot-linux-${arch}.tar"
  tar --owner=0 --group=0 --numeric-owner -cf "$out" -C "$stage" .
  printf 'wrote %s (%s)\n' "$out" "$(du -h "$out" | cut -f1)"
done
