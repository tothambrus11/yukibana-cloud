#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# The store of built language packs: each pack's output
# (app/static/packs/<pack>) as built from one exact version of its sources,
# kept as the asset <pack>-<tree>.tar.zst of the rolling prerelease
# "light-packs" of this repository. <tree> is the git tree id of
# packs/<pack> (`git rev-parse HEAD:light/packs/<pack>`), which names the
# directory's content exactly: build.sh reads nothing outside it but its own
# download cache, and pins every download by sha256, so the same tree gives
# the same output and a pack whose tree has an asset never needs building.
# Writes go through CI (light-packs.yml); reads need no account.
#
#   pack-store.sh tree <pack>             the tree id of HEAD's packs/<pack>
#   pack-store.sh has <pack>              exit 0 when the store has HEAD's
#       asset of the pack, 3 when it has none; downloads nothing.
#   pack-store.sh fetch <pack> [--any]    downloads HEAD's asset of the pack
#       and puts it in place of app/static/packs/<pack>; exit 3 when there is
#       none. --any takes the pack's newest asset when HEAD's is missing (a
#       commit CI has not built yet), saying which.
#   pack-store.sh publish <pack>          uploads app/static/packs/<pack> as
#       HEAD's asset (gh, with GH_TOKEN allowed to write releases), creating
#       the release on first use, then deletes all but the pack's KEEP
#       newest assets. An asset that exists already is left as it is.
#
# Every download is checked against the sha256 GitHub records for the asset.
# The tree a fetched pack came from is written to ../.pack-trees/<pack>, which
# light/setup.sh reads to skip a pack that is already current.
#
# A split pack (one with packs/<pack>/toolchain.paths) is never in this
# store: `has`, `fetch` and `publish` exit 2 for one. Its toolchain is kept
# in the toolchain store instead and the pack assembled over it
# (pack-toolchain.sh), so a glue edit rebuilds nothing:
#
#   pack-store.sh toolchain-key <pack>    the key of the pack's toolchain,
#       40 hex digits: the sha256 of its inputs in the worktree, the build
#       environment (toolchain-build-env.sh) among them, and its set variant
#       knobs, as toolchain-key.sh defines and documents. So changing
#       toolchain-build-env.sh rebuilds every toolchain; changing
#       toolchain-key.sh, this script, pack-lib.sh or pack-toolchain.sh
#       (assembly) rebuilds none. Exit 2: not split.
#   pack-store.sh toolchain-key-report <pack> <base>    what changed the key
#       since commit <base>: the inputs that differ, the env lines then and
#       now, both keys when toolchain.paths or toolchain.env changed, and a
#       last line `changed` or `unchanged`. Exit 6 when <base> is not in
#       this clone.
#   pack-store.sh toolchain-dirty <pack>  exit 0 naming the inputs with
#       uncommitted changes, 1 when there are none.
#   pack-store.sh toolchain-has <pack>    exit 0 when the toolchain store has
#       the asset toolchain-<pack>-<key>.tar.zst, 3 when it has none.
#   pack-store.sh toolchain-fetch <pack> [--any] [dir]   downloads it into
#       dir (default $TOOLCHAIN_CACHE/built/<pack>/<key>), read-only, and
#       prints dir; exit 3 when there is none. --any takes the pack's newest
#       toolchain whatever its key, saying which.
#   pack-store.sh toolchain-publish <pack> <dir>    uploads dir as the
#       toolchain of HEAD's inputs, refusing one built from anything else.
#       Never deletes: from 800 assets it warns, at 1000 it fails.
#
# A toolchain directory holds toolchain.json, written by its build
# (pack-toolchain.sh ensure; the format is toolchain-manifest.mjs's): its
# pack, key, commit, set variant knobs, and every other file with its size,
# sha256 and mtime. A fetch checks every file against it and records the
# local mtimes, by which a later run tells an untouched copy without hashing
# it. A store toolchain names the 40-hex commit it was built at.
#
# Environment: LIGHT_PACKS_REPO (default: the origin's GitHub repository, else
# tothambrus11/yukibana-cloud), LIGHT_PACKS_TAG (light-packs), KEEP (8),
# LIGHT_TOOLCHAINS_TAG (light-toolchains), TOOLCHAIN_CACHE
# (~/.cache/yukibana-toolchains), and LIGHT_PACKS_API
# (https://api.github.com), which test-pack-store.mjs points at a server of
# its own.
set -euo pipefail
shopt -s inherit_errexit

