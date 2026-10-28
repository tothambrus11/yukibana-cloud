#!/usr/bin/env bash
# GoogleTest and RapidCheck for the Linux targets (README, "Targets", Tests),
# into $OUT/targets/<arch>/, the libs unit's toolchain:
#
#   gtest.tar        usr/lib/<multiarch>/libgtest.a, libgtest_main.a
#   rapidcheck.tar   usr/lib/<multiarch>/librapidcheck.a
#
# where clang's Linux driver finds -lgtest and -lrapidcheck in the target's
# file system. The runner fetches them like the default target's gtest.tar
# and rapidcheck.tar: only for a Test or a program that includes them. The
# headers are the default target's, in sysroot.tar.gz.
#
# The same sources as the default target's libraries, pinned the same way
# (GoogleTest's release tarball by SHA-256, as build-cxx-runtime.sh fetches
# it; RapidCheck's commit and tree hash, as build-test-frameworks.sh does:
# both from toolchains/libs/pins.sh, so there is one of each). Compiled by
# build-test-libs-linux.mjs with cc-cross.wasm itself, in Node, so the
# libraries come from the compiler, headers and flags a student's tests on
# that target are compiled with; archived with wasi-sdk 30's llvm-ar
# (deterministic, no timestamps). Catch2 and doctest are not built for
# Linux (yet): the runner refuses them there by name.
#
# Run by pack-runner.sh in the libs unit, after build-sysroot.sh and
# build-targets.sh have written sysroot.tar.gz and targets/<arch>/include.tar
# into $OUT. The compiler is the compilers unit's, at $DEP_COMPILERS: the
# driver reads the pack's files from one directory ($OUT to it), so it is
# given $CACHE/testfw-linux-view, links to those five kinds of file and
# nothing else. Idempotent: while $CACHE/testfw-linux/.built holds the stamp
# of everything that makes them (libs-lib.sh's linux_testfw_inputs: the
# scripts, the pins, the compile driver toolchain.js and targets.js(on), the
# compiler cc-cross.wasm with its glue cc-cross.js, and the headers in
# sysroot.tar.gz and the three include.tar), the archives kept beside it in
# $CACHE/testfw-linux/out are copied to $OUT and nothing is compiled.
# About 6 minutes (111 compiles, one at a time).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=toolchains/libs/pins.sh
source "$HERE/toolchains/libs/pins.sh"
# shellcheck source-path=SCRIPTDIR source=build-lib.sh
source "$HERE/build-lib.sh"
# shellcheck source-path=SCRIPTDIR source=libs-lib.sh
source "$HERE/libs-lib.sh"
: "${OUT:?OUT is the toolchain directory of the libs unit (pack-toolchain.sh sets it)}"
CACHE="${PACK_CACHE:-$HOME/.cache/yukibana-packs}/cpp"
need_unit compilers
WORK="$CACHE/testfw-linux"
VIEW="$CACHE/testfw-linux-view"
NICE="nice -n 10"
WSDK="$CACHE/wasi/wasi-sdk-$WASI_SDK_VERSION.0-x86_64-linux"
ARCHES=(x86_64 aarch64 riscv64)
# Each arch's multiarch directory, as src/targets.json names it.
declare -A MULTIARCH=()
for arch in "${ARCHES[@]}"; do MULTIARCH[$arch]=$(multiarch "$arch"); done

# The view: the compiler from the compilers unit, the headers from this one.
rm -rf "$VIEW" && mkdir -p "$VIEW"
for f in cc-cross.wasm cc-cross.js; do
  [ -f "$DEP_COMPILERS/$f" ] || die "$DEP_COMPILERS/$f is missing (the compilers unit builds it)"
  ln -s "$DEP_COMPILERS/$f" "$VIEW/$f"
