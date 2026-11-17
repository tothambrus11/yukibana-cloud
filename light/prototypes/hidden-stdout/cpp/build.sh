#!/bin/sh
# Builds every arrangement into build/: inproc-<v> is one stripped binary
# with the hidden tests and library linked in; host-<v> is the student's
# code with the stub, for the sandbox; trusted is the other side.
set -eu
cd "$(dirname "$0")"
rm -rf build && mkdir -p build/hidden build/student
CXX="g++ -std=c++20 -O2 -Wall -Iinclude"
$CXX -o build/hidden/trusted rpc/trusted.cpp hidden/hidden_tests.cpp hidden/hidden_lib.cpp
for v in honest batched attack; do
  $CXX -s -o build/hidden/inproc-$v hidden/inproc_main.cpp hidden/hidden_tests.cpp hidden/hidden_lib.cpp student/$v.cpp
  $CXX -o build/student/host-$v rpc/student_host.cpp rpc/stub.cpp student/$v.cpp
done