LIGHT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKS="$LIGHT/app/static/packs"
TREES="$LIGHT/.pack-trees"
TAG="${LIGHT_PACKS_TAG:-light-packs}"
TOOLCHAINS_TAG="${LIGHT_TOOLCHAINS_TAG:-light-toolchains}"
TOOLCHAIN_CACHE="${TOOLCHAIN_CACHE:-$HOME/.cache/yukibana-toolchains}"
API="${LIGHT_PACKS_API:-https://api.github.com}"
KEEP="${KEEP:-8}"
# GitHub refuses an asset of 2 GiB or more; this leaves room to be sure.
MAX_ASSET_BYTES=1900000000
# GitHub's cap on assets per release, and where publishing starts warning.
MAX_ASSETS=1000
WARN_ASSETS=800

# shellcheck source=toolchain-key.sh
source "$LIGHT/scripts/toolchain-key.sh"
# shellcheck source=pack-lib.sh
source "$LIGHT/scripts/pack-lib.sh"

die() { echo "pack-store.sh: $*" >&2; exit 1; }

# A download or archive being made, and a toolchain being extracted, removed
# however the script ends.
tmp=""
part=""
trap '[ -z "$tmp" ] || rm -rf "$tmp"; [ -z "$part" ] || remove_tree "$part"' EXIT

repo() {
  if [ -n "${LIGHT_PACKS_REPO:-}" ]; then echo "$LIGHT_PACKS_REPO"; return; fi
  local url
  url="$(git -C "$LIGHT" remote get-url origin 2>/dev/null || true)"
  case "$url" in
    *github.com[:/]*) url="${url#*github.com[:/]}"; echo "${url%.git}" ;;
    *) echo tothambrus11/yukibana-cloud ;;
  esac
}

tree() {
  [ -d "$LIGHT/packs/$1" ] || die "no pack $1 (packs/$1)"
  git -C "$LIGHT" rev-parse "HEAD:light/packs/$1" 2>/dev/null ||
    git -C "$LIGHT" rev-parse "HEAD:packs/$1"
}

# The assets of release $1 (default: the pack store's) as lines
# "<name> <sha256 or -> <created_at> <url>", or nothing when the release does
# not exist. The API is asked without credentials unless GH_TOKEN is set (60
# requests an hour per address).
assets() {
  local auth=()
  [ -n "${GH_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GH_TOKEN")
  curl -sSL "${auth[@]}" -H 'Accept: application/vnd.github+json' \
    "$API/repos/$(repo)/releases/tags/${1:-$TAG}" |
    node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        const r = JSON.parse(s);
        if (!Array.isArray(r.assets)) { if (r.status === "404" || r.message === "Not Found") return; throw new Error(r.message ?? s); }
        for (const a of r.assets) console.log(a.name, (a.digest ?? "-").replace(/^sha256:/, ""), a.created_at, a.browser_download_url);
      });'
}

# Exits 2 when pack $1 is split: its output is assembled over a toolchain
# from the toolchain store and never kept in this one, where a glue edit
# would change its tree and rebuild the whole toolchain.
not_split() {
  if [ -f "$LIGHT/packs/$1/toolchain.paths" ]; then
    echo "pack-store.sh: $1: split pack: fetch its toolchain and assemble (pack-toolchain.sh)" >&2
    exit 2
  fi
}