done
for f in sysroot.tar.gz "${ARCHES[@]/#/targets/}"; do
  case $f in targets/*) f="$f/include.tar" ;; esac
  [ -f "$OUT/$f" ] || die "$OUT/$f is missing (build-sysroot.sh and build-targets.sh write it first)"
  mkdir -p "$(dirname "$VIEW/$f")"
  ln -s "$OUT/$f" "$VIEW/$f"
done
mapfile -t inputs < <(linux_testfw_inputs "$VIEW")
stamp=$(stamp_of "${inputs[@]}")
# The archives this step writes, as paths under OUT and under $WORK/out.
archives=()
for arch in "${ARCHES[@]}"; do archives+=("targets/$arch/gtest.tar" "targets/$arch/rapidcheck.tar"); done
# put: copies the kept archives to OUT, each beside its target and renamed
# over it (the app's build may hold a hard link to the old file).
put() {
  local f
  for f in "${archives[@]}"; do
    mkdir -p "$(dirname "$OUT/$f")"
    cp "$WORK/out/$f" "$OUT/$f.part"
    mv "$OUT/$f.part" "$OUT/$f"
  done
}
kept=1
for f in "${archives[@]}"; do [ -f "$WORK/out/$f" ] || kept=; done
if [ -n "$kept" ] && [ "$(cat "$WORK/.built" 2>/dev/null)" = "$stamp" ]; then
  put
  echo "GoogleTest and RapidCheck for Linux: cached ($WORK)"
  exit 0
fi

"$HERE/build-cxx-runtime.sh" >/dev/null # wasi-sdk (llvm-ar), and GoogleTest's tarball checked
rm -rf "$WORK" && mkdir -p "$WORK"
cd "$WORK"
echo "$GTEST_SHA256  $CACHE/googletest-$GTEST_VERSION.tar.gz" | sha256sum -c --quiet -
tar xzf "$CACHE/googletest-$GTEST_VERSION.tar.gz"
git init -q rapidcheck-src
git -C rapidcheck-src fetch -q --depth 1 https://github.com/emil-e/rapidcheck.git "$RAPIDCHECK_COMMIT"
git -C rapidcheck-src -c advice.detachedHead=false checkout -q FETCH_HEAD
got=$(git -C rapidcheck-src rev-parse HEAD)
[ "$got" = "$RAPIDCHECK_COMMIT" ] || die "RapidCheck fetched commit $got, expected $RAPIDCHECK_COMMIT"
got=$(rapidcheck_tree_sha256 rapidcheck-src)
[ "$got" = "$RAPIDCHECK_TREE_SHA256" ] || die "RapidCheck's tree hashes to $got, expected $RAPIDCHECK_TREE_SHA256"

OUT="$VIEW" $NICE node "$HERE/build-test-libs-linux.mjs" "$WORK/googletest-$GTEST_VERSION" "$WORK/rapidcheck-src" "$WORK/obj"

for arch in "${ARCHES[@]}"; do
  lib="stage/$arch/usr/lib/${MULTIARCH[$arch]}"
  mkdir -p "$lib"
  for name in gtest gtest_main rapidcheck; do
    (cd "obj/$arch/$name" && LC_ALL=C ls -- *.o) | sed "s|^|obj/$arch/$name/|" | xargs "$WSDK/bin/llvm-ar" rcsD "$lib/lib$name.a"
  done
  mkdir -p "out/targets/$arch"
  pack() { # archive libs...
    local archive=$1; shift
    reproducible_tar -C "stage/$arch" -c "${@/#/usr/lib/${MULTIARCH[$arch]}/}" > "out/targets/$arch/$archive"
  }
  pack gtest.tar libgtest.a libgtest_main.a
  pack rapidcheck.tar librapidcheck.a
done
rm -rf obj stage rapidcheck-src "googletest-$GTEST_VERSION" "$VIEW"
echo "$stamp" > "$WORK/.built"
put
ls -la "$OUT"/targets/*/{gtest,rapidcheck}.tar
