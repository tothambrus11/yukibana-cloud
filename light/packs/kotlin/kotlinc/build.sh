#!/usr/bin/env bash
# Builds the real Kotlin compiler (kotlinc, K2) as WebAssembly GC with GraalVM Web Image, into
# the directory given (default ./dist); the Kotlin pack's build.sh runs it into its cache:
#
#   kc.js, kc.js.wasm   kotlinc $KOTLIN_VERSION and yk.KotlinService (service/), compiled by
#                       native-image --tool:svm-wasm; kc.js reads globalThis.ykWasmPath
#   lib/                the libraries a compilation reads, with their zip entries stored, not
#                       deflated (there is no zlib at run time): kotlin-stdlib.jar,
#                       jdk-api.jar (java.base's java.* classes, for -no-jdk),
#                       kotlin-stdlib-js.klib, kotlin-stdlib-wasm-wasi.klib,
#                       kotlin-test-wasm-wasi.klib (Maven Central; kotlinc's zip has no kotlin.test
#                       for Kotlin/Wasm)
#   abi/                kotlin-stdlib-wasm-wasi.txt and kotlin-test-wasm-wasi.txt, those klibs'
#                       public API as kotlinc dumps it (tools/src/yk/DumpAbi.java)
#
# Steps: download and check the pinned GraalVM, binaryen and kotlinc; patch the compiler's jars
# (tools/); compile the service, the substitutions and the tracing driver;
# trace kotlinc's reflection on HotSpot with native-image-agent (unless config/ already has it);
# build the image; assemble dist/.
#
# Needs curl, unzip, zip, python3, node 22+, about 14 GB of memory and 25 minutes the first time.
# Everything downloaded or built goes to $YK_CACHE (default ~/.cache/yukibana-kotlin-wasm).
set -euo pipefail

KOTLIN_VERSION=2.4.21
KOTLIN_SHA256=7cc140e76daf416a0424a5557f99afd7ca89ebd463ea1101261e3e01c33e75cd
# GraalVM Community 25.4 with Web Image, which Oracle builds but does not ship for Community:
# built from source by ../graalvm/build.sh and published, with its corresponding source, as the
# release $GRAALVM_RELEASE of this repository (.github/workflows/light-kotlin-graalvm.yml). With
# YK_GRAALVM_HOME set, that GraalVM is used instead (one ../graalvm/build.sh made, say).
GRAALVM_RELEASE=kotlin-graalvm-25.4.4.1.1-1
GRAALVM_FILE=graalvm-community-webimage-25.4.4.1.1-linux-x64.tar.gz
GRAALVM_SHA256=65f8dab8823c052e8a849742ab12e881af5e9559262f316eff34faba4198588b
BINARYEN_VERSION=133
BINARYEN_SHA256=2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489
# Maven Central publishes no .sha256 for it; this is the file's, checked against its .sha1
# (c8d5bd92557e809f2b9f423e44a2646945c8f09a) when it was pinned.
KOTLIN_TEST_WASI_SHA256=d1083ca4a4cf27751b272d4c78b5e8d2cc5e5dbc48965aec2f746546ad9e12c0

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="${YK_CACHE:-$HOME/.cache/yukibana-kotlin-wasm}"
DIST="$(mkdir -p "${1:-$HERE/dist}" && cd "${1:-$HERE/dist}" && pwd)"
mkdir -p "$CACHE" "$DIST/lib"

fetch() { # fetch <url> <file> <sha256>: into $CACHE, verified
    local dst="$CACHE/$2"
    [ -f "$dst" ] || { curl -fsSL -o "$dst.part" "$1"; mv "$dst.part" "$dst"; }
    echo "$3  $dst" | sha256sum -c --quiet || { rm -f "$dst"; echo "checksum mismatch: $2" >&2; exit 1; }
}
if [ -z "${YK_GRAALVM_HOME:-}" ]; then
    fetch "https://github.com/tothambrus11/yukibana-cloud/releases/download/$GRAALVM_RELEASE/$GRAALVM_FILE" "$GRAALVM_FILE" "$GRAALVM_SHA256"
fi
fetch "https://github.com/WebAssembly/binaryen/releases/download/version_$BINARYEN_VERSION/binaryen-version_$BINARYEN_VERSION-x86_64-linux.tar.gz" \
    "binaryen-$BINARYEN_VERSION.tar.gz" "$BINARYEN_SHA256"
