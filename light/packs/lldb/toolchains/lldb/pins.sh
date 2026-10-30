# shellcheck shell=bash disable=SC2034
# The lldb unit's pins (lldb/lldb): plain NAME=value lines, no commands.

# LLVM 23.1.4, the newest release: its LLDB has the WebAssembly process
# plugin (`process connect --plugin wasm`, qWasmCallStack and the rest) and
# lldb-dap, and its clang is what LLDB's expression parser and C/C++ type
# system are made of. The release's source tarball, once for the native
# tablegens and once for the WebAssembly build.
LLVM_VERSION=23.1.4
LLVM_SHA256=819ecf7351f1a66f76b2d701d8942faaf5faeb324cb90c9d5b090de142434bb2

# libxml2, for qXfer:libraries:read: ProcessWasm learns where the module is
# from the stub's library list, an XML document, and LLDB parses it only
# when built with libxml2 (without it the module is never loaded and no
# breakpoint resolves).
LIBXML2_VERSION=2.15.4
LIBXML2_SHA256=98087fd181d9070724f3fbc65c7377db03038eb92bd882374daff44940138821
