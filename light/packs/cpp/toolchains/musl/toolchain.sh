#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Builds the C/C++ pack's musl unit (cpp/musl) into $OUT, run by
# light/scripts/pack-toolchain.sh from this directory of its stage: the
# checked downloads that the libs unit (the Linux targets' libraries, their
# sanitizers, sysroot.tar.gz's headers) and the vm unit (the guest's tools,
# user mode's headers) both build from, so one musl and one set of Alpine
# packages is pinned once, and nothing the page downloads:
#
#   build-only/musl-<version>.tar.gz          musl's release tarball
#   build-only/apk/<arch>/<package>.apk       each of Alpine's packages
#                                             PACKAGES names, for each arch
#   build-only/pins.sh                        this unit's pins
#   versions-musl.json
#
# Only downloads and checks, in a minute. Every package pinned in pins.sh
# is fetched, and every package fetched is pinned: a pin nothing fetched
# would be checked by nothing.
set -euo pipefail

UNIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK="$(cd "$UNIT/../.." && pwd)"
# shellcheck source=pins.sh
source "$UNIT/pins.sh"
# shellcheck source=../../build-lib.sh
source "$PACK/build-lib.sh"
# shellcheck source=alpine.sh
source "$UNIT/alpine.sh"
: "${OUT:?OUT is the toolchain directory of this unit (pack-toolchain.sh sets it)}"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp"
mkdir -p "$CACHE" "$OUT/build-only/apk"

# Alpine's packages the other units take (apk_of in build-lib.sh), by name.
PACKAGES=(musl musl-dev compiler-rt libc++-static libc++-dev llvm-libunwind-static)
pinned=$(compgen -v | sed -n 's/^APK_\(.*\)_VERSION$/\1/p' | LC_ALL=C sort)
listed=$(for p in "${PACKAGES[@]}"; do p=${p^^}; p=${p//+/X}; echo "${p//-/_}"; done | LC_ALL=C sort)
[ "$pinned" = "$listed" ] || die "pins.sh pins the packages $(tr '\n' ' ' <<<"$pinned")but PACKAGES fetches $(tr '\n' ' ' <<<"$listed")"

step "musl $MUSL_VERSION"
fetch "https://musl.libc.org/releases/musl-$MUSL_VERSION.tar.gz" "$MUSL_SHA256" "$CACHE/musl-$MUSL_VERSION.tar.gz"
cp "$CACHE/musl-$MUSL_VERSION.tar.gz" "$OUT/build-only/"

for arch in x86_64 aarch64 riscv64; do
  step "Alpine's packages for $arch"
  mkdir -p "$OUT/build-only/apk/$arch"
  for name in "${PACKAGES[@]}"; do
    pin=$(apk_pin "$name" "$arch")
    read -r pkg sha <<< "$pin"
    cp "$(fetch_apk "$arch" "$pkg" "$sha")" "$OUT/build-only/apk/$arch/$name.apk"
  done
done
cp "$UNIT/pins.sh" "$OUT/build-only/pins.sh"
printf '{"musl":"%s"}\n' "$MUSL_VERSION" > "$OUT/versions-musl.json"