fetch "https://github.com/JetBrains/kotlin/releases/download/v$KOTLIN_VERSION/kotlin-compiler-$KOTLIN_VERSION.zip" \
    "kotlin-compiler-$KOTLIN_VERSION.zip" "$KOTLIN_SHA256"
fetch "https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-test-wasm-wasi/$KOTLIN_VERSION/kotlin-test-wasm-wasi-$KOTLIN_VERSION.klib" \
    "kotlin-test-wasm-wasi-$KOTLIN_VERSION.klib" "$KOTLIN_TEST_WASI_SHA256"

G="${YK_GRAALVM_HOME:-$CACHE/$GRAALVM_RELEASE}"
if [ ! -d "$G" ]; then
    rm -rf "$G.part" && mkdir -p "$G.part" && tar xzf "$CACHE/$GRAALVM_FILE" -C "$G.part" --strip-components=1
    mv "$G.part" "$G"
fi
[ -d "$CACHE/binaryen" ] || { tar xzf "$CACHE/binaryen-$BINARYEN_VERSION.tar.gz" -C "$CACHE" && mv "$CACHE/binaryen-version_$BINARYEN_VERSION" "$CACHE/binaryen"; }
[ -d "$CACHE/kotlinc" ] || unzip -q "$CACHE/kotlin-compiler-$KOTLIN_VERSION.zip" -d "$CACHE"
export JAVA_HOME="$G" PATH="$G/bin:$CACHE/binaryen/bin:$PATH"
KLIB="$CACHE/kotlinc/lib"
B="$CACHE/build"
rm -rf "$B" && mkdir -p "$B"/{jars,tools,trace,service,subst,image}

