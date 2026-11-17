#!/bin/sh
# Freestanding C++ to wasm32 (no libc: this container has no wasi-sysroot,
# and the boundary under test does not need one).
set -eu
cd "$(dirname "$0")"
rm -rf build && mkdir -p build/hidden build/student
CXX="clang++ --target=wasm32 -O2 -nostdlib -fno-exceptions -fno-rtti -Wl,--no-entry -Wl,--export-memory"
$CXX -o build/hidden/lib.wasm hidden/lib.cpp rt.cpp -Wl,--allow-undefined
$CXX -o build/hidden/tests.wasm hidden/tests.cpp rt.cpp -Wl,--allow-undefined
for v in honest attack; do
  $CXX -o build/student/student-$v.wasm student/$v.cpp rt.cpp -Wl,--allow-undefined
  $CXX -DMONO -o build/hidden/mono-$v.wasm hidden/tests.cpp hidden/lib.cpp student/$v.cpp rt.cpp \
    -Wl,--export=run -Wl,--allow-undefined
done
ls -l build/*/