has() {
  local want
  not_split "$1"
  want="$1-$(tree "$1").tar.zst"
  if assets | awk -v w="$want" '$1 == w { found = 1 } END { exit !found }'; then
    echo "pack-store.sh: $1: $want is in $(repo)'s $TAG release" >&2
  else
    echo "pack-store.sh: $1: no $want in $(repo)'s $TAG release" >&2
    exit 3
  fi
}

fetch() {
  local pack="$1" any="${2:-}" want name sha url
  not_split "$pack"
  want="$pack-$(tree "$pack").tar.zst"
  local list
  list="$(assets)"
  read -r name sha _ url < <(awk -v w="$want" '$1 == w' <<<"$list") || true
  if [ -z "${name:-}" ] && [ "$any" = --any ]; then
    # The newest asset of the pack: ISO 8601 times sort as text.
    read -r name sha _ url < <(awk -v p="$pack-" 'index($1, p) == 1 && $1 ~ /^[a-z]+-[0-9a-f]{40}\.tar\.zst$/' <<<"$list" | sort -k3 | tail -n 1) || true
    [ -n "${name:-}" ] && echo "pack-store.sh: $pack: no build of these sources yet, taking the newest, $name" >&2
  fi
  if [ -z "${name:-}" ]; then echo "pack-store.sh: $pack: no $want in $(repo)'s $TAG release" >&2; exit 3; fi
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/pack-store.XXXXXX")"
  echo "pack-store.sh: $pack: downloading $name" >&2
  curl -sSfL --retry 3 -o "$tmp/$name" "$url"
  if [ "$sha" != - ]; then
    echo "$sha  $tmp/$name" | sha256sum -c --quiet - || die "$name: sha256 mismatch"
  fi
  mkdir -p "$tmp/out" "$PACKS" "$TREES"
  tar --zstd -xf "$tmp/$name" -C "$tmp/out"
  [ -f "$tmp/out/$pack/server.js" ] || die "$name holds no $pack/server.js"
  rm -rf "${PACKS:?}/${pack:?}"
  mv "$tmp/out/$pack" "$PACKS/$pack"
  name="${name#"$pack-"}"
  echo "${name%.tar.zst}" > "$TREES/$pack"
}

publish() {
  local pack="$1" name r
  not_split "$pack"
  [ -f "$PACKS/$pack/server.js" ] || die "app/static/packs/$pack is not built (no server.js)"
  name="$pack-$(tree "$pack").tar.zst"
  r="$(repo)"
  if ! gh release view "$TAG" --repo "$r" >/dev/null 2>&1; then
    # Several pack jobs may get here at once: one creates, the rest find it.
    gh release create "$TAG" --repo "$r" --prerelease --latest=false --title "Yukibana Light packs (build store)" \
      --notes "Built language packs of Yukibana Light, one asset per pack and version of its sources: <pack>-<git tree id of light/packs/<pack>>.tar.zst. Written by .github/workflows/light-packs.yml and read by light/scripts/pack-store.sh (light/setup.sh); not a release of the app." \
      >/dev/null 2>&1 || gh release view "$TAG" --repo "$r" >/dev/null
  fi
  if gh release view "$TAG" --repo "$r" --json assets --jq '.assets[].name' | grep -xF "$name" >/dev/null; then
    echo "pack-store.sh: $name is in the store already"
  else
    tmp="$(mktemp -d "${TMPDIR:-/tmp}/pack-store.XXXXXX")"
    tar --zstd -cf "$tmp/$name" -C "$PACKS" "$pack"
    ls -l "$tmp/$name"
    # Another run may have stored the same build meanwhile: that is a success.
    gh release upload "$TAG" "$tmp/$name" --repo "$r" ||
      gh release view "$TAG" --repo "$r" --json assets --jq '.assets[].name' | grep -xF "$name" >/dev/null
  fi
  # All but the pack's KEEP newest go. A release of the app (light-v*)
  # holds its own copy of every pack, so nothing it needs is lost.
  gh release view "$TAG" --repo "$r" --json assets \
    --jq ".assets[] | select(.name | test(\"^$pack-[0-9a-f]{40}\\\\.tar\\\\.zst\$\")) | [.createdAt, .name] | @tsv" |
    sort -r | tail -n "+$((KEEP + 1))" | cut -f2 |
    while read -r old; do
      echo "pack-store.sh: deleting $old"
      gh release delete-asset "$TAG" "$old" --repo "$r" --yes
    done
}

