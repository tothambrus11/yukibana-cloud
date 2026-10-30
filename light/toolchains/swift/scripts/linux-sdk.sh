#!/usr/bin/env bash
# Fetch and checksum Swift's Static Linux SDK, the target side of the cross compiler.
# Source this after env.sh; fetch_linux_sdk sets LINUX_SDK_BUNDLE.

fetch_linux_sdk() {
  local archive="${TC_SRC}/$(basename "$SWIFT_LINUX_SDK_URL")"
  LINUX_SDK_BUNDLE="${TC_SRC}/linux-sdk-${SWIFT_VERSION}"
  if [[ ! -d "$LINUX_SDK_BUNDLE" ]]; then
    [[ -f "$archive" ]] || curl -fSL --retry 4 -o "$archive" "$SWIFT_LINUX_SDK_URL"
    echo "${SWIFT_LINUX_SDK_CHECKSUM}  ${archive}" | sha256sum -c - >&2 || die "Static Linux SDK checksum mismatch"
    mkdir -p "${LINUX_SDK_BUNDLE}.partial"
    tar -xzf "$archive" -C "${LINUX_SDK_BUNDLE}.partial"
    mv "${LINUX_SDK_BUNDLE}.partial" "$LINUX_SDK_BUNDLE"
  fi
}

# The SDK root for one architecture: the official bundle's, or for riscv64 the one
# Stage 42 built. Fails when there is none.
linux_sdk_root() {
  local arch="$1" dir
  if [[ "$arch" == riscv64 ]]; then
    dir="${TC_BUILD}/riscv64-sdk/musl.sdk/riscv64"
  else
    dir="$(find -L "$LINUX_SDK_BUNDLE" -maxdepth 5 -type d -path "*/musl-*.sdk/${arch}" | head -1)"
  fi
  [[ -n "$dir" && -d "$dir/usr/lib/swift_static" ]] || return 1
  printf '%s\n' "$dir"
}
