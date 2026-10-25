#!/usr/bin/env bash
# Lays out the guest tools' musl sysroots, $PACK_CACHE/cpp/targets/sysroot/<arch>/
# ({include,lib}: musl's complete headers for the arch, its crt files, libc.a and
# libm.a, and compiler-rt's builtins as libclang_rt.builtins.a), the sysroot cc.sh
# compiles strace and test-vm.mjs's fixtures with. From the musl unit's checked
# copies of Alpine's packages ($DEP_MUSL, apk_of), the same ones the libs unit
# makes the Linux targets' lib.tar of (build-targets.sh), so the programs users run
# and the tools the VM ships link one musl. It was a side effect of
# build-targets.sh, which made the VM wait for the libraries.
#
# Seconds; laid out again every run (build-strace.sh's stamp hashes its files, so an
# unchanged sysroot rebuilds nothing).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../build-lib.sh
source "$HERE/../build-lib.sh"
need_unit musl   # MUSL_VERSION, and the packages (apk_of)
SYSROOTS=${SYSROOTS:-${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp/targets/sysroot}
LLVM_LIB=usr/lib/llvm21/lib/clang/21/lib

for arch in x86_64 aarch64 riscv64; do
  x="$SYSROOTS/.x-$arch"
  rm -rf "$x" && mkdir -p "$x/musl-dev" "$x/compiler-rt"
  for name in musl-dev compiler-rt; do
    tar xzf "$(apk_of "$arch" "$name")" -C "$x/$name" --warning=no-unknown-keyword 2>/dev/null
  done
  grep -qF "pkgver = $MUSL_VERSION-" "$x/musl-dev/.PKGINFO" || die "$arch: musl-dev is not musl $MUSL_VERSION"
  sr="$SYSROOTS/$arch"
  rm -rf "$sr" && mkdir -p "$sr/lib"
  cp -r "$x/musl-dev/usr/include" "$sr/include"
  cp "$x/musl-dev/usr/lib/"{crt1.o,crti.o,crtn.o,libc.a,libm.a} "$sr/lib/"
  cp "$x/compiler-rt/$LLVM_LIB/$arch-alpine-linux-musl/libclang_rt.builtins-$arch.a" "$sr/lib/libclang_rt.builtins.a"
  rm -rf "$x"
done
echo "musl sysroots for the guest's tools: $SYSROOTS"