# ---- Toolchains of split packs ------------------------------------------

# Exits 2 unless pack $1 exists, has a plain name and is split.
split_pack() {
  [[ "$1" =~ ^[a-z][a-z0-9]*$ ]] || die "'$1' is not a pack name"
  [ -d "$LIGHT/packs/$1" ] || die "no pack $1 (packs/$1)"
  if [ ! -f "$LIGHT/packs/$1/toolchain.paths" ]; then
    echo "pack-store.sh: $1 has no toolchain (packs/$1/toolchain.paths): its tree is its key" >&2
    exit 2
  fi
}

toolchain_key_report() {
  local pack="$1" base="$2" out key old_key="" f differ=""
  local -a specs=()
  split_pack "$pack"
  if ! git -C "$TOOLCHAIN_ROOT" cat-file -e "$base^{commit}" 2>/dev/null; then
    echo "pack-store.sh: base commit $base is not in this clone; fetch it first" >&2
    exit 6
  fi
  out="$(toolchain_specs "$pack")"
  mapfile -t specs <<<"$out"
  key="$(toolchain_key "$pack")"
  echo "toolchain of $pack against $base:"
  out="$(git -C "$TOOLCHAIN_ROOT" diff --name-status "$base" -- "${specs[@]}")"
  # git diff leaves out untracked files, which are inputs all the same (the
  # key counts them): each is named as added, or the report would say
  # `unchanged` of a key that changed.
  local untracked path
  untracked="$(git -C "$TOOLCHAIN_ROOT" ls-files -o --exclude-standard -- "${specs[@]}")"
  if [ -n "$untracked" ]; then
    while IFS= read -r path; do out+="${out:+$'\n'}A"$'\t'"$path"; done <<<"$untracked"
  fi
  [ -z "$out" ] || printf '%s\n' "$out"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/pack-store.XXXXXX")"
  local dir="light/packs/$pack"
  # The settings then and now: base's toolchain.env read with this
  # environment, so only a changed declaration shows.
  git -C "$TOOLCHAIN_ROOT" show "$base:$dir/toolchain.env" >"$tmp/old.env" 2>/dev/null || : >"$tmp/old.env"
  local old_env new_env
  old_env="$(toolchain_env_lines "$pack" "$tmp/old.env")"
  new_env="$(toolchain_env_lines "$pack")"
  echo "old env: ${old_env:-(none)}" | sed '2,$s/^/         /'
  echo "new env: ${new_env:-(none)}" | sed '2,$s/^/         /'
  # toolchain.paths is no input of itself and toolchain.env reaches the key
  # only through the environment, so a change to either is shown as the key
  # base would have had, computed from base's own files.
  # Each is named like the inputs above, so the report says what changed.
  local was now
  for f in toolchain.paths toolchain.env; do
    was="$(git -C "$TOOLCHAIN_ROOT" show "$base:$dir/$f" 2>/dev/null || echo "<absent>")"
    now="$(cat "$TOOLCHAIN_ROOT/$dir/$f" 2>/dev/null || echo "<absent>")"
    [ "$was" != "$now" ] || continue
    differ=1
    case "$was/$now" in
      "<absent>/"*) printf 'A\t%s\n' "$dir/$f" ;;
      *"/<absent>") printf 'D\t%s\n' "$dir/$f" ;;
      *) printf 'M\t%s\n' "$dir/$f" ;;
    esac
  done
  if [ -n "$differ" ]; then
    old_key="$(old_toolchain_key "$pack" "$base" "$tmp/old")"
    echo "old key: $old_key"
    echo "new key: $key"
  else
    echo "key: $key"
  fi
  rm -rf "$tmp"
  tmp=""
  if [ -n "$out" ] || [ "$old_env" != "$new_env" ] || { [ -n "$differ" ] && [ "$old_key" != "$key" ]; }; then
    echo changed
  else
    echo unchanged
  fi
}

