# shellcheck shell=bash disable=SC2034
# The compilers unit's pins (cpp/compilers): plain NAME=value lines, no
# commands, so any script or test may read them and contract.test.mjs can
# check them. A change here rebuilds the compilers and every unit that needs
# them (libs), and nothing else. The unit also exports this file as
# build-only/pins.sh, so libs reads the LLVM it extracts its runtimes and
# headers from here and pins it nowhere else.

# LLVM: clangd, cc.wasm, cc-cross.wasm and the demangler are built from this
# release tarball; the libs unit takes the same tarball from this unit's
# build-only/ for the libc++ runtime and the headers in sysroot.tar.gz.
LLVM_VERSION=21.1.8
LLVM_SHA256=4633a23617fa31a3ea51242586ea7fb1da7140e426bd62fc164261fe036aa142
