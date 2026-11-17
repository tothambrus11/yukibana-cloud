#!/bin/sh
# Compiles every arrangement into build/. The student's code is compiled
# twice: against the real library for one JVM, against the stub for a split
# run (the two have the same API, which is what a starter would ship).
set -eu
cd "$(dirname "$0")"
unset JAVA_TOOL_OPTIONS
rm -rf build
javac -d build/hidden hidden/hidden/*.java
javac -d build/rpc rpc/rpc/Channel.java
javac -cp build/rpc -d build/stub stub/hidden/HiddenLib.java
for v in honest batched attack; do
  javac -cp build/hidden -d build/inproc/$v student/$v/Solution.java hidden/InProc.java
  javac -cp build/rpc:build/stub -d build/student/$v student/$v/Solution.java
done
javac -cp build/rpc:build/stub:build/student/honest -d build/host rpc/StudentHost.java
javac -cp build/rpc:build/hidden -d build/trusted rpc/Trusted.java
