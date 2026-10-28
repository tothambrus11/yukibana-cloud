# shellcheck shell=bash
# What the libs unit's scripts share (build-test-frameworks.sh,
# build-test-frameworks-linux.sh, build-sanitizers.sh, build-targets.sh,
# pack-runner.sh): sourced after build-lib.sh, and named in
# toolchains/libs/paths only, so an edit here rebuilds the libraries and
# nothing else. Defines functions only.

# multiarch <arch>: prints the multiarch directory clang's Linux driver uses
# for a Linux target's arch (x86_64-linux-gnu for x86_64), as src/targets.json
# says; dies when no target has that arch.
multiarch() {
  node -e 'const t = require(process.argv[1]).find((t) => t.arch === process.argv[2]); if (!t) process.exit(1); console.log(t.multiarch)' \
    "$BUILD_LIB_DIR/src/targets.json" "$1" || die "no target with arch $1 in src/targets.json"
}

# linux_testfw_inputs <files>: prints, one per line, every file that makes
# the Linux targets' gtest.tar and rapidcheck.tar
# (build-test-frameworks-linux.sh): the scripts, the libs unit's pins
# (GoogleTest's and RapidCheck's), the compile driver
# build-test-libs-linux.mjs and what it imports (src/toolchain.js, which
# decides the compiler's arguments and file system; src/targets.js and
# targets.json), and from <files>, the directory the driver reads the
# pack's files from, the compiler (cc-cross.wasm and its glue cc-cross.js,
# the compilers unit's) and the headers every object is compiled against
# (sysroot.tar.gz, targets/<arch>/include.tar, this unit's). Their
# stamp_of is that step's stamp.
linux_testfw_inputs() {
  local here=$BUILD_LIB_DIR
  printf '%s\n' "$here/build-test-frameworks-linux.sh" "$here/toolchains/libs/pins.sh" "$here/build-lib.sh" "$here/libs-lib.sh" \
    "$here/build-test-libs-linux.mjs" "$here/src/toolchain.js" "$here/src/targets.js" "$here/src/targets.json" \
    "$1/cc-cross.wasm" "$1/cc-cross.js" "$1/sysroot.tar.gz" \
    "$1/targets/x86_64/include.tar" "$1/targets/aarch64/include.tar" "$1/targets/riscv64/include.tar"
}

# sanitizer_inputs: prints, one per line, every file of the pack that makes
# the sanitizer runtimes (build-sanitizers.sh), whose stamp_of is that
# step's stamp: the script, the pins (the libs unit's wasi-sdk; the emsdk
# unit's, whose compiler-rt sources are compiled; the musl unit's, whose
# Alpine packages give the Linux runtimes; each as its unit exports it at
# $DEP_<UNIT>/build-only/pins.sh), the patch, every file under
# src/sanitizer-rt, and src/targets.json, which names each arch's
# multiarch directory.
sanitizer_inputs() {
  local here=$BUILD_LIB_DIR
  printf '%s\n' "$here/build-sanitizers.sh" "$here/toolchains/libs/pins.sh" "$here/build-lib.sh" "$here/libs-lib.sh" \
    "${DEP_EMSDK:?the emsdk unit}/build-only/pins.sh" "${DEP_MUSL:?the musl unit}/build-only/pins.sh" \
    "$here/patches/compiler-rt-wasi.patch" "$here/src/targets.json"
  find "$here/src/sanitizer-rt" -type f | LC_ALL=C sort
}

# rapidcheck_tree_sha256 <dir>: prints the SHA-256 that RAPIDCHECK_TREE_SHA256
# pins, which is files_sha256 of the checkout.
rapidcheck_tree_sha256() {
  files_sha256 "$1"
}
