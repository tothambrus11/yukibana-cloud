#!/usr/bin/env bash
# Builds the sanitizer runtimes (README, "Sanitizers") into
# ../../app/static/packs/cpp/, each archive fetched by the runner only for a
# project whose compile_flags.txt asks for that sanitizer:
#
#   asan.tar     usr/lib/clang/21/lib/wasm32-unknown-wasip1/libclang_rt.asan.a:
#                AddressSanitizer with LeakSanitizer and UBSan, for the
#                default target (wasm32-wasip1)
#   ubsan.tar    .../libclang_rt.ubsan_standalone.a and ubsan_minimal.a:
#                UndefinedBehaviorSanitizer alone
#   targets/<arch>/asan.tar, ubsan.tar
#                the same for each Linux target, as clang's Linux driver
#                links them (usr/lib/clang/21/lib/linux/libclang_rt.*-<arch>.a
#                and their .syms), and asan.tar also musl's dynamic loader as
#                usr/lib/<multiarch>/libc.so: AddressSanitizer refuses a
#                static program, so a sanitized program links dynamically
#                against musl, and the runner puts the same file into the
#                guest as /lib/ld-musl-<arch>.so.1
#
# WebAssembly: compiler-rt's Emscripten port (emsdk's
# upstream/emscripten/system/lib/compiler-rt, LLVM 20.1.8 with Emscripten's
# changes) with patches/compiler-rt-wasi.patch, compiled for wasm32-wasip1
# by wasi-sdk 30's clang (build-cxx-runtime.sh fetches it) with the source
# lists and flags of Emscripten's tools/system_libs.py, plus
# src/sanitizer-rt/: what Emscripten's runtime would give the port (the host
# half is src/sanitizer.js). No debug information: a runtime frame reads
# "in malloc (program.wasm+0x...)", as natively for a library without it.
#
# Linux: Alpine v3.23's compiler-rt 21.1.2 (the same package
# build-targets.sh takes the builtins from) and musl 1.2.5, pinned by
# SHA-256, the runtimes' debug information stripped.
#
# Idempotent: while $CACHE/sanitizers/.built holds the stamp of everything
# that makes them (build-lib.sh's sanitizer_inputs: this script, pins.sh,
# build-lib.sh, the patch, every file of src/sanitizer-rt/, and
# src/targets.json, which names each arch's multiarch directory), the
# archives and their .gz/.br kept beside it in $CACHE/sanitizers/out are
# copied to app/static/packs/cpp and nothing is built; so a build into an
# empty app/static/packs/cpp reuses them too.
# Under a minute at -j3.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=pins.sh
source "$HERE/pins.sh"
# shellcheck source-path=SCRIPTDIR source=build-lib.sh
source "$HERE/build-lib.sh"
OUT="$(cd "$HERE/../.." && pwd)/app/static/packs/cpp"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp"
JOBS=${JOBS:-3}
WASI_SDK="$CACHE/wasi/wasi-sdk-$WASI_SDK_VERSION.0-x86_64-linux"
EMSDK_LIB="$CACHE/emsdk/upstream/emscripten/system/lib"
BIN="$CACHE/emsdk/upstream/bin"   # llvm-strip and llvm-ar handle every ELF arch
W="$CACHE/sanitizers"
K="$W/out"   # the archives, kept with the stamp that made them
LLVM_LIB=usr/lib/llvm21/lib/clang/21/lib

[ -x "$WASI_SDK/bin/clang" ] || die "no wasi-sdk in $WASI_SDK (build-cxx-runtime.sh fetches it)"
[ -f "$EMSDK_LIB/compiler-rt/lib/asan/asan_emscripten.cpp" ] || die "no emsdk in $CACHE/emsdk (build.sh installs it)"

mapfile -t inputs < <(sanitizer_inputs)
stamp=$(stamp_of "${inputs[@]}")
# The archives, as paths under $K and under OUT, each with .gz and .br.
archives=(asan.tar ubsan.tar)
for arch in x86_64 aarch64 riscv64; do archives+=("targets/$arch/asan.tar" "targets/$arch/ubsan.tar"); done
# put: copies the kept archives and their siblings to OUT, each beside its
# target and renamed over it (the app's build may hold a hard link to the
# old file).
put() {
  local f x
  for f in "${archives[@]}"; do
    mkdir -p "$(dirname "$OUT/$f")"
    for x in "" .gz .br; do
      cp "$K/$f$x" "$OUT/$f$x.part"
      mv "$OUT/$f$x.part" "$OUT/$f$x"
    done
  done
}
kept=1
for f in "${archives[@]}"; do [ -f "$K/$f" ] && [ -f "$K/$f.gz" ] && [ -f "$K/$f.br" ] || kept=; done
if [ -n "$kept" ] && [ "$(cat "$W/.built" 2>/dev/null)" = "$stamp" ]; then
  put
  echo "sanitizer runtimes: cached ($W)"
  exit 0