# Our tools, against the compiler's shaded ASM.
javac -nowarn -cp "$KLIB/kotlin-compiler.jar" -d "$B/tools" "$HERE"/tools/src/yk/*.java

# The compiler's jars, without the jline native-image configuration kotlin-compiler.jar carries
# (it names files the jar does not have) and without interfaces' abstract redeclarations of
# Object's methods (tools/src/yk/StripObjectMethods.java).
JARS=(kotlin-compiler kotlin-stdlib kotlin-reflect kotlin-script-runtime kotlinx-coroutines-core-jvm annotations-13.0)
for j in "${JARS[@]}"; do
    java -cp "$B/tools:$KLIB/kotlin-compiler.jar" yk.StripObjectMethods "$KLIB/$j.jar" "$B/jars/$j.jar"
done
zip -q -d "$B/jars/kotlin-compiler.jar" 'META-INF/native-image/*'

# fwcd/kotlin-language-server, the language server the pack's editor asks for completion, hover
# and the rest (kls/README.md): its source at a pinned commit (git checks the content against the
# hash) with kls/*.patch applied, compiled here against this kotlinc, and the libraries it uses,
# from Maven Central, pinned by sha256 (Maven Central publishes none; each was checked against
# its .sha1 when it was pinned). Stripped like the compiler's jars.
KLS_COMMIT=6d9e61b79d4631e75516def7ab7ff0d8b9310467
KLS_DEPS=( # group:artifact:version sha256
    "org.eclipse.lsp4j:org.eclipse.lsp4j:0.21.2 584470047893197916445f50fca93d18ad326756d55c5ae7ffb8dc0ef81c25b5"
    "org.eclipse.lsp4j:org.eclipse.lsp4j.jsonrpc:0.21.2 cb871751dffbabfac0b43a84309625ab6ea4e4eb08805b32144d20c5dfcdf282"
    "com.google.code.gson:gson:2.10.1 4241c14a7727c34feea6507ec801318a3d4a90f070e4525681079fb94ee4c593"
    "org.jetbrains.exposed:exposed-core:0.37.3 29aef18679de8728a409a4c2ce727586e35a7d632217545e86060ddf1f15aece"
    "org.jetbrains.exposed:exposed-dao:0.37.3 f50ac718b8f6b89384ba915e93ee8f59bd90fe8fff27e4d24fed26b89acf8bca"
    "org.jetbrains.exposed:exposed-jdbc:0.37.3 8c9ecb69d5951e8dfbf136b373448687d807d5c369515e7ba175fd9d1d7070ef"
    "com.h2database:h2:1.4.200 3ad9ac4b6aae9cd9d3ac1c447465e1ed06019b851b893dd6a8d76ddb6d85bca6"
    "com.google.guava:guava:33.4.0-jre b918c98a7e44dbe94ebd9fe3e40cddaadb5a93e6a78eb6008b42df237241e538"
    "com.google.guava:failureaccess:1.0.2 8a8f81cf9b359e3f6dfa691a1e776985c061ef2f223c9b2c80753e1b458e8064"
    "com.beust:jcommander:1.82 deeac157c8de6822878d85d0c7bc8467a19cc8484d37788f7804f039dde280b1"
    "org.slf4j:slf4j-api:1.7.36 d3ef575e3e4979678dc01bf1dcce51021493b4d11fb7f1be8ad982877c16a1c0"
    "org.slf4j:slf4j-nop:1.7.36 c214958b07816cb4412b30c7bdbd4308ffdc6ba2a83767b8f3a9229cbd9274d6"
    "com.facebook:ktfmt:0.47 434f2d984488d6f5181c10eec3b8507df03993031f3a6df53b29c91d521573dd"
    "org.vineflower:vineflower:1.11.1 a615d07ddbbcd489369674f40e42df639c32be95410890b38f173d5c1e2ea39c"
    "org.jetbrains.kotlin:kotlin-scripting-jvm-host-unshaded:$KOTLIN_VERSION 9d710e547d1304d7b4a127f5dad3a964a21030913b0263d6aa1e267380b61395"
)
for d in "${KLS_DEPS[@]}"; do
    IFS=: read -r g a v <<< "${d% *}"
    fetch "https://repo1.maven.org/maven2/${g//.//}/$a/$v/$a-$v.jar" "$a-$v.jar" "${d#* }"
    java -cp "$B/tools:$KLIB/kotlin-compiler.jar" yk.StripObjectMethods "$CACHE/$a-$v.jar" "$B/jars/$a.jar"
    # LSP4J's jars are signed, and a stripped class no longer matches its signature.
    zip -q -d "$B/jars/$a.jar" 'META-INF/*.SF' 'META-INF/*.RSA' 'META-INF/*.DSA' 'META-INF/*.EC' >/dev/null 2>&1 || true
done
# H2 reads its messages from a zip inside its jar (substitutions/src/yk/H2Substitutions.java).
rm -rf "$B/h2" && mkdir "$B/h2" && (cd "$B/h2" && unzip -q -p "$B/jars/h2.jar" org/h2/util/data.zip > data.zip && unzip -q data.zip 'org/h2/res/*' && zip -q -r "$B/jars/h2.jar" org)
for j in kotlin-scripting-common kotlin-scripting-jvm kotlin-scripting-compiler-impl kotlin-scripting-compiler; do
    java -cp "$B/tools:$KLIB/kotlin-compiler.jar" yk.StripObjectMethods "$KLIB/$j.jar" "$B/jars/$j.jar"
done
KLS="$CACHE/kotlin-language-server"
if [ "$(git -C "$KLS" rev-parse HEAD 2>/dev/null)" != "$KLS_COMMIT" ]; then
    rm -rf "$KLS" && git init -q "$KLS" && git -C "$KLS" fetch -q --depth 1 https://github.com/fwcd/kotlin-language-server "$KLS_COMMIT"
    git -C "$KLS" -c advice.detachedHead=false checkout -q FETCH_HEAD
fi
git -C "$KLS" checkout -q -- . && git -C "$KLS" clean -qfdx && git -C "$KLS" apply "$HERE"/kls/*.patch
# Its own build is Gradle's; this is what that build compiles, with the compiler's opt-ins for the
# K1 API it uses spelled out instead of a newer kotlinc's errors.
KLS_OPT_INS=(K1Deprecation CoreEnvironmentDeprecation config.CompilerConfiguration.Internals DeprecatedCompilerApi
    DeprecatedForRemovalCompilerApi CompilerVersionOfApiDeprecation config.MessageCollectorAccess)
CP=$(ls "$B"/jars/*.jar | tr '\n' ':'); CP=${CP%:}
"$CACHE/kotlinc/bin/kotlinc" -jvm-target 17 -nowarn "${KLS_OPT_INS[@]/#/-opt-in=org.jetbrains.kotlin.}" -cp "$CP" \
    -d "$B/jars/kotlin-language-server.jar" "$KLS/shared/src/main/kotlin" "$KLS/server/src/main/kotlin"
CP=$(ls "$B"/jars/*.jar | tr '\n' ':'); CP=${CP%:}

# Reflection the image needs beyond what tracing sees: the fields of every class handed to an
# Atomic*FieldUpdater; kotlinc's argument classes, which its parser fills reflectively; and the
# language server's protocol types, which gson builds and reads field by field, whichever of them
# a message happens to carry (a trace sees only the ones its session sent). And the constructors
# of every PSI class: the language server's K1 analysis parses into PSI, whose element types make
# each node's class reflectively, by node or by stub (kotlinc's K2 parses into a light tree, so
# its trace sees few of them).
mkdir -p "$B/service/META-INF/native-image/yk-generated"
java -cp "$B/tools:$B/jars/kotlin-compiler.jar" yk.FindUpdaters "$B"/jars/*.jar > "$B/updaters.json"
{
    unzip -Z1 "$B/jars/kotlin-compiler.jar" 'org/jetbrains/kotlin/cli/common/arguments/*.class'
    unzip -Z1 "$B/jars/org.eclipse.lsp4j.jar" '*.class'
    unzip -Z1 "$B/jars/org.eclipse.lsp4j.jsonrpc.jar" 'org/eclipse/lsp4j/jsonrpc/messages/*.class'
    unzip -Z1 "$B/jars/kotlin-language-server.jar" 'org/javacs/kt/*.class' | grep -v '^org/javacs/kt/.*/'
} > "$B/arguments.txt"
unzip -Z1 "$B/jars/kotlin-compiler.jar" 'org/jetbrains/kotlin/psi/*.class' 'org/jetbrains/kotlin/kdoc/psi/*.class' > "$B/psi.txt"
python3 -I - "$B/updaters.json" "$B/arguments.txt" "$B/psi.txt" "$B/service/META-INF/native-image/yk-generated/reachability-metadata.json" <<'EOF'
import json, sys
updaters, arguments, psi, out = sys.argv[1:]
r = json.load(open(updaters))["reflection"]
for line in open(arguments):
    t = line.strip()[:-len(".class")].replace("/", ".")
    r.append({"type": t, "allDeclaredFields": True, "allDeclaredMethods": True,
              "allPublicMethods": True, "allDeclaredConstructors": True})