# Prints the key pack $1's toolchain had at commit $2, or "none (why)": its
# files, the key's definition and the build environment, and what else
# base's toolchain.paths names, archived from $2 into the scratch directory
# $3, which is made a repository so the key is computed exactly as for a
# checkout, by base's own toolchain-key.sh. A base from before the key's
# definition had a file of its own has no key this can compute (its build
# environment was another file, so every key differs anyway): "none".
old_toolchain_key() {
  local pack="$1" base="$2" scratch="$3" dir="light/packs/$1" line f
  local def=light/scripts/toolchain-key.sh env=light/scripts/toolchain-build-env.sh
  git -C "$TOOLCHAIN_ROOT" cat-file -e "$base:$dir/toolchain.paths" 2>/dev/null ||
    { echo "none (no $dir/toolchain.paths at $base)"; return 0; }
  for f in "$def" "$env"; do
    git -C "$TOOLCHAIN_ROOT" cat-file -e "$base:$f" 2>/dev/null ||
      { echo "none (no $f at $base)"; return 0; }
  done
  mkdir -p "$scratch"
  git -C "$TOOLCHAIN_ROOT" archive "$base" -- "$dir" "$def" "$env" | tar -x -C "$scratch"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    case "$line" in '' | '#'* | "$dir" | "$dir/"*) continue ;; esac
    toolchain_spec_excludes "$line" && continue
    # A pathspec that matched nothing at base fails base's own check below.
    git -C "$TOOLCHAIN_ROOT" archive "$base" -- "$line" 2>/dev/null | tar -x -C "$scratch" 2>/dev/null || true
  done <"$scratch/$dir/toolchain.paths"
  git -C "$scratch" init -q
  git -C "$scratch" add -A -f
  # Base's toolchain-key.sh sets TOOLCHAIN_ROOT to the scratch copy, and
  # defines the key as base did, in this subshell only (shellcheck's SC2031
  # elsewhere is about this, and wanted).
  (
    # shellcheck source=toolchain-key.sh
    source "$scratch/$def"
    toolchain_key "$pack"
  ) || echo "unknown (base's toolchain inputs do not resolve)"
}

# Prints the inputs of pack $1's toolchain with uncommitted changes
# (untracked ones included), one per line.
# shellcheck disable=SC2031 # TOOLCHAIN_ROOT is the checkout's here
toolchain_dirty_paths() {
  local out
  local -a specs=()
  out="$(toolchain_specs "$1")"
  mapfile -t specs <<<"$out"
  out="$(git -C "$TOOLCHAIN_ROOT" status --porcelain --untracked-files=all -- "${specs[@]}")"
  [ -z "$out" ] || printf '%s\n' "$out" | cut -c4-
}

toolchain_dirty() {
  local out
  split_pack "$1"
  out="$(toolchain_dirty_paths "$1")"
  if [ -n "$out" ]; then
    printf '%s\n' "$out"
  else
    exit 1
  fi
}

toolchain_has() {
  local pack="$1" want
  split_pack "$pack"
  want="toolchain-$pack-$(toolchain_key "$pack").tar.zst"
  if assets "$TOOLCHAINS_TAG" | awk -v w="$want" '$1 == w { found = 1 } END { exit !found }'; then
    echo "pack-store.sh: $pack: $want is in $(repo)'s $TOOLCHAINS_TAG release" >&2
  else
    echo "pack-store.sh: $pack: no $want in $(repo)'s $TOOLCHAINS_TAG release" >&2
    exit 3
  fi
}

