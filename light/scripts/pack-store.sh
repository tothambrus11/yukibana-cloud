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
# Every read of a release's assets pages through its whole asset list
# (assets), never the first page GitHub embeds in the release itself.
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
#       now, both keys when toolchain.paths, toolchain.env or the key's
#       definition (toolchain-key.sh) changed, and a last line `changed` or
#       `unchanged`. Exit 6 when <base> is not in
#       this clone.
#   pack-store.sh toolchain-dirty <pack>  exit 0 naming the inputs with
#       uncommitted changes, and the pack's toolchain.env when it has any
#       (no input, but it decides what reaches the build), 1 when there are
#       none.
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

# Prints GitHub's answer to GET $API/repos/<repo>/$1, whatever its status
# (an error is a JSON object naming it, which the reader then refuses). The
# API is asked without credentials unless GH_TOKEN is set (60 requests an
# hour per address).
api_get() {
  local auth=()
  [ -z "${GH_TOKEN:-}" ] || auth=(-H "Authorization: Bearer $GH_TOKEN")
  curl -sSL "${auth[@]}" -H 'Accept: application/vnd.github+json' "$API/repos/$(repo)/$1"
}

# Assets per page asked of GitHub: its maximum. A page holding fewer is the
# last.
ASSETS_PER_PAGE=100

# The assets of release $1 (default: the pack store's) as lines
# "<name> <sha256 or -> <created_at> <url>", every one of them, or nothing
# when the release does not exist; returns 1 naming the request when GitHub
# answers anything else. The release is looked up by tag only for its id,
# and its assets are then read page by page from /releases/<id>/assets:
# the list a release embeds is not documented to be complete, and one
# shortened silently would make a stored toolchain look missing, so CI would
# rebuild a compiler and a release would refuse a pack it could have had.
# Each step returns explicitly, as callers may run this where `set -e` is
# off; a caller keeps the list in a variable (asset_listed), never pipes it.
assets() {
  local tag="${1:-$TAG}" out id page=1 n
  out="$(api_get "releases/tags/$tag")" || return 1
  id="$(node -e '
    const [where, s] = process.argv.slice(1);
    let r;
    try { r = JSON.parse(s); } catch { console.error("pack-store.sh: " + where + ": not JSON: " + s.slice(0, 200)); process.exit(1); }
    if (Number.isSafeInteger(r?.id)) console.log(r.id);
    else if (r?.status !== "404" && r?.message !== "Not Found") { console.error("pack-store.sh: " + where + ": " + (r?.message ?? s.slice(0, 200))); process.exit(1); }
  ' "release $tag of $(repo)" "$out")" || return 1
  [ -n "$id" ] || return 0
  while :; do
    out="$(api_get "releases/$id/assets?per_page=$ASSETS_PER_PAGE&page=$page")" || return 1
    out="$(node -e '
      const [where, s] = process.argv.slice(1);
      let r;
      try { r = JSON.parse(s); } catch { console.error("pack-store.sh: " + where + ": not JSON: " + s.slice(0, 200)); process.exit(1); }
      if (!Array.isArray(r)) { console.error("pack-store.sh: " + where + ": " + (r?.message ?? s.slice(0, 200))); process.exit(1); }
      for (const a of r) console.log(a.name, (a.digest ?? "-").replace(/^sha256:/, ""), a.created_at, a.browser_download_url);
    ' "page $page of the assets of release $tag of $(repo)" "$out")" || return 1
    [ -n "$out" ] || return 0
    printf '%s\n' "$out"
    n="$(grep -c . <<<"$out")"
    [ "$n" -ge "$ASSETS_PER_PAGE" ] || return 0
    page=$((page + 1))
    # GitHub holds at most 1000 assets a release: 11 pages. A server that
    # ignored `page` would otherwise be read forever.
    if [ "$page" -gt 50 ]; then
      echo "pack-store.sh: release $tag of $(repo) lists more than 50 pages of assets; the API is not paging" >&2
      return 1
    fi
  done
}

# The lines of asset list $2 whose asset is a build of prefix $1 (`<pack>-`
# or `toolchain-<pack>-`) followed by 40 hex digits and .tar.zst, so that
# pack `c` never takes pack `cpp`'s assets.
builds_of() {
  awk -v p="$1" 'index($1, p) == 1 && substr($1, length(p) + 1) ~ /^[0-9a-f]{40}\.tar\.zst$/' <<<"$2"
}

# The line of asset list $2 of the newest build of prefix $1 (builds_of),
# or nothing. ISO 8601 times sort as text.
newest_build() {
  builds_of "$1" "$2" | sort -k3 | tail -n 1
}

