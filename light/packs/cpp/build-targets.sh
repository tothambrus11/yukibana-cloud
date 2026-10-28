#!/usr/bin/env bash
# Builds the per-target files of the Linux targets (README, "Targets") into
# $OUT/targets/<arch>/, the libs unit's toolchain, for arch in x86_64,
# aarch64 and riscv64:
#
#   include.tar  usr/include/<multiarch>/bits/*: the arch's complete set of
#                musl's bits/ headers. clang's Linux driver puts
#                /usr/include/<multiarch> before /usr/include, so these
#                shadow sysroot.tar.gz's x86_64 bits/ (which stay the
#                default). Fetched by clangd (server.js), the runner and
#                the explorer for that target.
#   lib.tar      usr/lib/<multiarch>/: musl's crt files, libc.a and its empty
#                stubs (libm.a, libpthread.a, ...), libc++.a (with libc++abi
#                merged in), libunwind.a;
#                usr/lib/clang/21/lib/linux/: compiler-rt's builtins and
#                crtbegin/crtend. Fetched by the runner only, to link.
#
# The libraries are Alpine v3.23's packages, pinned by SHA-256 in the musl
# unit's pins (toolchains/musl/pins.sh) and fetched by it: musl 1.2.5,
# and libc++, libc++abi, libunwind and compiler-rt 21.1.2 (the headers they
# are compiled against are LLVM 21.1.8's, in sysroot.tar.gz: same major
# version, same __config_site and ABI version, checked below). Phase 2 is to
# build these runtimes from our own LLVM 21.1.8 tarball.
#
# Each file also gets .gz and .br siblings. sysroot.tar.gz is not touched.
#
# The same packages make the guest tools' sysroot too, in the vm unit
# (vm/build-sysroot.sh): one musl for the programs users run and the tools
# the VM ships, because both take the musl unit's copies (apk_of). Run by
# the libs unit after build-sysroot.sh (whose sysroot.tar.gz and
# cxx-headers it checks against); the emsdk unit's llvm-strip and llvm-ar
# handle every ELF arch.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=build-lib.sh
source "$HERE/build-lib.sh"
# shellcheck source-path=SCRIPTDIR source=libs-lib.sh
source "$HERE/libs-lib.sh"
: "${OUT:?OUT is the toolchain directory of the libs unit (pack-toolchain.sh sets it)}"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp"
need_unit musl    # MUSL_VERSION, and the packages (apk_of)
need_unit emsdk
WORK="$CACHE/targets-libs"
BIN="$DEP_EMSDK/build-only/emsdk/upstream/bin"   # llvm-strip and llvm-ar handle every ELF arch
LLVM_LIB=usr/lib/llvm21/lib/clang/21/lib
mkdir -p "$WORK" "$OUT/targets"

# The packages of each arch (the musl unit's). libc++-dev is fetched only
# for the check of its __config_site; nothing of it is shipped.
PACKAGES=(musl-dev libc++-static llvm-libunwind-static compiler-rt libc++-dev)

# names <dir>: the names of the files directly in <dir>, sorted for comm.
names() { find "$1" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort; }
# An .apk is gzip members of tar: the signature, .PKGINFO, then the files;
# tar reads them as one archive. Each package goes into a fresh directory.
unpack() { # apk dir
  rm -rf "$2" && mkdir -p "$2"
  tar xzf "$1" -C "$2" --warning=no-unknown-keyword 2>/dev/null
}

# The x86_64 bits/ that sysroot.tar.gz ships at /usr/include/bits, and the
# libc++ __config_site it ships, for the checks.
ref="$WORK/ref"
rm -rf "$ref" && mkdir -p "$ref"
tar xzf "$OUT/sysroot.tar.gz" -C "$ref" usr/include/bits usr/include/c++/v1/__config_site
[ "$(cat "$ref/usr/include/c++/v1/__config_site")" = "$(cat "$CACHE/cxx-headers/include/c++/v1/__config_site")" ] \
  || die "sysroot.tar.gz's __config_site is not cxx-headers'"
grep -q '^#define _LIBCPP_ABI_VERSION 1$' "$ref/usr/include/c++/v1/__config_site" || die "libc++ ABI version is not 1"