toolchain_fetch() {
  local pack="$1" any="" dir="" key list want name sha url
  shift
  split_pack "$pack"
  if [ "${1:-}" = --any ]; then any=1; shift; fi
  dir="${1:-}"
  list="$(assets "$TOOLCHAINS_TAG")"
  if [ -n "$any" ]; then
    # The newest toolchain of the pack: ISO 8601 times sort as text.
    read -r name sha _ url < <(awk -v p="toolchain-$pack-" 'index($1, p) == 1 && substr($1, length(p) + 1) ~ /^[0-9a-f]{40}\.tar\.zst$/' <<<"$list" | sort -k3 | tail -n 1) || true
    if [ -z "${name:-}" ]; then echo "pack-store.sh: $pack: no toolchain-$pack-* in $(repo)'s $TOOLCHAINS_TAG release" >&2; exit 3; fi
    key="${name#"toolchain-$pack-"}"
    key="${key%.tar.zst}"
    echo "pack-store.sh: $pack: taking the newest toolchain, $key (not necessarily of these inputs)" >&2
  else
    key="$(toolchain_key "$pack")"
    want="toolchain-$pack-$key.tar.zst"
    read -r name sha _ url < <(awk -v w="$want" '$1 == w' <<<"$list") || true
    if [ -z "${name:-}" ]; then echo "pack-store.sh: $pack: no $want in $(repo)'s $TOOLCHAINS_TAG release" >&2; exit 3; fi
  fi
  dir="${dir:-$TOOLCHAIN_CACHE/built/$pack/$key}"
  [ "$sha" != - ] || die "$name: GitHub records no sha256 for it; refusing an unchecked toolchain"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/pack-store.XXXXXX")"
  echo "pack-store.sh: $pack: downloading $name" >&2
  curl -sSfL --retry 3 -o "$tmp/$name" "$url"
  echo "$sha  $tmp/$name" | sha256sum -c --quiet - || die "$name: sha256 mismatch"
  mkdir -p "$(dirname "$dir")"
  part="$dir.part"
  remove_tree "$part"
  mkdir "$part"
  tar --zstd -xf "$tmp/$name" -C "$part"
  rm -rf "$tmp"
  tmp=""
  [ -f "$part/toolchain.json" ] || die "$name holds no toolchain.json"
  chmod u+w "$part/toolchain.json"
  # The manifest is checked file by file (size and sha256: the archive's own
  # sha256 says only that it is the asset, not that the asset is honest),
  # then each file's local mtime recorded for the cheap reuse check.
  node "$LIGHT/scripts/toolchain-manifest.mjs" adopt "$part" "$pack" "$key" || die "$name: refused"
  find "$part" -type f -exec chmod a-w {} +
  remove_tree "$dir"
  mv "$part" "$dir"
  part=""
  echo "$dir"
}