# The line of asset list $2 of the asset named exactly $1, or nothing.
asset_line() {
  awk -v w="$1" '$1 == w' <<<"$2"
}

# Creates release $1 of repository $2 as a prerelease titled $3 with notes
# $4, unless it exists. Several pack jobs may get here at once: one creates
# it, the rest find it, and only a release still missing after that fails.
release_ensure() {
  local tag="$1" r="$2"
  gh release view "$tag" --repo "$r" >/dev/null 2>&1 && return 0
  gh release create "$tag" --repo "$r" --prerelease --latest=false --title "$3" --notes "$4" >/dev/null 2>&1 ||
    gh release view "$tag" --repo "$r" >/dev/null ||
    die "cannot create or find release $tag of $r"
}

# Uploads file $1 to release $2 of repository $3. Another run may have
# stored the same asset meanwhile, so a failed upload is a success when the
# release holds an asset of that name afterwards, and a failure naming the
# asset otherwise.
release_upload() {
  local file="$1" tag="$2" r="$3" list
  gh release upload "$tag" "$file" --repo "$r" && return 0
  list="$(assets "$tag")" || die "uploading ${file##*/} to $tag failed, and its assets cannot be listed to see whether another run stored it"
  asset_listed "${file##*/}" "$list" || die "uploading ${file##*/} to $tag failed"
  echo "pack-store.sh: ${file##*/} was stored by another run meanwhile"
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
  local want list
  not_split "$1"
  want="$1-$(tree "$1").tar.zst"
  list="$(assets)"
  if asset_listed "$want" "$list"; then
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
  read -r name sha _ url < <(asset_line "$want" "$list") || true
  if [ -z "${name:-}" ] && [ "$any" = --any ]; then
    read -r name sha _ url < <(newest_build "$pack-" "$list") || true
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
  local pack="$1" name r list old
  not_split "$pack"
  [ -f "$PACKS/$pack/server.js" ] || die "app/static/packs/$pack is not built (no server.js)"
  name="$pack-$(tree "$pack").tar.zst"
  r="$(repo)"
  release_ensure "$TAG" "$r" "Yukibana Light packs (build store)" \
    "Built language packs of Yukibana Light, one asset per pack and version of its sources: <pack>-<git tree id of light/packs/<pack>>.tar.zst. Written by .github/workflows/light-packs.yml and read by light/scripts/pack-store.sh (light/setup.sh); not a release of the app."
  list="$(assets)"
  if asset_listed "$name" "$list"; then
    echo "pack-store.sh: $name is in the store already"
  else
    tmp="$(mktemp -d "${TMPDIR:-/tmp}/pack-store.XXXXXX")"
    tar --zstd -cf "$tmp/$name" -C "$PACKS" "$pack"
    ls -l "$tmp/$name"
    release_upload "$tmp/$name" "$TAG" "$r"
  fi
  # All but the pack's KEEP newest go, newest by creation time (ISO 8601,
  # which sorts as text). A release of the app (light-v*) holds its own copy
  # of every pack, so nothing it needs is lost.
  list="$(assets)"
  old="$(builds_of "$pack-" "$list" | sort -r -k3 | tail -n "+$((KEEP + 1))" | cut -d' ' -f1)"
  [ -n "$old" ] || return 0
  while IFS= read -r name; do
    echo "pack-store.sh: deleting $name"
    gh release delete-asset "$TAG" "$name" --repo "$r" --yes
  done <<<"$old"
}

