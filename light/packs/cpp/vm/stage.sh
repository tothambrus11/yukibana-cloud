#!/usr/bin/env bash
# Lays out what the build made ($ART) into $OUT, the vm unit's toolchain:
#   vm/<arch>/qemu-system-<arch>.{mjs,wasm}, kernel, initrd (the base initramfs: init
#                                 only), strace.cpio, qboot.rom (x86_64) or
#                                 opensbi-riscv64-generic-fw_dynamic.bin (riscv64)
#   user/<arch>/qemu-<arch>.{mjs,wasm}   only when $ART/user/<arch> exists (build-qemu-user.sh)
#   LICENSE-{qemu,linux,strace,opensbi,qboot}.txt
# and a .gz and .br sibling for every file (../compress.mjs). vm.js, the runtime
# bundled with every file's raw size (VM_SIZES), is the pack's glue (glue.sh), so a
# change to src/vm/*.js rebuilds nothing here.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
P="$(cd "$HERE/.." && pwd)"
: "${OUT:?OUT is the toolchain directory of the vm unit (pack-toolchain.sh sets it)}"
ART=${ART:-${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp/vm-artifacts}
QC=${QC:-${PACK_CACHE:-$HOME/.cache/yukibana-packs}/qemu-wasm}

rm -rf "$OUT/vm" "$OUT/user"
for a in x86_64 aarch64 riscv64; do
  d=$OUT/vm/$a
  mkdir -p "$d"
  cp "$ART/qemu-system-$a.mjs" "$ART/qemu-system-$a.wasm" "$ART/strace-$a.cpio" "$d/"
  mv "$d/strace-$a.cpio" "$d/strace.cpio"
  cp "$ART/kernel-$a" "$d/kernel"
  node --input-type=module -e '
    const { cpio } = await import(process.argv[1]); const fs = await import("node:fs");
    fs.writeFileSync(process.argv[3], cpio([{ name: "init", mode: 0o100755, data: fs.readFileSync(process.argv[2]) }]));
  ' "$P/src/vm/cpio.js" "$ART/init-$a" "$d/initrd"
  case $a in
    x86_64) cp "$ART/qboot.rom" "$d/" ;;
    riscv64) cp "$ART/opensbi-riscv64-generic-fw_dynamic.bin" "$d/" ;;
  esac
  if [ -f "$ART/user/$a/qemu-$a.wasm" ]; then
    mkdir -p "$OUT/user/$a"
    cp "$ART/user/$a/qemu-$a.mjs" "$ART/user/$a/qemu-$a.wasm" "$OUT/user/$a/"
  fi
done

# Licences: QEMU GPL-2.0, qboot GPL-2.0, OpenSBI BSD-2-Clause, Linux GPL-2.0 with
# the syscall note, strace LGPL-2.1+. Not compressed: nothing fetches them.
for l in qemu linux strace opensbi qboot; do cp "$ART/LICENSE-$l.txt" "$OUT/LICENSE-$l.txt"; done

dirs=(vm); [ -d "$OUT/user" ] && dirs+=(user)
mapfile -t files < <(cd "$OUT" && find "${dirs[@]}" -type f ! -name '*.br' ! -name '*.gz' | sort | sed "s|^|$OUT/|")
node "$P/compress.mjs" "${files[@]}"
