# shellcheck shell=bash disable=SC2034
# The tidy unit's pins (cpp/tidy): none. clangd with clang-tidy is built
# from the compilers unit's LLVM, whose version and SHA-256 it reads from
# that unit's build-only/pins.sh (build-lib.sh's need_unit), so LLVM is
# pinned once.
