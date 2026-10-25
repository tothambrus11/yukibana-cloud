#!/usr/bin/env bash
# Sets up Yukibana Light for development on Linux, in minutes: the app's npm
# dependencies, and every language pack, downloaded already built from the
# pack store (scripts/pack-store.sh) for exactly the sources checked out, so
# nothing needs compiling. Run it again after a pull: a pack whose sources
# did not change is left as it is.
#
#   ./setup.sh                      the app and every pack
#   ./setup.sh python cpp           the app and these packs only
#   ./setup.sh --build cpp          build cpp from source (its build.sh) and
#                                   fetch the rest; --build all builds them all
#   ./setup.sh --latest             a pack whose exact sources CI has not built
#                                   yet (a local commit, a branch) takes the
#                                   store's newest build of it, instead of
#                                   being built here
#   ./setup.sh --no-install         never runs apt-get (sudo); says what to
#                                   install instead
#
# A pack that is built here gets the Debian/Ubuntu packages its deps.apt
# lists first (apt-get, with sudo); its build caches what it downloads and
# compiles in ~/.cache/yukibana-packs ($PACK_CACHE). The C++ and Swift packs
# take hours from nothing; the others minutes. Needs git, curl, tar with zstd,
# and Node 22 or later.
#
# Then: `cd app && npm run dev` (http://localhost:5173), or
# `npm run build && python3 ../serve.py build` for the built site.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STORE="$HERE/scripts/pack-store.sh"
ALL=()
for d in "$HERE"/packs/*/; do [ -f "$d/build.sh" ] && ALL+=("$(basename "$d")"); done

die() { echo "setup.sh: $*" >&2; exit 1; }
say() { printf '\n== %s\n' "$*"; }

packs=() build=() latest="" install=1
while [ $# -gt 0 ]; do
  case "$1" in
    --build) shift; [ $# -gt 0 ] || die "--build needs a pack (or all)"
             if [ "$1" = all ]; then build=("${ALL[@]}"); else IFS=, read -r -a more <<<"$1"; build+=("${more[@]}"); fi ;;
    --latest) latest=--any ;;
    --no-install) install="" ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option $1 (--help)" ;;
    *) packs+=("$1") ;;
  esac
  shift
done
[ ${#packs[@]} -gt 0 ] || packs=("${ALL[@]}")
for p in "${packs[@]}" "${build[@]}"; do
  [ -f "$HERE/packs/$p/build.sh" ] || die "no pack $p (one of: ${ALL[*]})"
done
in_list() { local x="$1"; shift; for y in "$@"; do [ "$x" = "$y" ] && return 0; done; return 1; }
for p in "${build[@]}"; do in_list "$p" "${packs[@]}" || packs+=("$p"); done

# What every path below needs.
say "Checking the tools"
missing=()
for t in git curl tar zstd node npm python3; do command -v "$t" >/dev/null || missing+=("$t"); done
[ ${#missing[@]} -eq 0 ] || die "missing: ${missing[*]} (on Ubuntu: sudo apt-get install git curl tar zstd python3, and Node from https://nodejs.org or nvm)"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 22 ] || die "Node $(node --version) is too old: Light needs Node 22 or later"
echo "git, curl, tar, zstd, python3 and Node $(node --version): fine"

say "Installing the app's dependencies (app/)"
(cd "$HERE/app" && npm ci --no-audit --no-fund)

# Packages for the packs that will be built, from their deps.apt.
apt_packages() { local p; for p in "$@"; do [ -f "$HERE/packs/$p/deps.apt" ] && grep -v '^#' "$HERE/packs/$p/deps.apt"; done | sort -u; }
install_deps() {
  local pkgs
  mapfile -t pkgs < <(apt_packages "$@")
  [ ${#pkgs[@]} -gt 0 ] || return 0
  if [ -z "$install" ] || ! command -v apt-get >/dev/null; then
    echo "setup.sh: building $* needs these packages (Debian/Ubuntu names): ${pkgs[*]}" >&2
    return 0
  fi
  say "Installing the packages $* needs to build"
  sudo apt-get update -q
  sudo apt-get install -y -q --no-install-recommends "${pkgs[@]}"
}

# A pack's own tools beyond the packages, which build.sh checks too; said here
# before an hour of building rather than after.
check_tools() {
  case "$1" in
    scala) java -version 2>&1 | grep -qE 'version "(1[7-9]|[2-9][0-9])' || die "the Scala pack builds with a JDK 17 or later (java -version)" ;;
    python) command -v uv >/dev/null || die "the Python pack builds with uv (https://docs.astral.sh/uv/: pipx install uv)" ;;
    php) command -v php >/dev/null || die "the PHP pack builds with the PHP command line (sudo apt-get install php-cli)" ;;
    rust) command -v rustup >/dev/null || die "the Rust pack builds with rustup (https://rustup.rs)" ;;
  esac
}

# A pack built from committed sources is as current as a fetched one, and is
# recorded so; one built from local changes is not, and is checked again.
build_pack() {
  check_tools "$1"
  say "Building the $1 pack (packs/$1/build.sh)"
  (cd "$HERE/packs/$1" && ./build.sh)
  mkdir -p "$HERE/.pack-trees"
  if [ -z "$(git -C "$HERE" status --porcelain -- "packs/$1")" ]; then
    "$STORE" tree "$1" > "$HERE/.pack-trees/$1"
  else
    rm -f "$HERE/.pack-trees/$1"
  fi
}

to_build=() fetched=() kept=()
for p in "${packs[@]}"; do
  if in_list "$p" "${build[@]}"; then to_build+=("$p"); continue; fi
  tree="$("$STORE" tree "$p")"
  if [ -f "$HERE/app/static/packs/$p/server.js" ] && [ "$(cat "$HERE/.pack-trees/$p" 2>/dev/null)" = "$tree" ]; then
    kept+=("$p"); continue
  fi
  [ -z "$(git -C "$HERE" status --porcelain -- "packs/$p")" ] ||
    echo "setup.sh: packs/$p has changes not committed; the store has builds of committed sources only (--build $p builds yours)" >&2
  say "Fetching the $p pack"
  status=0
  "$STORE" fetch "$p" $latest || status=$?
  case "$status" in
    0) fetched+=("$p") ;;
    3) echo "setup.sh: no build of packs/$p as checked out; building it (or rerun with --latest to take the newest build)" >&2
       to_build+=("$p") ;;
    *) exit "$status" ;;
  esac
done

if [ ${#to_build[@]} -gt 0 ]; then
  install_deps "${to_build[@]}"
  for p in "${to_build[@]}"; do build_pack "$p"; done
fi

say "Done"
[ ${#kept[@]} -eq 0 ] || echo "up to date: ${kept[*]}"
[ ${#fetched[@]} -eq 0 ] || echo "downloaded: ${fetched[*]}"
[ ${#to_build[@]} -eq 0 ] || echo "built: ${to_build[*]}"
cat <<'EOF'

Run it:   cd app && npm run dev            (http://localhost:5173, reloads on edits)
Built:    cd app && npm run build && python3 ../serve.py build   (http://localhost:8000)
Checks:   cd app && npm run check && npm run test:unit
EOF