for arch in x86_64 aarch64 riscv64; do
  step "$arch"
  ma=$(multiarch "$arch")
  x="$WORK/x/$arch"
  rm -rf "$x" && mkdir -p "$x"
  for name in "${PACKAGES[@]}"; do
    unpack "$(apk_of "$arch" "$name")" "$x/$name"
  done

  # Checks: musl is 1.2.5; Alpine's libc++ was configured as ours (same
  # __config_site, so the same ABI version and the same musl settings).
  grep -qF "pkgver = $MUSL_VERSION-" "$x/musl-dev/.PKGINFO" || die "$arch: musl-dev is not musl $MUSL_VERSION"
  cmp -s "$x/libc++-dev/usr/include/c++/v1/__config_site" "$CACHE/cxx-headers/include/c++/v1/__config_site" \
    || die "$arch: Alpine's libc++ __config_site differs from ours"
  if [ "$arch" = x86_64 ]; then
    diff -r "$x/musl-dev/usr/include/bits" "$ref/usr/include/bits" >/dev/null \
      || die "x86_64: Alpine's musl bits/ differ from sysroot.tar.gz's /usr/include/bits"
  fi
  # Headers the default (x86_64) set has and this arch's lacks: an #include
  # of one of them fails for this target, as it does on that arch's Linux.
  missing=$(comm -23 <(names "$ref/usr/include/bits") <(names "$x/musl-dev/usr/include/bits") | tr '\n' ' ')
  echo "bits/ headers of x86_64 that $arch has not: ${missing:-none}"

  inc="$x/inc" stage="$x/stage"
  mkdir -p "$inc/usr/include/$ma" "$stage/usr/lib/$ma" "$stage/usr/lib/clang/21/lib/linux"
  cp -r "$x/musl-dev/usr/include/bits" "$inc/usr/include/$ma/"
  lib="$stage/usr/lib/$ma"
  for f in crt1.o crti.o crtn.o rcrt1.o Scrt1.o libc.a; do
    "$BIN/llvm-strip" --strip-unneeded -o "$lib/$f" "$x/musl-dev/usr/lib/$f"
  done
  # musl's empty archives: the libraries are in libc.a, these exist so that
  # -lm, -lpthread and the like link as on any Linux.
  for f in libm.a libpthread.a librt.a libdl.a libutil.a libxnet.a libcrypt.a libresolv.a; do
    [ "$(stat -c %s "$x/musl-dev/usr/lib/$f")" -eq 8 ] || die "$arch: $f is not musl's empty stub"
    cp "$x/musl-dev/usr/lib/$f" "$lib/"
  done
  # libc++abi joins libc++.a, as LIBCXX_STATICALLY_LINK_ABI_IN_STATIC_LIBRARY
  # would build it: the driver passes -lc++ only.
  "$BIN/llvm-strip" --strip-unneeded -o "$x/libc++.a" "$x/libc++-static/usr/lib/libc++.a"
  "$BIN/llvm-strip" --strip-unneeded -o "$x/libc++abi.a" "$x/libc++-static/usr/lib/libc++abi.a"
  printf 'create %s\naddlib %s\naddlib %s\nsave\nend\n' "$lib/libc++.a" "$x/libc++.a" "$x/libc++abi.a" | "$BIN/llvm-ar" -M
  "$BIN/llvm-strip" --strip-unneeded -o "$lib/libunwind.a" "$x/llvm-libunwind-static/usr/lib/libunwind.a"
  rt="$x/compiler-rt/$LLVM_LIB/$arch-alpine-linux-musl"
  for f in "libclang_rt.builtins-$arch.a" "clang_rt.crtbegin-$arch.o" "clang_rt.crtend-$arch.o"; do
    "$BIN/llvm-strip" --strip-unneeded -o "$stage/usr/lib/clang/21/lib/linux/$f" "$rt/$f"
  done
  "$BIN/llvm-ar" t "$lib/libc++.a" | grep -qx 'cxa_exception.cpp.o' || die "$arch: libc++abi is not in libc++.a"

  mkdir -p "$OUT/targets/$arch"
  tarball "$inc" "$OUT/targets/$arch/include.tar"
  tarball "$stage" "$OUT/targets/$arch/lib.tar"
  node "$HERE/compress.mjs" "$OUT/targets/$arch/include.tar" "$OUT/targets/$arch/lib.tar"
  rm -rf "$x"
done
rm -rf "$ref" "$WORK/x"
