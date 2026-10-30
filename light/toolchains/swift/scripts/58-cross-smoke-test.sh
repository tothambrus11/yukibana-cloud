#!/usr/bin/env bash
# Stage 58 — prove the cross compiler (SWIFT_CROSS=1) builds Linux programs.
#
# For every Linux sysroot Stage 41 packed: compile a Swift program with
# swift-frontend-cross.wasm, link it with wasm-ld.wasm acting as ld.lld (`-flavor
# gnu`: lld is one multiplexed driver), and run it under qemu-user. Both tools see one
# directory tree, as they will in the browser, and these are the argument vectors the
# Swift pack's runner uses (packs/swift/src/linux.js): what `swiftc -v
# -static-executable` prints for the Static Linux SDK, with the sysroot at /sysroot.
#
# NATIVE=1 runs the same vectors with the native toolchain's swift-frontend and
# ld.lld instead, which checks the sysroots and the vectors without the hours-long
# cross build.
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"

: "${NATIVE:=0}"
: "${LINUX_TARGETS:=x86_64 aarch64 riscv64}"
WORK="${TC_BUILD}/cross-smoke"

if [[ "$NATIVE" != 1 ]]; then
  for artifact in swift-frontend-cross.wasm wasm-ld.wasm; do
    [[ -f "${TC_OUT}/${artifact}" ]] || die "missing ${TC_OUT}/${artifact}"
  done
  command -v wasmtime >/dev/null || die "no WASI runtime found (install wasmtime)"
fi

# The Linux machine each architecture's program runs on: ld.lld's emulation, the
# target's extra frontend flags (`swiftc -v` passes -aarch64-use-tbi), qemu-user.
emulation() { case "$1" in x86_64) echo elf_x86_64 ;; aarch64) echo aarch64linux ;; riscv64) echo elf64lriscv ;; esac; }
frontend_extra() { [[ "$1" == aarch64 ]] && echo "-Xllvm -aarch64-use-tbi" || true; }
run_program() {
  local arch="$1" program="$2"
  if [[ "$arch" == "$(uname -m)" ]]; then "$program"; return; fi
  local qemu
  qemu="$(command -v "qemu-${arch}-static" || command -v "qemu-${arch}" || true)"
  [[ -n "$qemu" ]] || die "no qemu-${arch} to run the ${arch} program (apt install qemu-user-static)"
  "$qemu" "$program"
}

# One preopened tree per architecture: /work and /sysroot, as in the browser. A
# native tool sees the host's file system, so its arguments are mapped onto the tree.
native_args() {
  local root="$1" a; shift
  mapped=()
  for a in "$@"; do
    a="${a//\/sysroot/${root}/sysroot}"
    mapped+=("${a//\/work/${root}/work}")
  done
}
frontend() {
  local root="$1"; shift
  if [[ "$NATIVE" == 1 ]]; then
    native_args "$root" "$@"
    swift-frontend "${mapped[@]}"
  elif [[ "${SWIFT_MACROS:-1}" == 1 ]]; then
    node --no-turbo-fast-api-calls "${TOOLCHAIN_ROOT}/tools/plugin-host/run-frontend.mjs" \
      --dir "${root}/work::/work" --dir "${root}/sysroot::/sysroot" "${TC_OUT}/swift-frontend-cross.wasm" "$@"
  else
    wasmtime run --dir "${root}/work::/work" --dir "${root}/sysroot::/sysroot" "${TC_OUT}/swift-frontend-cross.wasm" "$@"
  fi
}
linker() {
  local root="$1"; shift
  if [[ "$NATIVE" == 1 ]]; then
    native_args "$root" "$@"
    ld.lld "${mapped[@]}"
  else
    wasmtime run --dir "${root}/work::/work" --dir "${root}/sysroot::/sysroot" "${TC_OUT}/wasm-ld.wasm" -flavor gnu "$@"
  fi
}

tested=0
for arch in $LINUX_TARGETS; do
  tar="${TC_OUT}/swift-sysroot-linux-${arch}.tar"
  [[ -f "$tar" ]] || { warn "no ${tar}; skipping ${arch}"; continue; }
  root="${WORK}/${arch}"
  rm -rf "$root"
  mkdir -p "${root}/sysroot" "${root}/work/mcache"
  tar -xf "$tar" -C "${root}/sysroot"

  cat > "${root}/work/main.swift" <<'SWIFT'
#if arch(x86_64)
let arch = "x86_64"
#elseif arch(arm64)
let arch = "arm64"
#elseif arch(riscv64)
let arch = "riscv64"
#endif
struct Padded { var flag: Bool; var value: Int; var small: Int16 }
let squares = (1...5).map { $0 * $0 }
print("\(arch): squares \(squares), Padded is \(MemoryLayout<Padded>.size) bytes")
SWIFT

  log "compiling for ${arch}-swift-linux-musl"
  # shellcheck disable=SC2046
  frontend "$root" -frontend -c /work/main.swift \
    -target "${arch}-swift-linux-musl" $(frontend_extra "$arch") -disable-objc-interop \
    -sdk /sysroot -resource-dir /sysroot/usr/lib/swift_static -use-static-resource-dir \
    -module-cache-path /work/mcache -no-color-diagnostics -empty-abi-descriptor \
    -g -debug-info-format=dwarf -dwarf-version=4 \
    -module-name main -o /work/main.o
  [[ -f "${root}/work/main.o" ]] || die "the frontend wrote no object for ${arch}"

  log "linking for ${arch}"
  lib=/sysroot/usr/lib/swift_static/linux-static
  crt=/sysroot/usr/lib/swift/clang/lib/linux
  linker "$root" --sysroot=/sysroot -z relro --hash-style=gnu --eh-frame-hdr \
    -m "$(emulation "$arch")" -static -o /work/main \
    /sysroot/usr/lib/crt1.o /sysroot/usr/lib/crti.o "${crt}/clang_rt.crtbegin-${arch}.o" \
    "-L${lib}" "-L${lib}/${arch}" -L/sysroot/usr/lib --build-id "${lib}/${arch}/swiftrt.o" \
    --start-group /work/main.o -lswiftSwiftOnoneSupport -lswiftCore -lswift_Concurrency \
    -lswift_StringProcessing -lswift_RegexParser --end-group \
    -undefined=pthread_self -undefined=pthread_once -undefined=pthread_key_create \
    -ldispatch -lBlocksRuntime -lpthread -ldl -lc++ -lc++abi -lm \
    --start-group "${crt}/libclang_rt.builtins-${arch}.a" -l:libunwind.a -lc --end-group \
    "${crt}/clang_rt.crtend-${arch}.o" /sysroot/usr/lib/crtn.o
  [[ -f "${root}/work/main" ]] || die "the linker wrote no program for ${arch}"

  want="${arch/aarch64/arm64}: squares [1, 4, 9, 16, 25], Padded is 18 bytes"
  got="$(run_program "$arch" "${root}/work/main")"
  [[ "$got" == "$want" ]] || die "${arch}: the program printed '${got}', expected '${want}'"
  log "${arch}: ${got}"
  tested=$((tested + 1))
done

(( tested > 0 )) || die "no Linux sysroot to test; run 41-linux-sysroots.sh first"
log "cross smoke test passed for ${tested} target(s)"
