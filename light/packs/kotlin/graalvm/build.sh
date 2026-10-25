#!/usr/bin/env bash
# Builds GraalVM Community with Web Image (native-image --tool:svm-wasm), from source, into the
# directory given (default ./dist), with the corresponding source beside it:
#
#   graalvm-community-webimage-$VERSION-linux-x64.tar.gz
#       the GraalVM home ../kotlinc/build.sh builds kotlinc's WebAssembly image with
#   graalvm-community-webimage-$VERSION-source.tar.gz
#       oracle/graal at $GRAAL_COMMIT with patches/ applied, and mx at $MX_TAG: everything this
#       script builds the home from, apart from the JDK
#   labs-openjdk-$LABSJDK_TAG-source.tar.gz
#       the source of the JDK the home is ($LABSJDK_COMMIT of graalvm/labs-openjdk)
#   SOURCES.txt, SHA256SUMS
#
# Why: Web Image's runtime and the JDK's class library end up in kc.js.wasm, so they are what
# the Kotlin pack ships. They are GPLv2 with the Classpath Exception, which asks for their
# source to be offered; Oracle ships Web Image prebuilt only in Oracle GraalVM, whose licence
# (the GraalVM Free Terms, early adopter terms for the 25.1 builds that have it) does not allow
# shipping the pack, and GraalVM Community's releases leave Web Image out. The same source, as
# Community, builds it.
#
# .github/workflows/light-kotlin-graalvm.yml runs this and attaches dist/ to the release that
# ../kotlinc/build.sh pins (GRAALVM_RELEASE, GRAALVM_SHA256). Needs git, curl, python3, gcc,
# about 6 GB of memory and 10 minutes on four cores; works in $YK_CACHE (default
# ~/.cache/yukibana-graalvm).
set -euo pipefail

# The commit GraalVM Community 25.4.4.1.1 (graal-25.4.4.1.1 of graalvm/graalvm-ce-builds) is
# built from, the mx its common.json names, and the labsjdk its ci/common.jsonnet names.
GRAAL_COMMIT=95ce1499c8c96ab7d5a6697c5b4bf42160f3b68b
MX_TAG=7.85.1
LABSJDK_TAG=jvmci-25.4-b23
LABSJDK_COMMIT=391a5a739cb60fcc35927c6afecf6d9ac00f391d
LABSJDK_FILE=labsjdk-ce-25.0.4.1.1+1-jvmci-25.4-b23-linux-amd64.tar.gz
# GitHub publishes no checksum for it; this is the file's when it was pinned.
LABSJDK_SHA256=871a0de0c24c35cbc17b364f9c3e322c709a85edd52d7ad5143bbb302c41232f
VERSION=25.4.4.1.1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="${YK_CACHE:-$HOME/.cache/yukibana-graalvm}"
DIST="$(mkdir -p "${1:-$HERE/dist}" && cd "${1:-$HERE/dist}" && pwd)"
mkdir -p "$CACHE"
NAME="graalvm-community-webimage-$VERSION"

# The JDK, checked.
if [ ! -f "$CACHE/$LABSJDK_FILE" ]; then
    curl -fsSL -o "$CACHE/$LABSJDK_FILE.part" "https://github.com/graalvm/labs-openjdk/releases/download/$LABSJDK_TAG/${LABSJDK_FILE//+/%2B}"
    mv "$CACHE/$LABSJDK_FILE.part" "$CACHE/$LABSJDK_FILE"
fi
echo "$LABSJDK_SHA256  $CACHE/$LABSJDK_FILE" | sha256sum -c --quiet || { rm -f "$CACHE/$LABSJDK_FILE"; echo "checksum mismatch: $LABSJDK_FILE" >&2; exit 1; }
rm -rf "$CACHE/labsjdk" && mkdir "$CACHE/labsjdk" && tar xzf "$CACHE/$LABSJDK_FILE" -C "$CACHE/labsjdk" --strip-components=1