# ---- Toolchains of split packs ------------------------------------------

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
  # toolchain.paths is no input of itself, and toolchain.env is no input
  # either (toolchain_specs leaves it out): it reaches the key only as the
  # env lines above. So neither appears in the diff of the inputs, and a
  # change to either is named here, once, with the key base would have had,
  # computed from base's own files. So is a change to
  # toolchain-key.sh, the key's definition, which is no input of any key
  # either: a bumped format tag or another rule for the key's lines changes
  # every toolchain's key while no input differs, and a report that said
  # `unchanged` then would hide a rebuild of every compiler. A comment there
  # shows both keys, equal, and stays `unchanged`.
  # Each is named like the inputs above, so the report says what changed.
  local was now why
  for f in "$dir/toolchain.paths" "$dir/toolchain.env" light/scripts/toolchain-key.sh; do
    was="$(git -C "$TOOLCHAIN_ROOT" show "$base:$f" 2>/dev/null || echo "<absent>")"
    now="$(cat "$TOOLCHAIN_ROOT/$f" 2>/dev/null || echo "<absent>")"
    [ "$was" != "$now" ] || continue
    differ=1
    why=""
    [ "$f" != light/scripts/toolchain-key.sh ] || why=" (the key's definition)"
    case "$was/$now" in
      "<absent>/"*) printf 'A\t%s%s\n' "$f" "$why" ;;
      *"/<absent>") printf 'D\t%s%s\n' "$f" "$why" ;;
      *) printf 'M\t%s%s\n' "$f" "$why" ;;
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
# (untracked ones included), one per line, then the pack's toolchain.env when
# it has uncommitted changes.
#
# toolchain.env is no key input (toolchain_specs leaves it out, so a comment
# rebuilds nothing), but it still decides what reaches toolchain.sh: which
# knobs pass at all, and which of them are variant and so keyed. An
# uncommitted edit that declares a new source knob, or turns a set variant
# knob into a source one, builds with a variable HEAD's toolchain.env would
# not pass, under HEAD's key. Counting the edit as dirty is what keeps that
# build from being recorded as HEAD's commit, reused for a clean worktree or
# published. It is checked on its own, because toolchain_specs excludes it
# and a pathspec exclusion applies to every pathspec of the same call. A
# comment-only edit is dirty too until it is committed; the key, and so the
# toolchain fetched or reused once it is, stays the same.
# shellcheck disable=SC2031 # TOOLCHAIN_ROOT is the checkout's here
toolchain_dirty_paths() {
  local out
  local -a specs=()
  out="$(toolchain_specs "$1")"
  mapfile -t specs <<<"$out"
  out="$(git -C "$TOOLCHAIN_ROOT" status --porcelain --untracked-files=all -- "${specs[@]}")"
  [ -z "$out" ] || printf '%s\n' "$out" | cut -c4-
  out="$(git -C "$TOOLCHAIN_ROOT" status --porcelain --untracked-files=all -- "light/packs/$1/toolchain.env")"
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
  local pack="$1" want list
  split_pack "$pack"
  want="toolchain-$pack-$(toolchain_key "$pack").tar.zst"
  list="$(assets "$TOOLCHAINS_TAG")"
  if asset_listed "$want" "$list"; then
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
    read -r name sha _ url < <(newest_build "toolchain-$pack-" "$list") || true
    if [ -z "${name:-}" ]; then echo "pack-store.sh: $pack: no toolchain-$pack-* in $(repo)'s $TOOLCHAINS_TAG release" >&2; exit 3; fi
    key="${name#"toolchain-$pack-"}"
    key="${key%.tar.zst}"
    echo "pack-store.sh: $pack: taking the newest toolchain, $key (not necessarily of these inputs)" >&2
  else
    key="$(toolchain_key "$pack")"
    want="toolchain-$pack-$key.tar.zst"
    read -r name sha _ url < <(asset_line "$want" "$list") || true
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
  local pack="$1" dir="$2" dirty key head res mcommit name r list n size
  split_pack "$pack"
  [ -f "$dir/toolchain.json" ] || die "$dir holds no toolchain.json"
  dirty="$(toolchain_dirty_paths "$pack")"
  if [ -n "$dirty" ]; then
    die "$pack: not publishing a toolchain built from uncommitted inputs:
$dirty"
  fi
  key="$(toolchain_key "$pack")"
  head="$(git -C "$TOOLCHAIN_ROOT" rev-parse HEAD)"
  # The manifest's one reader checks its pack and key (HEAD's inputs and
  # this environment's settings), names the first difference, checks every
  # file is still as listed, and prints "<key> <commit>": only the commit is
  # left to compare.
  res="$(node "$LIGHT/scripts/toolchain-manifest.mjs" check "$dir" "$pack" "$key")" ||
    die "$pack: $dir is not, file for file, a toolchain of HEAD's inputs and settings ($key)"
  read -r _ mcommit <<<"$res"
  [ "$mcommit" = "$head" ] || die "$pack: $dir was built at $mcommit, not at HEAD ($head)"
  name="toolchain-$pack-$key.tar.zst"
  r="$(repo)"
  release_ensure "$TOOLCHAINS_TAG" "$r" "Yukibana Light toolchains (build store)" \
    "Toolchains of Yukibana Light's split packs, one asset per pack and key of its inputs: toolchain-<pack>-<key>.tar.zst (light/scripts/pack-store.sh toolchain-key). Written by .github/workflows/light-packs.yml and read by light/scripts/pack-store.sh; not a release of the app. Nothing is deleted automatically."
  list="$(assets "$TOOLCHAINS_TAG")"
  if asset_listed "$name" "$list"; then
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
  release_upload "$tmp/$name" "$TOOLCHAINS_TAG" "$r"
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