for line in open(psi):
    r.append({"type": line.strip()[:-len(".class")].replace("/", "."), "allPublicConstructors": True})
json.dump({"reflection": r, "resources": [{"glob": "org/h2/res/*"}]}, open(out, "w"), indent=1)
EOF

javac -nowarn --add-modules org.graalvm.webimage.api -parameters -cp "$CP" -d "$B/service" "$HERE"/service/src/yk/*.java
cp -r "$HERE/service/META-INF" "$B/service/"
javac -nowarn --add-modules org.graalvm.nativeimage -d "$B/subst" "$HERE"/substitutions/src/yk/*.java

# Libraries, with stored entries.
store() { # store <archive> <out>
    rm -rf "$B/x" && mkdir "$B/x" && (cd "$B/x" && unzip -q "$1" && zip -q -0 -X -r "$2" .)
}
rm -f "$DIST"/lib/*
mkdir -p "$B/jdk" && jmod extract --dir "$B/jdk" "$G/jmods/java.base.jmod"
(cd "$B/jdk/classes" && find java -name '*.class' ! -name '*$[0-9]*' | sort | zip -q -0 -X "$DIST/lib/jdk-api.jar" -@)
store "$KLIB/kotlin-stdlib.jar" "$DIST/lib/kotlin-stdlib.jar"
store "$KLIB/kotlin-stdlib-js.klib" "$DIST/lib/kotlin-stdlib-js.klib"
store "$KLIB/kotlin-stdlib-wasm-wasi.klib" "$DIST/lib/kotlin-stdlib-wasm-wasi.klib"
store "$CACHE/kotlin-test-wasm-wasi-$KOTLIN_VERSION.klib" "$DIST/lib/kotlin-test-wasm-wasi.klib"

# The API of the two a Kotlin/Wasm program sees, as kotlinc's ABI dump, which the pack's build
# turns into the language server's index of the standard library (../scripts/stdlib-index.mjs).
rm -rf "$DIST/abi" && mkdir "$DIST/abi"
for k in "$KLIB/kotlin-stdlib-wasm-wasi.klib" "$CACHE/kotlin-test-wasm-wasi-$KOTLIN_VERSION.klib"; do
    java -cp "$B/tools:$KLIB/kotlin-compiler.jar:$KLIB/kotlin-stdlib.jar" yk.DumpAbi "$k" "$DIST/abi/$(basename "$k" .klib | sed "s/-$KOTLIN_VERSION\$//").txt"
done

# Reflection, resources and proxies kotlinc and the language server use, traced on HotSpot over
# the same compilations test/run-node.mjs makes and a session of the language server's.
# Committed in config/; delete it to trace again. The GraalVM above has no tracing agent (its
# build leaves the agent out), so the trace runs on Oracle GraalVM, which has; only its output,
# a JSON file, is used.
TRACED="$HERE/config/traced-reachability-metadata.json"
TRACE_GRAALVM=graalvm-jdk-25.0.4
TRACE_GRAALVM_SHA256=76007c309f821aaf435bce63162ea0395587fc77350801c81643fe7feea37276
if [ ! -f "$TRACED" ]; then
    fetch "https://download.oracle.com/graalvm/25/archive/${TRACE_GRAALVM}_linux-x64_bin.tar.gz" "${TRACE_GRAALVM}_linux-x64_bin.tar.gz" "$TRACE_GRAALVM_SHA256"
    TG="$CACHE/$TRACE_GRAALVM"
    [ -d "$TG" ] || { mkdir -p "$TG.part" && tar xzf "$CACHE/${TRACE_GRAALVM}_linux-x64_bin.tar.gz" -C "$TG.part" --strip-components=1 && mv "$TG.part" "$TG"; }
    javac -nowarn -cp "$CP" -d "$B/trace" "$HERE"/trace/src/yk/*.java "$HERE/service/src/yk/LanguageServerBridge.java"
    T="$B/trace-run"; mkdir -p "$T/cfg"
    run() { "$TG/bin/java" -agentlib:native-image-agent=config-merge-dir="$T/cfg" -cp "$B/trace:$CP" yk.Kc "$@" -kotlin-home "$CACHE/kotlinc" >/dev/null 2>&1 || true; }
    D="$HERE/test/demo"
    run jvm -no-jdk -no-stdlib -no-reflect -classpath "$DIST/lib/kotlin-stdlib.jar:$DIST/lib/jdk-api.jar" -d "$T/o1" "$D/Main.kt"
    run jvm -Xuse-fast-jar-file-system=false -no-jdk -no-stdlib -no-reflect -classpath "$DIST/lib/kotlin-stdlib.jar:$DIST/lib/jdk-api.jar" -d "$T/o2" "$D/Bad.kt"
    run js -Xir-produce-klib-dir -ir-output-dir "$T/k" -ir-output-name main -libraries "$KLIB/kotlin-stdlib-js.klib" "$D/Main.kt"
    run js -Xir-produce-js -Xinclude="$T/k" -ir-output-dir "$T/j" -ir-output-name main -libraries "$KLIB/kotlin-stdlib-js.klib" -main call -target es2015 -module-kind es
    W=(-Xwasm-target=wasm-wasi -libraries "$KLIB/kotlin-stdlib-wasm-wasi.klib" -ir-output-name main)
    run wasm "${W[@]}" -Xir-produce-klib-dir -ir-output-dir "$T/wk" "$D/Io.kt"
    run wasm "${W[@]}" -Xir-produce-js -Xinclude="$T/wk" -Xcache-directory="$T/c" -ir-output-dir "$T/w"
    run wasm "${W[@]}" -Xir-produce-js -Xinclude="$T/wk" -Xcache-directory="$T/c" -ir-output-dir "$T/w"
    # The language server, through the bridge the service uses, one request of each kind.
    "$TG/bin/java" -agentlib:native-image-agent=config-merge-dir="$T/cfg" -cp "$B/trace:$CP" yk.Lsp "$DIST/lib/kotlin-stdlib.jar" "$D" 2>&1 | grep '^\[yk\]' || true
    cp "$T/cfg/reachability-metadata.json" "$TRACED"
fi
mkdir -p "$B/traced" && cp "$TRACED" "$B/traced/reachability-metadata.json"

# The image. -Ob (quick build) keeps the builder at about 10 GB (with the language server; its last
# stage ran out of a 10 GB heap); wasm-as runs afterwards.
mkdir -p "$B/stub" && cp "$HERE/tools/wasm-as-stub.sh" "$B/stub/wasm-as" && ln -sf "$CACHE/binaryen/bin/wasm-as" "$B/stub/wasm-as.real"
(cd "$B/image" && native-image --tool:svm-wasm -J-Xmx12g -Ob \
    -H:+AddAllCharsets -H:WasmComments=NONE -H:ImageHeapObjectsPerFunction=20000 \
    -H:WasmAsPath="$B/stub/wasm-as" \
    -H:ConfigurationFileDirectories="$B/traced" \
    -cp "$B/service:$B/subst:$CP" -o kc yk.KotlinService)
(cd "$B/image" && eval "wasm-as $(cat kc.js.wasm.args)" && rm -f kc.js.wat)

# kc.js finds its .wasm next to the script that loaded it; a worker that importScripts() it
# names the path instead.
sed 's|const wasmPath = config.wasm_path \|\| runtime.getCurrentFile() + ".wasm";|const wasmPath = config.wasm_path \|\| globalThis.ykWasmPath \|\| runtime.getCurrentFile() + ".wasm";|' \
    "$B/image/kc.js" > "$DIST/kc.js"
grep -q ykWasmPath "$DIST/kc.js" || { echo "kc.js: the wasm path line moved" >&2; exit 1; }
cp "$B/image/kc.js.wasm" "$DIST/"
# The image is kotlinc linked with GraalVM's runtime and the JDK's class library, so the pack
# ships all three licences, each file with its parts under a header:
#   LICENSE-kotlin.txt   kotlinc: Apache 2.0, its NOTICE, and the licences of what it bundles
#                        (license/third_party/, less testdata/, which is only in its tests)
#   LICENSE-graalvm.txt  Native Image and Web Image's runtime (GPLv2 with the Classpath
#                        Exception), and jimfs and Guava, Web Image's file system (Apache 2.0)
#   LICENSE-openjdk.txt  the JDK's class library (GPLv2 with the Classpath Exception), with the
#                        third-party notices of every module the image may take classes from
#   LICENSE-kotlin-language-server.txt
#                        fwcd/kotlin-language-server (MIT) and the libraries it is linked with
#                        (kls/README.md, "Licences")
#   SOURCES.txt          where the corresponding source of the GPL, EPL and MPL parts is
section() { # section <title> <file>...: each file under a header
    printf '%s\n%s\n%s\n\n' "$(printf '=%.0s' {1..78})" "$1" "$(printf '=%.0s' {1..78})"
    shift
    for f in "$@"; do printf -- '--- %s ---\n\n' "$(basename "$f")"; cat "$f"; printf '\n\n'; done
}
KL="$CACHE/kotlinc/license"
{
    section "Kotlin compiler $KOTLIN_VERSION (kotlinc), standard library and kotlin.test" "$KL/LICENSE.txt" "$KL/NOTICE.txt" "$KL/COPYRIGHT.txt"
    section "Third-party software in the Kotlin compiler" "$KL/README.md" $(find "$KL/third_party" -maxdepth 1 -type f | LC_ALL=C sort)
} > "$DIST/LICENSE-kotlin.txt"
KLSL="$HERE/kls/licenses"
{
    section "fwcd/kotlin-language-server (commit $KLS_COMMIT, with kls/kotlin-language-server.patch; MIT)" "$KLS/LICENSE.txt"
    printf '%s\n' "It is linked with these libraries, under the licences that follow:" "" \
        "  Eclipse LSP4J 0.21.2 (org.eclipse.lsp4j, org.eclipse.lsp4j.jsonrpc)  EPL-2.0" \
        "  H2 Database Engine 1.4.200                                          MPL-2.0 (dual-licensed MPL-2.0 or EPL-1.0)" \
        "  Gson 2.10.1, Guava 33.4.0 and failureaccess 1.0.2 (Google)          Apache-2.0" \
        "  Exposed 0.37.3 (JetBrains), JCommander 1.82, ktfmt 0.47 (Meta),     Apache-2.0" \
        "  Vineflower 1.11.1, Kotlin scripting $KOTLIN_VERSION (JetBrains)" \
        "  SLF4J 1.7.36 (slf4j-api, slf4j-nop)                                 MIT" ""
    section "Eclipse Public License 2.0 (Eclipse LSP4J)" "$KLSL/EPL-2.0.txt"
    section "Mozilla Public License 2.0 (H2)" "$KLSL/MPL-2.0.txt"
    section "Apache License 2.0 (Gson, Guava, Exposed, JCommander, ktfmt, Vineflower, Kotlin scripting)" "$KLSL/Apache-2.0.txt"
    section "MIT License (SLF4J)" "$KLSL/MIT-slf4j.txt"
} > "$DIST/LICENSE-kotlin-language-server.txt"
mkdir -p "$B/legal" && (cd "$B/legal" && unzip -q -o "$G/lib/svm/tools/svm-wasm/builder/svm-wasm-guava.jar" META-INF/LICENSE)
{
    section "GraalVM Community $(sed -n 's/^GRAALVM_VERSION="\(.*\)"$/\1/p' "$G/release"): Native Image and Web Image" "$G/LICENSE_NATIVEIMAGE.txt"
    section "jimfs and Guava, in Web Image's runtime (Apache License 2.0)" "$B/legal/META-INF/LICENSE"
} > "$DIST/LICENSE-graalvm.txt"
{
    section "OpenJDK class library ($(sed -n 's/^JAVA_RUNTIME_VERSION="\(.*\)"$/\1/p' "$G/release"))" \
        "$G/legal/java.base/LICENSE" "$G/legal/java.base/ASSEMBLY_EXCEPTION" "$G/legal/java.base/ADDITIONAL_LICENSE_INFO"
    # One copy of each notice: modules share many (symbolic links to java.base's).
    section "Third-party software in the OpenJDK class library" \
        $(find -L "$G/legal" -type f -name '*.md' -printf '%f %p\n' | LC_ALL=C sort -u -k1,1 | cut -d' ' -f2)
} > "$DIST/LICENSE-openjdk.txt"
cat > "$DIST/SOURCES.txt" <<SOURCES
kc.js and kc.js.wasm are the Kotlin compiler $KOTLIN_VERSION compiled to WebAssembly by
GraalVM Community with Web Image, built from source by Yukibana Light
(light/packs/kotlin in https://github.com/tothambrus11/yukibana-cloud).

They contain GraalVM's Native Image and Web Image runtime and the OpenJDK class
library, which are licensed under the GPL version 2 with the Classpath Exception
(LICENSE-graalvm.txt, LICENSE-openjdk.txt). Their corresponding source, and the
patches and script the GraalVM was built with, are attached to the release
$GRAALVM_RELEASE:

  https://github.com/tothambrus11/yukibana-cloud/releases/tag/$GRAALVM_RELEASE

The Kotlin compiler's source is https://github.com/JetBrains/kotlin at tag
v$KOTLIN_VERSION; the patches applied to its jars and the service around it are
in light/packs/kotlin/kotlinc of the repository above.

They also contain fwcd/kotlin-language-server, from
https://github.com/fwcd/kotlin-language-server at commit $KLS_COMMIT with
light/packs/kotlin/kotlinc/kls/kotlin-language-server.patch applied, and the
libraries it uses (LICENSE-kotlin-language-server.txt). The source of the parts
under the EPL and the MPL is available here:

  Eclipse LSP4J 0.21.2   https://github.com/eclipse-lsp4j/lsp4j/tree/v0.21.2
                         (and its -sources.jar on Maven Central,
                         org.eclipse.lsp4j:org.eclipse.lsp4j:0.21.2)
  H2 1.4.200             https://github.com/h2database/h2database/tree/version-1.4.200
                         (and com.h2database:h2:1.4.200's -sources.jar)
SOURCES
GRAALVM_VERSION="$(sed -n 's/^GRAALVM_VERSION="\(.*\)"$/\1/p' "$G/release")"
printf '{"kotlin":"%s","graalvm":"%s","binaryen":"%s"}\n' "$KOTLIN_VERSION" "$GRAALVM_VERSION" "$BINARYEN_VERSION" > "$DIST/versions.json"
# The build directory is about 300 MB nobody reads again.
rm -rf "$B"
ls -l "$DIST" "$DIST/lib"
