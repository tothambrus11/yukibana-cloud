#!/usr/bin/env bash
# Makes the fixtures test-classfile.mjs reads: sample.json's sources
# compiled by a desktop javac (21 or later; release 21, -g as javac's
# default is: source and lines) into classes.jar, and what that JDK's javap
# prints for each class (javap -c -p), the listing classfile.js is checked
# against. Run again after changing sample.json, and look at the diff.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
node -e '
const fs = require("fs"), path = require("path");
const [sample, root] = process.argv.slice(1);
for (const [p, text] of Object.entries(JSON.parse(fs.readFileSync(sample, "utf8")))) {
    fs.mkdirSync(path.join(root, "src", path.dirname(p)), { recursive: true });
    fs.writeFileSync(path.join(root, "src", p), text);
}' "$HERE/sample.json" "$TMP"
mkdir "$TMP/out"
(cd "$TMP/src" && javac --release 21 -d "$TMP/out" $(find . -name '*.java' | sort))
(cd "$TMP/out" && jar --create --file "$HERE/classes.jar" $(find . -name '*.class' | sort | sed 's|^\./||'))
: > "$HERE/javap.txt"
for c in $(cd "$TMP/out" && find . -name '*.class' | sort | sed 's|^\./||; s|\.class$||'); do
    echo "=== $c" >> "$HERE/javap.txt"
    javap -c -p -cp "$TMP/out" "${c//\//.}" | sed '/^Compiled from/d' >> "$HERE/javap.txt"
done
