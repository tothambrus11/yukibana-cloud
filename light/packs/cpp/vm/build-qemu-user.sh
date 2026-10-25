#!/usr/bin/env bash
# Builds the experimental user-mode QEMU (linux-user) for x86_64, aarch64 and riscv64
# into $ART/user/<arch>/qemu-<arch>.{mjs,wasm}: QEMU translates the program's system
# calls onto Emscripten's libc instead of booting a kernel (src/vm/user.js runs it).
#
# QEMU 8.2 has no linux-user host support for Wasm, and QEMU 10 dropped 64-bit guests
# on 32-bit hosts, so this needs patches/qemu-linux-user-wasm.patch (vm/README.md says
# what each hunk does) on the tree build-qemu.sh prepares, and compat headers:
#   - patches/compat-wasm-host-syscall.h.patch: the force-included host syscall
#     numbering (asm-generic) and the guest memory functions;
#   - the musl 1.2.5 headers Emscripten's libc leaves out (sys/signalfd.h, ...);
#   - the Linux UAPI headers linux-user needs for struct layouts and constants, from
#     the pinned kernel (build-kernel.sh's headers), never the build machine's.
# Needs build-qemu.sh first (the pack's emsdk, the dependencies, the QEMU tree) and
# build-kernel.sh x86_64 (the UAPI headers).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../pins.sh
source "$HERE/../pins.sh"
# shellcheck source=pins.sh
source "$HERE/pins.sh"
# shellcheck source=../build-lib.sh
source "$HERE/../build-lib.sh"
QC=${QC:-${PACK_CACHE:-$HOME/.cache/yukibana-packs}/qemu-wasm}
ART=${ART:-${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp/vm-artifacts}
JOBS=${JOBS:-3}
NICE="nice -n 10"
WORK=$QC/work SRC=$QC/work/qemu-wasm TARGET=$QC/work/target
UT=$WORK/qemu-user-src B=$WORK/build-user C=$WORK/user-compat
HDR=$QC/hdr/x86_64/include
# Linear memory at start, in MiB. 512 in the first experiment; it grows on demand, and
# the guest's address space (256 MiB, -R) comes from sbrk without being touched, so
# this only has to hold QEMU itself. test-vm.mjs passes at 8, 16 and 32 alike, with the
# same resident memory (the guest region's growth dominates); 16 leaves headroom.
USER_INITIAL_MEMORY_MB=${USER_INITIAL_MEMORY_MB:-16}
CACHE=${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp
EMSDK_DIR=$CACHE/emsdk
MUSL_INCLUDE=${MUSL_INCLUDE:-$CACHE/musl-$MUSL_VERSION/include}

CFLAGS="-idirafter $C -include $C/wasm-host-syscall.h -O3 -Wno-unused-command-line-argument -Wno-error=incompatible-pointer-types -matomics -mbulk-memory -pthread -DEMSCRIPTEN -DNDEBUG -DG_DISABLE_ASSERT -D_GNU_SOURCE"
LDFLAGS="-sPROXY_TO_PTHREAD=1 -sFORCE_FILESYSTEM -sALLOW_TABLE_GROWTH -sINITIAL_MEMORY=512MB -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2GB -sMALLOC=emmalloc -sEXPORT_ES6=1 -L$TARGET/lib -sEXPORTED_RUNTIME_METHODS=getTempRet0,setTempRet0,addFunction,removeFunction,FS"
# Only on the final link (a later -s wins), so they can change without reconfiguring:
# EXIT_RUNTIME so exit() reaches Module.onExit; TTY so user.js can give fds 0-2
# terminal semantics (isatty) with output that is not line-buffered.
FINAL="-sEXIT_RUNTIME=1 -sINITIAL_MEMORY=${USER_INITIAL_MEMORY_MB}MB -sEXPORTED_RUNTIME_METHODS=getTempRet0,setTempRet0,addFunction,removeFunction,FS,TTY"

[ -f "$TARGET/lib/libglib-2.0.a" ] && [ -f "$SRC/configure" ] && [ -f "$TARGET/.yk-made-by" ] || { echo "run build-qemu.sh first" >&2; exit 1; }
[ -f "$HDR/linux/types.h" ] || { echo "run build-kernel.sh x86_64 first (UAPI headers)" >&2; exit 1; }
# --- musl's headers (the cpp pack's build.sh unpacks the same tarball), before the
# stamp, which hashes the ones used
if [ ! -f "$MUSL_INCLUDE/sys/signalfd.h" ]; then
  mkdir -p "$QC/src"
  curl -sSfL -o "$QC/src/musl.tar.gz" "https://musl.libc.org/releases/musl-$MUSL_VERSION.tar.gz"
  echo "$MUSL_SHA256  $QC/src/musl.tar.gz" | sha256sum -c --quiet -
  tar xzf "$QC/src/musl.tar.gz" -C "$QC/src" && rm "$QC/src/musl.tar.gz"
  MUSL_INCLUDE=$QC/src/musl-$MUSL_VERSION/include
fi
# What this build is made of besides its own files: the QEMU tree build-qemu.sh
# prepared (by content: its git tree, since the patch's commit is dated), the
# dependencies it built (their record), the kernel's UAPI headers, and the musl
# headers (MUSL_INCLUDE: its files, whichever directory it names), and the
# Emscripten that compiles it (emsdk_made_by). Each of them reaches the build
# through a path that stays the same when it changes.
MADE_OF="$(emsdk_made_by)
qemu-tree $(git -C "$SRC" rev-parse 'HEAD^{tree}')
deps $(sha256sum < "$TARGET/.yk-made-by" | cut -d' ' -f1)
uapi $(files_sha256 "$HDR")
musl $(files_sha256 "$MUSL_INCLUDE")"
# The final link's memory (USER_INITIAL_MEMORY_MB) is in it too: it used to be
# left out, so another value kept the binaries linked with the first.
stamp=$({ cat "$HERE/pins.sh" "$HERE/patches/"*.patch "${BASH_SOURCE[0]}"; echo "$MADE_OF"; echo "initial-memory $USER_INITIAL_MEMORY_MB"; } |
  sha256sum | cut -d' ' -f1)
if [ "${PRINT_STAMP:-}" = 1 ]; then echo "$stamp"; exit 0; fi
if [ "$(cat "$ART/user.stamp" 2>/dev/null)" = "$stamp" ]; then echo "qemu user: up to date"; exit 0; fi
[ -f "$EMSDK_DIR/emsdk_env.sh" ] || { echo "run build-qemu.sh first (it installs the pack's emsdk in $EMSDK_DIR)" >&2; exit 1; }
# shellcheck source=/dev/null
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1
export PATH=$QC/venv/bin:$PATH

# --- the patched tree: hard links to build-qemu.sh's tree, so it costs no space;
# patch(1) replaces the files it changes instead of writing through the links.
# It records the patch and the tree it links to: a new QEMU tree (another commit
# or TCG patch) used to leave this one linked to the old files.
psha=$({ sha256sum < "$HERE/patches/qemu-linux-user-wasm.patch"; git -C "$SRC" rev-parse 'HEAD^{tree}'; } | sha256sum | cut -d' ' -f1)
if [ "$(cat "$UT/.yk-patch" 2>/dev/null)" != "$psha" ]; then
  rm -rf "$UT" "$B"; mkdir -p "$UT"
  (cd "$SRC" && for f in * .[a-z]*; do [ "$f" = .git ] || cp -al "$f" "$UT/"; done)
  patch -d "$UT" -p1 -s < "$HERE/patches/qemu-linux-user-wasm.patch"
  echo "$psha" > "$UT/.yk-patch"
fi

# --- compat headers
# Made of the patch, Emscripten's headers (MADE_OF names it), the musl and UAPI headers.
csha=$({ cat "$HERE/patches/compat-wasm-host-syscall.h.patch" "$HERE/pins.sh"; echo "$MADE_OF"; } | sha256sum | cut -d' ' -f1)
if [ "$(cat "$C/.yk-stamp" 2>/dev/null)" != "$csha" ]; then
  rm -rf "$C" "$B"; mkdir -p "$C/asm"
  E=$EMSDK_DIR/upstream/emscripten/cache/sysroot/include
  [ -d "$E" ] || E=$EMSDK_DIR/upstream/emscripten/system/include
  # musl headers Emscripten leaves out (sys/signalfd.h, sys/prctl.h, ...)
  (cd "$MUSL_INCLUDE" && find . -name '*.h') | while read -r f; do
    [ -e "$E/$f" ] || { mkdir -p "$C/$(dirname "$f")"; cp "$MUSL_INCLUDE/$f" "$C/$f"; }
  done
  # Linux UAPI (layouts and constants only); asm/ is asm-generic's, the 32-bit
  # little-endian host linux-user believes it runs on.
  for d in linux sound mtd scsi drm rdma misc video xen asm-generic; do [ -d "$HDR/$d" ] && cp -r "$HDR/$d" "$C/$d"; done
  cp "$HDR"/asm-generic/*.h "$C/asm/"
  printf '#include <linux/byteorder/little_endian.h>\n' > "$C/asm/byteorder.h"
  patch -d "$C" -p1 -s < "$HERE/patches/compat-wasm-host-syscall.h.patch"
  echo "$csha" > "$C/.yk-stamp"
fi

# --- configure and build
configured() {
  local f=$B/config.status
  grep -qF -- "'--extra-cflags=$CFLAGS'" "$f" 2>/dev/null && grep -qF -- "'--extra-ldflags=$LDFLAGS'" "$f"
}
# Compiled against the dependencies and with the Emscripten MADE_OF names, which
# configuring again would not show (keep_tree); the trees above remove it when
# they change.
configured || rm -rf "$B"
keep_tree "$B" "$(sha256sum < "$HERE/pins.sh" | cut -d' ' -f1) pins.sh
$MADE_OF"
if ! configured; then
  cd "$B"
  PKG_CONFIG_PATH=$TARGET/lib/pkgconfig CC=emcc CXX=em++ "$UT/configure" --static \
    --target-list=x86_64-linux-user,aarch64-linux-user,riscv64-linux-user --cpu=wasm32 --cross-prefix= \
    --without-default-features --disable-werror \
    --extra-cflags="$CFLAGS" --extra-cxxflags="$CFLAGS" --extra-ldflags="$LDFLAGS"
fi
cd "$B"
PKG_CONFIG_PATH=$TARGET/lib/pkgconfig $NICE ninja -j"$JOBS" qemu-x86_64 qemu-aarch64 qemu-riscv64
# Strict warnings on the file we wrote (QEMU's own flags do not include -Wextra);
# after the build, which generates the headers it includes.
# Its compile command from compile_commands.json, without the compiler, the
# input, the output and the dependency file, split into words as the shell
# would have run it.
read -ra host_flags < <(jq -r '.[] | select(.file | endswith("wasm32/wasm-host.c")) | .command' compile_commands.json | head -1 |
  sed 's/^[^ ]* //; s/ -o [^ ]*//; s/ -c [^ ]*//; s/ -MD -MQ [^ ]* -MF [^ ]*//')
emcc "${host_flags[@]}" \
  --system-header-prefix=qemu/ -Wall -Wextra -Wno-sign-compare -Wno-missing-field-initializers -Werror -fsyntax-only "$UT/common-user/host/wasm32/wasm-host.c"
for a in x86_64 aarch64 riscv64; do
  cmd=$(ninja -t commands "qemu-$a" | tail -1)
  [[ "$cmd" == *" -o qemu-$a "* ]] || { echo "unexpected link command for qemu-$a" >&2; exit 1; }
  mkdir -p "$ART/user/$a"
  eval "$NICE ${cmd/ -o qemu-$a / -o $ART/user/$a/qemu-$a.mjs } $FINAL"
done
echo "$stamp" > "$ART/user.stamp"
ls -la "$ART"/user/*/
