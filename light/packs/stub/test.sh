#!/usr/bin/env bash
# The stub pack's tests, run over the pack as assembled, in
# ../../app/static/packs/stub, by light-packs.yml's assemble job as every
# split pack's test.sh is: so the step that runs a pack's tests runs on
# every change to the packs, not only when a real pack is assembled. The
# stub is no language, so what it tests is what its assembly promises:
#
#   * server.js is the glue's, src/server.js, byte for byte;
#   * each unit's versions file is served, and its served files are there:
#     bin/cc (compilers), vm/kernel (vm), lib/libframework.a (libs), the
#     last built by the compilers unit's cc, as libs' needs say;
#   * no unit's build-only/ is served (compilers' build-only/flags is read
#     only by the units built with it).
#
#   ./test.sh            runs them, after assembly
#   ./test.sh --inputs   prints the paths outside this pack the tests read:
#                        none
#   ./test.sh --setup    installs what the tests need on a fresh runner:
#                        nothing
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../../app/static/packs/stub"

case "${1:-}" in
  --inputs|--setup) exit 0 ;;
  '') ;;
  *) echo "test.sh: unknown argument $1 (--inputs, --setup, or none)" >&2; exit 2 ;;
esac

[ -d "$OUT" ] || { echo "test.sh: no assembled pack at $OUT" >&2; exit 1; }
problems=()
cmp -s "$HERE/src/server.js" "$OUT/server.js" || problems+=("server.js is not src/server.js")
for f in versions-compilers.json versions-libs.json versions-vm.json bin/cc vm/kernel lib/libframework.a; do
  [ -f "$OUT/$f" ] || problems+=("$f is not served")
done
if [ -f "$OUT/lib/libframework.a" ] && ! head -n 1 "$OUT/lib/libframework.a" | grep -q '^built by cc '; then
  problems+=("lib/libframework.a was not built by the compilers unit's cc")
fi
[ ! -e "$OUT/build-only" ] || problems+=("build-only/ is served")

if [ "${#problems[@]}" -gt 0 ]; then
  printf 'test.sh: %s\n' "${problems[@]}" >&2
  exit 1
fi
echo "test.sh: the assembled stub pack is what its units and glue made"