fi
rm -rf "$K" "$W/.built"
mkdir -p "$W/dl" "$K/targets"

step "compiler-rt for wasm32-wasip1"
rm -rf "$W/rt" "$W/obj" "$W/stage"
mkdir -p "$W/rt/lib" "$W/obj"
for d in sanitizer_common asan ubsan ubsan_minimal lsan interception; do cp -r "$EMSDK_LIB/compiler-rt/lib/$d" "$W/rt/lib/"; done
cp -r "$EMSDK_LIB/compiler-rt/include" "$W/rt/include"
patch -s -d "$W/rt" -p1 < "$HERE/patches/compiler-rt-wasi.patch"
# Emscripten's flags for these libraries (CompilerRTLibrary and its
# subclasses), for wasm32-wasip1: wasi-libc's emulations of what WASI lacks
# (signal(), mmap(), getpid(), clock()), which the runner links too.
cflags=(--target=wasm32-wasip1 -O2 -fno-builtin -fno-exceptions -std=c++17 -D_LARGEFILE64_SOURCE -Wno-format
  -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_GETPID -D_WASI_EMULATED_PROCESS_CLOCKS
  -I"$HERE/src/sanitizer-rt/include" -I"$W/rt/lib" -I"$W/rt/include")
compile() { # dir objdir extra-flags... -- sources...
  local dir=$1 obj=$2; shift 2
  local extra=()
  while [ "$1" != -- ]; do extra+=("$1"); shift; done
  shift
  mkdir -p "$obj"
  printf '%s\n' "$@" | xargs -P "$JOBS" -I{} sh -c \
    "'$WASI_SDK/bin/clang++' $(printf "'%s' " "${cflags[@]}" "${extra[@]}") -c '$dir/{}' -o '$obj/{}.o'"
}
sources() { # dir excluded... : the names of dir's .cpp files, but the excluded
  (cd "$1" && shift && for f in *.cpp; do case " $* " in *" $f "*) ;; *) printf '%s\n' "$f" ;; esac; done)
}
cd "$W/rt/lib"
# As tools/system_libs.py lists them, but sanitizer_platform_limits_posix.cpp:
# it describes Emscripten's libc's structures, which WASI's are not, and
# nothing on WASI intercepts the calls that need them.
mapfile -t common_src < <(sources sanitizer_common sanitizer_common_nolibc.cpp sanitizer_platform_limits_posix.cpp)
mapfile -t ubsan_src < <(sources ubsan ubsan_diag_standalone.cpp)
mapfile -t lsan_src < <(cd lsan && printf '%s\n' lsan_common*.cpp)
mapfile -t asan_src < <(sources asan)
compile sanitizer_common "$W/obj/common" -- "${common_src[@]}"
compile ubsan "$W/obj/ubsan" -DUBSAN_CAN_USE_CXXABI -- "${ubsan_src[@]}"
compile lsan "$W/obj/lsan" -- "${lsan_src[@]}"
compile asan "$W/obj/asan" -- "${asan_src[@]}"
compile ubsan_minimal "$W/obj/minimal" -- ubsan_minimal_handlers.cpp
cd "$W"
cc=("$WASI_SDK/bin/clang" --target=wasm32-wasip1 -O2 -Wall -Werror -D_WASI_EMULATED_MMAN -I"$HERE/src/sanitizer-rt/include")
"${cc[@]}" -c "$HERE/src/sanitizer-rt/wasi_emscripten.c" -o obj/wasi_emscripten.o
"${cc[@]}" -c "$HERE/src/sanitizer-rt/wasi_heap.c" -o obj/wasi_heap.o
# dlmalloc's own warnings are Emscripten's business; the bulk memory
# instructions are the unchecked memcpy and memset.
"$WASI_SDK/bin/clang" --target=wasm32-wasip1 -O2 -mbulk-memory -D_WASI_EMULATED_MMAN -I"$EMSDK_LIB" \
  -c "$HERE/src/sanitizer-rt/wasi_asan.c" -o obj/wasi_asan.o