# The sources, at exactly the pinned commits, fresh each time so patches/ applies to a clean tree.
clone() { # clone <url> <ref> <dir>
    rm -rf "$3" && git init -q "$3" && git -C "$3" fetch -q --depth 1 "$1" "$2" && git -C "$3" -c advice.detachedHead=false checkout -q FETCH_HEAD
}
clone https://github.com/oracle/graal "$GRAAL_COMMIT" "$CACHE/graal"
clone https://github.com/graalvm/mx "refs/tags/$MX_TAG" "$CACHE/mx"
[ "$(git -C "$CACHE/graal" rev-parse HEAD)" = "$GRAAL_COMMIT" ] || { echo "oracle/graal is not at $GRAAL_COMMIT" >&2; exit 1; }
for p in "$HERE"/patches/*.patch; do git -C "$CACHE/graal" apply --whitespace=nowarn "$p"; done

# Native Image and its Web Image tool, as Java launchers (--native-images=false): the builder
# runs on the JVM either way, and building the launchers natively is ten minutes for nothing.
export JAVA_HOME="$CACHE/labsjdk" PATH="$CACHE/mx:$PATH" MX_PYTHON=python3
MX=(mx --dy /substratevm,/web-image --components=ni,niwasm --native-images=false)
(cd "$CACHE/graal/vm" && "${MX[@]}" build)
HOME_DIR="$(cd "$CACHE/graal/vm" && "${MX[@]}" graalvm-home | tail -1)"
[ -x "$HOME_DIR/bin/native-image" ] && [ -f "$HOME_DIR/lib/svm/tools/svm-wasm/builder/svm-wasm.jar" ] \
    || { echo "the GraalVM home has no native-image or no svm-wasm: $HOME_DIR" >&2; exit 1; }

# Archives, with stable names, owners and times, so two builds of the same source differ only
# where the compilers' output does.
TAR=(tar --sort=name --owner=0 --group=0 --numeric-owner --mtime=@0)
rm -f "$DIST"/*
"${TAR[@]}" -C "$(dirname "$HOME_DIR")" --transform "s|^$(basename "$HOME_DIR")|$NAME|" -czf "$DIST/$NAME-linux-x64.tar.gz" "$(basename "$HOME_DIR")"
S="$CACHE/source" && rm -rf "$S" && mkdir -p "$S/$NAME-source/patches"
git -C "$CACHE/graal" archive --prefix="$NAME-source/graal/" HEAD | tar x -C "$S"
git -C "$CACHE/graal" diff | (cd "$S/$NAME-source/graal" && git apply --whitespace=nowarn)
git -C "$CACHE/mx" archive --prefix="$NAME-source/mx/" HEAD | tar x -C "$S"
cp "$HERE"/patches/*.patch "$S/$NAME-source/patches/"
cp "$HERE/build.sh" "$S/$NAME-source/"
"${TAR[@]}" -C "$S" -czf "$DIST/$NAME-source.tar.gz" "$NAME-source"
clone https://github.com/graalvm/labs-openjdk "$LABSJDK_COMMIT" "$CACHE/labs-openjdk"
git -C "$CACHE/labs-openjdk" archive --prefix="labs-openjdk-$LABSJDK_TAG/" HEAD | gzip -n > "$DIST/labs-openjdk-$LABSJDK_TAG-source.tar.gz"

cat > "$DIST/SOURCES.txt" <<EOF
GraalVM Community $VERSION with Web Image, built by Yukibana Light
(light/packs/kotlin/graalvm/build.sh in github.com/tothambrus11/yukibana-cloud)
for compiling the Kotlin compiler to WebAssembly.

$NAME-linux-x64.tar.gz is built from:

* oracle/graal (https://github.com/oracle/graal) at commit $GRAAL_COMMIT,
  the source of GraalVM Community $VERSION, with the patches in patches/:
$(for p in "$HERE"/patches/*.patch; do echo "  - $(basename "$p")"; done)
  Licensed as each of its files says; Native Image, SubstrateVM and Web Image
  are GPLv2 with the Classpath Exception.
* mx (https://github.com/graalvm/mx) $MX_TAG, the build tool (GPLv2).
* labsjdk ($LABSJDK_FILE), built from graalvm/labs-openjdk
  (https://github.com/graalvm/labs-openjdk) tag $LABSJDK_TAG,
  commit $LABSJDK_COMMIT (GPLv2 with the Classpath Exception).

The corresponding source of all three is attached beside this file:
$NAME-source.tar.gz (graal with the patches applied, mx, the patches and the
build script) and labs-openjdk-$LABSJDK_TAG-source.tar.gz.
EOF
(cd "$DIST" && sha256sum -- *.tar.gz SOURCES.txt > SHA256SUMS)
ls -l "$DIST"