# shellcheck disable=SC2031 # TOOLCHAIN_ROOT is the checkout's here
toolchain_publish() {
  local pack="$1" dir="$2" dirty key head manifest mpack mkey mcommit name r list n size
  split_pack "$pack"
  [ -f "$dir/toolchain.json" ] || die "$dir holds no toolchain.json"
  dirty="$(toolchain_dirty_paths "$pack")"
  if [ -n "$dirty" ]; then
    die "$pack: not publishing a toolchain built from uncommitted inputs:
$dirty"
  fi
  key="$(toolchain_key "$pack")"
  head="$(git -C "$TOOLCHAIN_ROOT" rev-parse HEAD)"
  manifest="$(node -e '
    const m = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    console.log([m.pack, m.key, m.commit].map((v) => (typeof v === "string" && /^[0-9a-z]+$/.test(v) ? v : "-")).join(" "));
  ' "$dir/toolchain.json")"
  read -r mpack mkey mcommit <<<"$manifest"
  [ "$mpack" = "$pack" ] || die "$dir is a toolchain of $mpack, not $pack"
  [ "$mkey" = "$key" ] || die "$pack: $dir was built from the inputs $mkey, but HEAD's inputs and settings give $key"
  [ "$mcommit" = "$head" ] || die "$pack: $dir was built at $mcommit, not at HEAD ($head)"
  # And it is still exactly what its manifest lists, file by file.
  node "$LIGHT/scripts/toolchain-manifest.mjs" check "$dir" "$pack" "$key" >/dev/null ||
    die "$pack: $dir is not the toolchain its toolchain.json lists"
  name="toolchain-$pack-$key.tar.zst"
  r="$(repo)"
  if ! gh release view "$TOOLCHAINS_TAG" --repo "$r" >/dev/null 2>&1; then
    # Several pack jobs may get here at once: one creates, the rest find it.
    gh release create "$TOOLCHAINS_TAG" --repo "$r" --prerelease --latest=false --title "Yukibana Light toolchains (build store)" \
      --notes "Toolchains of Yukibana Light's split packs, one asset per pack and key of its inputs: toolchain-<pack>-<key>.tar.zst (light/scripts/pack-store.sh toolchain-key). Written by .github/workflows/light-packs.yml and read by light/scripts/pack-store.sh; not a release of the app. Nothing is deleted automatically." \
      >/dev/null 2>&1 || gh release view "$TOOLCHAINS_TAG" --repo "$r" >/dev/null
  fi
  list="$(assets "$TOOLCHAINS_TAG")"
  if awk -v w="$name" '$1 == w { found = 1 } END { exit !found }' <<<"$list"; then
    echo "pack-store.sh: $name is in the store already"
    return 0
  fi
  n="$(grep -c . <<<"$list" || true)"
  local oldest
  # awk reads to the end: exiting early would kill sort with SIGPIPE once the
  # list outgrows a pipe's buffer, and pipefail would make that a failure.
  oldest="$(sort -k3 <<<"$list" | awk 'NF && !seen { print $1; seen = 1 }')"
  if [ "$n" -ge "$MAX_ASSETS" ]; then
    die "$r's $TOOLCHAINS_TAG release holds $n assets, GitHub's cap of $MAX_ASSETS; nothing is evicted automatically: remove toolchains no branch needs with gh release delete-asset $TOOLCHAINS_TAG <asset> (the oldest is ${oldest:-?})"
  fi
  if [ "$n" -ge "$WARN_ASSETS" ]; then
    echo "pack-store.sh: warning: $r's $TOOLCHAINS_TAG release holds $n of at most $MAX_ASSETS assets; evict toolchains no branch needs with gh release delete-asset $TOOLCHAINS_TAG <asset> (the oldest is $oldest)" >&2
    [ -z "${GITHUB_ACTIONS:-}" ] || echo "::warning::$TOOLCHAINS_TAG holds $n of at most $MAX_ASSETS assets; evict with gh release delete-asset $TOOLCHAINS_TAG <asset>"
  fi
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/pack-store.XXXXXX")"
  tar --zstd -cf "$tmp/$name" -C "$dir" .
  size="$(stat -c %s "$tmp/$name")"
  [ "$size" -le "$MAX_ASSET_BYTES" ] || die "$name is $size bytes, more than the $MAX_ASSET_BYTES a release asset may safely be"
  ls -l "$tmp/$name"
  # Another run may have stored the same toolchain meanwhile: that is a success.
  gh release upload "$TOOLCHAINS_TAG" "$tmp/$name" --repo "$r" ||
    assets "$TOOLCHAINS_TAG" | awk -v w="$name" '$1 == w { found = 1 } END { exit !found }'
}

case "${1:-}" in
  tree) tree "${2:?pack}" ;;
  has) has "${2:?pack}" ;;
  fetch) fetch "${2:?pack}" "${3:-}" ;;
  publish) publish "${2:?pack}" ;;
  toolchain-key) split_pack "${2:?pack}"; toolchain_key "$2" ;;
  toolchain-key-report) toolchain_key_report "${2:?pack}" "${3:?base commit}" ;;
  toolchain-dirty) toolchain_dirty "${2:?pack}" ;;
  toolchain-has) toolchain_has "${2:?pack}" ;;
  toolchain-fetch) toolchain_fetch "${2:?pack}" "${@:3}" ;;
  toolchain-publish) toolchain_publish "${2:?pack}" "${3:?toolchain directory}" ;;
  *) sed -n '3,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 2 ;;
esac