rt=stage/usr/lib/clang/21/lib/wasm32-unknown-wasip1
mkdir -p "$rt"
archive() { rm -f "$1"; "$WASI_SDK/bin/llvm-ar" rcs "$@"; }
# AddressSanitizer's runtime holds UBSan's and LeakSanitizer's, as on Linux
# (and as Emscripten links them together).
archive "$rt/libclang_rt.asan.a" obj/common/*.o obj/ubsan/*.o obj/lsan/*.o obj/asan/*.o obj/wasi_emscripten.o obj/wasi_asan.o
archive "$rt/libclang_rt.ubsan_standalone.a" obj/common/*.o obj/ubsan/*.o obj/wasi_emscripten.o obj/wasi_heap.o
rm -rf stage-ub && mkdir -p stage-ub/usr/lib/clang/21/lib/wasm32-unknown-wasip1
mv "$rt/libclang_rt.ubsan_standalone.a" stage-ub/usr/lib/clang/21/lib/wasm32-unknown-wasip1/
archive stage-ub/usr/lib/clang/21/lib/wasm32-unknown-wasip1/libclang_rt.ubsan_minimal.a obj/minimal/*.o obj/wasi_emscripten.o
tarball stage "$K/asan.tar"
tarball stage-ub "$K/ubsan.tar"
rm -rf rt obj stage stage-ub

step "Alpine's sanitizer runtimes for the Linux targets"
# compiler-rt, the package build-targets.sh takes the builtins from, and musl
# for its dynamic loader (libc.so and ld-musl-<arch>.so.1 are one file),
# pinned in pins.sh.
for arch in x86_64 aarch64 riscv64; do
  ma=$(multiarch "$arch")
  x="$W/x/$arch"
  rm -rf "$x" && mkdir -p "$x"
  for name in compiler-rt musl; do
    pin=$(apk_pin "$name" "$arch")
    read -r pkg sha <<< "$pin"
    apk=$(fetch_apk "$arch" "$pkg" "$sha")
    mkdir -p "$x/$name"
    tar xzf "$apk" -C "$x/$name" --warning=no-unknown-keyword 2>/dev/null
  done
  # The same musl release as sysroot.tar.gz's headers.
  grep -qF "pkgver = $MUSL_VERSION-" "$x/musl/.PKGINFO" || die "$arch: musl is not musl $MUSL_VERSION"
  from="$x/compiler-rt/$LLVM_LIB/$arch-alpine-linux-musl"
  asan="$x/asan/usr/lib/clang/21/lib/linux" ubsan="$x/ubsan/usr/lib/clang/21/lib/linux"
  mkdir -p "$asan" "$ubsan" "$x/asan/usr/lib/$ma"
  for lib in asan asan_static asan_cxx asan-preinit; do
    "$BIN/llvm-strip" --strip-debug -o "$asan/libclang_rt.$lib-$arch.a" "$from/libclang_rt.$lib-$arch.a"
    [ -f "$from/libclang_rt.$lib-$arch.a.syms" ] && cp "$from/libclang_rt.$lib-$arch.a.syms" "$asan/"
  done
  for lib in ubsan_standalone ubsan_standalone_cxx ubsan_minimal; do
    "$BIN/llvm-strip" --strip-debug -o "$ubsan/libclang_rt.$lib-$arch.a" "$from/libclang_rt.$lib-$arch.a"
    [ -f "$from/libclang_rt.$lib-$arch.a.syms" ] && cp "$from/libclang_rt.$lib-$arch.a.syms" "$ubsan/"
  done
  cp "$x/musl/lib/ld-musl-$arch.so.1" "$x/asan/usr/lib/$ma/libc.so"
  mkdir -p "$K/targets/$arch"
  tarball "$x/asan" "$K/targets/$arch/asan.tar"
  tarball "$x/ubsan" "$K/targets/$arch/ubsan.tar"
  rm -rf "$x"
done
rm -rf "$W/x"

step "compress"
node "$HERE/compress.mjs" "${archives[@]/#/$K/}"
echo "$stamp" > "$W/.built"
put
ls -la "${archives[@]/#/$OUT/}"
