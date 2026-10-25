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
# A split pack (one with packs/<pack>/toolchains/) is never in this store:
# `has`, `fetch` and `publish` exit 2 for one. Its toolchain is one or more
# units (packs/<pack>/toolchains/<unit>/, named <pack>/<unit>), each kept in
# the toolchain store under a key of its own inputs, and the pack assembled
# over all of them (pack-toolchain.sh), so a glue edit rebuilds nothing and
# a library pin rebuilds only the unit that holds it:
#
#   pack-store.sh toolchain-units <pack>  the pack's units, <pack>/<unit> one
#       per line, each after the units of the pack it needs. Exit 2: not
#       split.
#   pack-store.sh toolchain-key <unit>    the unit's key, 40 hex digits: the
#       sha256 of its inputs in the worktree, the build environment
#       (toolchain-build-env.sh) among them, the keys of the units it needs,
#       and its set variant knobs, as toolchain-key.sh defines and
#       documents. So changing toolchain-build-env.sh rebuilds every
#       toolchain; changing toolchain-key.sh, this script, pack-lib.sh or
#       pack-toolchain.sh (assembly) rebuilds none. Exit 2: no such unit.
#   pack-store.sh toolchain-key-report <unit> <base>    what changed the key
#       since commit <base>: the inputs that differ, the unit's own paths,
#       env and needs files and the key's definition when they changed, each
#       needed unit whose key changed, the env lines then and now, both keys,
#       and a last line `changed` or `unchanged`. Exit 6 when <base> is not
#       in this clone.
#   pack-store.sh toolchain-plan [--missing] [--waves <n>]    every unit of
#       every split pack as lines "<wave> <unit> <key> <needs>", <needs> the
#       units it needs joined by commas (or -), its wave 1 for a unit that
#       needs none and one more than the deepest unit it needs otherwise, in
#       the order to build them. --missing leaves out the units the store
#       has. --waves fails, naming the unit, when one would be in a wave
#       after the n-th: light-packs.yml has that many wave jobs.
#   pack-store.sh toolchain-dirty <unit>  exit 0 naming the files with
#       uncommitted changes that would make a build of the unit here dirty:
#       its inputs, its paths, env and needs files (no inputs, but they
#       decide what reaches the build), and the same for every unit it
#       needs, as a build over a dirty one is dirty too; 1 when there are
#       none.
#   pack-store.sh toolchain-has <unit>    exit 0 when the toolchain store has
#       the asset toolchain-<pack>-<unit>-<key>.tar.zst, 3 when it has none.
#   pack-store.sh toolchain-fetch <unit> [--any] [dir]   downloads it into
#       dir (default $TOOLCHAIN_CACHE/built/<pack>/<unit>/<key>), read-only,
#       and prints dir; exit 3 when there is none. --any takes the unit's
#       newest toolchain whatever its key, saying which. Its provenance is
#       verified first (Provenance, below).
#   pack-store.sh toolchain-unpack <unit> <archive> [dir]    the same from a
#       local archive named as a store asset (an artifact of the same CI
#       run: pack-toolchain.sh ensure --from); its name must carry this
#       unit and its key.
#   pack-store.sh toolchain-archive <unit> <dir> <out-dir>    writes dir as
#       <out-dir>/toolchain-<pack>-<unit>-<key>.tar.zst and prints its path,
#       refusing exactly what toolchain-publish refuses; for the artifact a
#       unit's CI job hands its dependents.
#   pack-store.sh toolchain-publish <unit> <archive>    uploads the archive
#       toolchain-archive wrote, byte for byte, as the toolchain of HEAD's
#       inputs: refused unless its name is HEAD's key, its toolchain.json and
#       files say it was built clean at HEAD, and an attestation says
#       light-toolchain-unit.yml built it on refs/heads/main. The bytes
#       stored are the bytes attested, so every consumer can verify them.
#       Never deletes: from 800 assets it warns, at 1000 it fails.
#   pack-store.sh toolchain-artifact <unit> <out-dir> --ref <ref> [--branch <b>]
#       a pull request's own earlier build of the unit: the newest unexpired
#       Actions artifact named toolchain-<pack>-<unit>-<key> (HEAD's key)
#       whose archive an attestation says light-toolchain-unit.yml built on
#       <ref> (refs/pull/<n>/merge), put in out-dir as the archive
#       toolchain-unpack and `ensure --from` take, and its path printed.
#       <b> narrows the candidates to runs of that head branch before any is
#       downloaded; only the attestation decides. Exit 3 when none is
#       acceptable. Needs GH_TOKEN with actions: read.
#   pack-store.sh ensure-stores           creates the light-packs and
#       light-toolchains prereleases unless they exist (protect-releases.sh,
#       before release immutability is turned on).
#
# Provenance. A toolchain is trusted for where it was built, never for which
# release holds it: a same-repository pull request runs its own copy of the
# workflows, so whatever it may write to, it can write anything. What it
# cannot forge is the ref in the OIDC token its run signs with. So every
# toolchain fetched from the store is checked with
#   gh attestation verify <archive> --repo <repo> --signer-workflow
#     <repo>/.github/workflows/light-toolchain-unit.yml
#     --source-ref refs/heads/main --deny-self-hosted-runners
# before it is unpacked. The signer is light-toolchain-unit.yml, not
# light-packs.yml, because a reusable workflow signs as itself; light-packs.yml
# is its only caller (test-workflows.mjs). LIGHT_TOOLCHAIN_PROVENANCE says how
# strict: `required` (every CI job) fails by name without gh or without such
# an attestation; unset, the check runs when gh is signed in and a refusal
# fails, and when gh is missing or signed out the toolchain is used and that
# is said (setup.sh on a machine with no gh). Nothing here skips a check
# silently.
#
# A toolchain directory holds toolchain.json, written by its build
# (pack-toolchain.sh ensure; the format is toolchain-manifest.mjs's): its
# unit, key, commit, the keys of the units it was built with, its set
# variant knobs, and every other file with its size, sha256 and mtime. A
# fetch checks every file against it and records the local mtimes, by which
# a later run tells an untouched copy without hashing it. A store toolchain
# names the 40-hex commit it was built at.
#
# Environment: LIGHT_PACKS_REPO (default: the origin's GitHub repository, else
# tothambrus11/yukibana-cloud), LIGHT_PACKS_TAG (light-packs), KEEP (8),
# LIGHT_TOOLCHAINS_TAG (light-toolchains), TOOLCHAIN_CACHE
# (~/.cache/yukibana-toolchains), LIGHT_TOOLCHAIN_PROVENANCE (above),
# and LIGHT_PACKS_API
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
# The one workflow that builds toolchains, which their attestations must name
# as the signer (Provenance, above). A path in the repository.
SIGNER_WORKFLOW=.github/workflows/light-toolchain-unit.yml
# The ref a stored toolchain must have been built on.
MAIN_REF=refs/heads/main
# What each store release says it is, when it is created.
PACKS_TITLE="Yukibana Light packs (build store)"
PACKS_NOTES="Built language packs of Yukibana Light, one asset per pack and version of its sources: <pack>-<git tree id of light/packs/<pack>>.tar.zst. Written by .github/workflows/light-packs.yml and read by light/scripts/pack-store.sh (light/setup.sh); not a release of the app."
TOOLCHAINS_TITLE="Yukibana Light toolchains (build store)"
TOOLCHAINS_NOTES="Toolchain units of Yukibana Light's split packs, one asset per unit and key of its inputs: toolchain-<pack>-<unit>-<key>.tar.zst (light/scripts/pack-store.sh toolchain-key <pack>/<unit>). Written by .github/workflows/light-packs.yml on main only, each asset attested by .github/workflows/light-toolchain-unit.yml, and read by light/scripts/pack-store.sh, which verifies that attestation; not a release of the app. Nothing is deleted automatically."

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

# Returns 0 when an attestation says $SIGNER_WORKFLOW of this repository
# built file $1 on ref $2 on a GitHub-hosted runner, and 1 otherwise, with
# gh's own words on stderr. Needs gh.
attested() {
  local file="$1" ref="$2" r out
  r="$(repo)"
  if out="$(gh attestation verify "$file" --repo "$r" --signer-workflow "$r/$SIGNER_WORKFLOW" \
    --source-ref "$ref" --deny-self-hosted-runners 2>&1)"; then
    return 0
  fi
  printf '%s\n' "$out" | sed 's/^/  gh: /' >&2
  return 1
}

# Exits 1 naming $3 (what is checked) unless file $1 was built by
# $SIGNER_WORKFLOW on ref $2, as LIGHT_TOOLCHAIN_PROVENANCE asks (Provenance,
# above): `required` needs gh and the attestation; unset, gh signed out or
# missing means the file is used unverified, and said to be.
verify_provenance() {
  local file="$1" ref="$2" what="$3" mode="${LIGHT_TOOLCHAIN_PROVENANCE:-}"
  case "$mode" in
    required)
      command -v gh >/dev/null ||
        die "$what: gh is needed to verify its provenance (LIGHT_TOOLCHAIN_PROVENANCE=required), and there is none" ;;
    '')
      if ! command -v gh >/dev/null || ! gh auth status >/dev/null 2>&1; then
        echo "pack-store.sh: $what: its provenance is NOT verified: gh is missing or not signed in here (gh auth login, and it is checked; CI always checks)" >&2
        return 0
      fi ;;
    *) die "LIGHT_TOOLCHAIN_PROVENANCE is '$mode'; it is 'required' or unset" ;;
  esac
  attested "$file" "$ref" ||
    die "$what: refused: no attestation says $SIGNER_WORKFLOW of $(repo) built it on $ref"
  echo "pack-store.sh: $what: built by $SIGNER_WORKFLOW on $ref, as its attestation says" >&2
}

# Exits 2 when pack $1 is split: its output is assembled over toolchain
# units from the toolchain store and never kept in this one, where a glue
# edit would change its tree and rebuild every unit.
not_split() {
  if [ -d "$LIGHT/packs/$1/toolchains" ]; then
    echo "pack-store.sh: $1: split pack: fetch its toolchain units and assemble (pack-toolchain.sh)" >&2
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
  release_ensure "$TAG" "$r" "$PACKS_TITLE" "$PACKS_NOTES"
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

# ---- Toolchain units of split packs --------------------------------------

# The store asset of unit $1 (<pack>/<unit>) and key $2.
asset_of() {
  echo "toolchain-${1%%/*}-${1#*/}-$2.tar.zst"
}

# The local directory of unit $1's toolchain of key $2.
cache_dir_of() {
  echo "$TOOLCHAIN_CACHE/built/$1/$2"
}

toolchain_units_cmd() {
  split_pack "$1"
  toolchain_units "$1"
}

toolchain_key_report() {
  local id="$1" base="$2" key old_key f dir why
  split_unit "$id"
  if ! git -C "$TOOLCHAIN_ROOT" cat-file -e "$base^{commit}" 2>/dev/null; then
    echo "pack-store.sh: base commit $base is not in this clone; fetch it first" >&2
    exit 6
  fi
  key="$(toolchain_key "$id")"
  echo "toolchain $id against $base:"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/pack-store.XXXXXX")"
  # The key base had, from base's own files and definition, and the lines
  # it hashed, next to the lines hashed now. What differs between the two is
  # what changed the key, and nothing else is: an input whose content or
  # mode changed (M), a file that became an input, untracked ones included
  # (A), or stopped being one (D), and a needed unit whose key changed. A
  # file newly named by the paths file is an input change even when its
  # content is as it was.
  old_key="$(old_toolchain_key "$id" "$base" "$tmp/old" "$tmp/old.lines")"
  toolchain_lines "$id" >"$tmp/new.lines"
  awk '
    function path(line) { sub(/^[^ ]+ [^ ]+ /, "", line); return line }
    $1 ~ /^(100644|100755|120000)$/ {
      p = path($0)
      if (FILENAME == ARGV[1]) { old[p] = $1 " " $2; next }
      if (!(p in old)) print "A\t" p
      else if (old[p] != $1 " " $2) print "M\t" p
      seen[p] = 1
    }
    END { for (p in old) if (!(p in seen)) print "D\t" p }
  ' "$tmp/old.lines" "$tmp/new.lines" | LC_ALL=C sort -t $'\t' -k2
  dir="light/packs/${id%%/*}/toolchains/${id#*/}"
  # The unit's paths, env and needs files are no inputs of the key, and
  # neither is toolchain-key.sh, the key's definition: each reaches the key
  # only through what it decides (which files are inputs, the env lines,
  # the needs lines, every line). So none appears above, and a change to any
  # is named here, once. A bumped format tag changes every key while no
  # input differs; a report that said `unchanged` then would hide a rebuild
  # of every compiler. A comment in any of them shows both keys, equal, and
  # stays `unchanged`.
  local was now
  for f in "$dir/paths" "$dir/env" "$dir/needs" light/scripts/toolchain-key.sh; do
    was="$(git -C "$TOOLCHAIN_ROOT" show "$base:$f" 2>/dev/null || echo "<absent>")"
    now="$(cat "$TOOLCHAIN_ROOT/$f" 2>/dev/null || echo "<absent>")"
    [ "$was" != "$now" ] || continue
    why=""
    [ "$f" != light/scripts/toolchain-key.sh ] || why=" (the key's definition)"
    case "$was/$now" in
      "<absent>/"*) printf 'A\t%s%s\n' "$f" "$why" ;;
      *"/<absent>") printf 'D\t%s%s\n' "$f" "$why" ;;
      *) printf 'M\t%s%s\n' "$f" "$why" ;;
    esac
  done
  # A needed unit whose key changed is named by its needs line, as the cause
  # of a key that changed with no file of this unit touched.
  local dep k1 k2
  while IFS= read -r dep; do
    k1="$(awk -v d="$dep" '$1 == "needs" && $2 == d { print $3 }' "$tmp/old.lines")"
    k2="$(awk -v d="$dep" '$1 == "needs" && $2 == d { print $3 }' "$tmp/new.lines")"
    if [ -z "$k1" ]; then
      printf 'A\tneeds %s\n' "$dep"
    elif [ -z "$k2" ]; then
      printf 'D\tneeds %s\n' "$dep"
    elif [ "$k1" != "$k2" ]; then
      printf 'M\tneeds %s (its key changed)\n' "$dep"
    fi
  done < <(awk '$1 == "needs" { print $2 }' "$tmp/old.lines" "$tmp/new.lines" | LC_ALL=C sort -u)
  # The settings then and now: base's env file read with this environment,
  # so only a changed declaration shows.
  git -C "$TOOLCHAIN_ROOT" show "$base:$dir/env" >"$tmp/old.env" 2>/dev/null || : >"$tmp/old.env"
  local old_env new_env
  old_env="$(toolchain_env_lines "$id" "$tmp/old.env")"
  new_env="$(toolchain_env_lines "$id")"
  echo "old env: ${old_env:-(none)}" | sed '2,$s/^/         /'
  echo "new env: ${new_env:-(none)}" | sed '2,$s/^/         /'
  echo "old key: $old_key"
  echo "new key: $key"
  remove_tree "$tmp"
  tmp=""
  if [ "$old_key" != "$key" ]; then echo changed; else echo unchanged; fi
}

# Prints the key unit $1 had at commit $2, or "none (why)", and writes the
# lines it hashed to file $4 (empty with "none"). The units of every split
# pack of $2 (a unit may need one of another pack), the key's definition
# and the build environment are archived from $2 into the scratch directory
# $3, which is made a repository so the key is computed exactly as for a
# checkout, by base's own toolchain-key.sh. A base from before units has no
# key this can compute (every key's format differs anyway): "none".
old_toolchain_key() {
  local id="$1" base="$2" scratch="$3" keyed="$4" f p
  local def=light/scripts/toolchain-key.sh env=light/scripts/toolchain-build-env.sh
  local -a packs=()
  : >"$keyed"
  f="light/packs/${id%%/*}/toolchains/${id#*/}"
  git -C "$TOOLCHAIN_ROOT" cat-file -e "$base:$f" 2>/dev/null || { echo "none (no $f at $base)"; return 0; }
  for f in "$def" "$env"; do
    git -C "$TOOLCHAIN_ROOT" cat-file -e "$base:$f" 2>/dev/null || { echo "none (no $f at $base)"; return 0; }
  done
  while IFS= read -r p; do
    if git -C "$TOOLCHAIN_ROOT" cat-file -e "$base:$p/toolchains" 2>/dev/null; then packs+=("$p"); fi
  done < <(git -C "$TOOLCHAIN_ROOT" ls-tree -d --name-only "$base" light/packs/)
  mkdir -p "$scratch"
  git -C "$TOOLCHAIN_ROOT" archive "$base" -- "${packs[@]}" "$def" "$env" | tar -x -C "$scratch"
  git -C "$scratch" init -q
  git -C "$scratch" add -A -f
  # Base's toolchain-key.sh sets TOOLCHAIN_ROOT to the scratch copy, and
  # defines the key as base did, in this subshell only (shellcheck's SC2031
  # elsewhere is about this, and wanted).
  if (
    # shellcheck source=toolchain-key.sh
    source "$scratch/$def"
    toolchain_lines "$id" >"$keyed"
  ); then
    sha256sum "$keyed" | cut -c1-40
  else
    : >"$keyed"
    echo "unknown (base's toolchain inputs do not resolve)"
  fi
}

toolchain_plan() {
  local missing="" waves="" out u d k wave max list here
  local -a units=() packs=() deps=()
  local -A depth=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --missing) missing=1 ;;
      --waves) waves="${2:?--waves <n>}"; shift ;;
      *) echo "pack-store.sh: toolchain-plan: unknown option $1" >&2; exit 2 ;;
    esac
    shift
  done
  for d in "$LIGHT"/packs/*/toolchains/; do
    [ -d "$d" ] || continue
    d="${d%/toolchains/}"
    packs+=("${d##*/}")
  done
  [ "${#packs[@]}" -gt 0 ] || return 0
  for d in "${packs[@]}"; do
    out="$(toolchain_units "$d")"
    mapfile -t -O "${#units[@]}" units <<<"$out"
  done
  # Every unit once, after what it needs; the units of each pack were in
  # that order already, and a unit of another pack it needs comes first.
  out="$(toolchain_order "${units[@]}")"
  mapfile -t units <<<"$out"
  [ -z "$missing" ] || list="$(assets "$TOOLCHAINS_TAG")"
  for u in "${units[@]}"; do
    out="$(toolchain_needs "$u")"
    deps=()
    [ -z "$out" ] || mapfile -t deps <<<"$out"
    max=0
    for d in "${deps[@]}"; do
      [ "${depth[$d]}" -le "$max" ] || max="${depth[$d]}"
    done
    wave=$((max + 1))
    depth[$u]="$wave"
    if [ -n "$waves" ] && [ "$wave" -gt "$waves" ]; then
      echo "pack-store.sh: $u would build in wave $wave, after the $waves waves light-packs.yml has (it needs ${deps[*]}); add a wave job there, or flatten its needs" >&2
      exit 1
    fi
    k="$(toolchain_key "$u")"
    if [ -n "$missing" ] && asset_listed "$(asset_of "$u" "$k")" "$list"; then continue; fi
    here="${deps[*]}"
    here="${here// /,}"
    printf '%s %s %s %s\n' "$wave" "$u" "$k" "${here:--}"
  done
}

# Prints the files with uncommitted changes, untracked ones included, one
# per line, that make a build of unit $1 here dirty: for the unit and every
# unit it needs, its inputs, and its paths, env and needs files.
#
# Those three are no key inputs (a comment in them rebuilds nothing), but
# each decides what reaches toolchain.sh: which files are staged, which
# knobs pass at all and which of them are variant and so keyed, which
# dependencies are linked. An uncommitted edit that declares a new source
# knob, or turns a set variant knob into a source one, builds with a
# variable HEAD's env would not pass, under HEAD's key. Counting the edit
# as dirty is what keeps that build from being recorded as HEAD's commit,
# reused for a clean worktree or published. They are checked on their own,
# because toolchain_specs excludes them and a pathspec exclusion applies to
# every pathspec of the same call. A comment-only edit is dirty too until
# it is committed; the key, and so the toolchain fetched or reused once it
# is, stays the same. A needed unit's dirty files count, because a build
# over a dirty dependency is no build of HEAD's either.
# shellcheck disable=SC2031 # TOOLCHAIN_ROOT is the checkout's here
toolchain_dirty_paths() {
  local out u dir all=""
  local -a specs=() units=()
  out="$(toolchain_order "$1")"
  mapfile -t units <<<"$out"
  for u in "${units[@]}"; do
    out="$(toolchain_specs "$u")"
    mapfile -t specs <<<"$out"
    dir="light/packs/${u%%/*}/toolchains/${u#*/}"
    out="$(git -C "$TOOLCHAIN_ROOT" status --porcelain --untracked-files=all -- "${specs[@]}")"
    [ -z "$out" ] || all+="$(printf '%s\n' "$out" | cut -c4-)"$'\n'
    out="$(git -C "$TOOLCHAIN_ROOT" status --porcelain --untracked-files=all -- "$dir/paths" "$dir/env" "$dir/needs")"
    [ -z "$out" ] || all+="$(printf '%s\n' "$out" | cut -c4-)"$'\n'
  done
  [ -z "$all" ] || printf '%s' "$all" | LC_ALL=C sort -u
}

toolchain_dirty() {
  local out
  split_unit "$1"
  out="$(toolchain_dirty_paths "$1")"
  if [ -n "$out" ]; then
    printf '%s\n' "$out"
  else
    exit 1
  fi
}

toolchain_has() {
  local id="$1" want list
  split_unit "$id"
  want="$(toolchain_key "$id")"
  want="$(asset_of "$id" "$want")"
  list="$(assets "$TOOLCHAINS_TAG")"
  if asset_listed "$want" "$list"; then
    echo "pack-store.sh: $id: $want is in $(repo)'s $TOOLCHAINS_TAG release" >&2
  else
    echo "pack-store.sh: $id: no $want in $(repo)'s $TOOLCHAINS_TAG release" >&2
    exit 3
  fi
}

# Extracts the toolchain archive $3 of unit $1 and key $2 into directory $4,
# replacing what is there: every file is checked against its toolchain.json
# (size and sha256: an archive's own checksum says only that it is the one
# named, not that it is honest), each file's local mtime recorded for the
# cheap reuse check, and every file made read-only. Prints $4.
unpack_toolchain() {
  local id="$1" key="$2" archive="$3" dir="$4"
  mkdir -p "$(dirname "$dir")"
  part="$dir.part"
  remove_tree "$part"
  mkdir "$part"
  tar --zstd -xf "$archive" -C "$part" || die "${archive##*/}: not a toolchain archive"
  [ -f "$part/toolchain.json" ] || die "${archive##*/} holds no toolchain.json"
  chmod u+w "$part/toolchain.json"
  node "$LIGHT/scripts/toolchain-manifest.mjs" adopt "$part" "$id" "$key" || die "${archive##*/}: refused"
  find "$part" -type f -exec chmod a-w {} +
  remove_tree "$dir"
  mv "$part" "$dir"
  part=""
  echo "$dir"
}

toolchain_fetch() {
  local id="$1" any="" dir="" key list want name sha url
  shift
  split_unit "$id"
  if [ "${1:-}" = --any ]; then any=1; shift; fi
  dir="${1:-}"
  list="$(assets "$TOOLCHAINS_TAG")"
  if [ -n "$any" ]; then
    read -r name sha _ url < <(newest_build "toolchain-${id%%/*}-${id#*/}-" "$list") || true
    if [ -z "${name:-}" ]; then echo "pack-store.sh: $id: no $(asset_of "$id" '*') in $(repo)'s $TOOLCHAINS_TAG release" >&2; exit 3; fi
    key="${name#"toolchain-${id%%/*}-${id#*/}-"}"
    key="${key%.tar.zst}"
    echo "pack-store.sh: $id: taking the newest toolchain, $key (not necessarily of these inputs)" >&2
  else
    key="$(toolchain_key "$id")"
    want="$(asset_of "$id" "$key")"
    read -r name sha _ url < <(asset_line "$want" "$list") || true
    if [ -z "${name:-}" ]; then echo "pack-store.sh: $id: no $want in $(repo)'s $TOOLCHAINS_TAG release" >&2; exit 3; fi
  fi
  dir="${dir:-$(cache_dir_of "$id" "$key")}"
  [ "$sha" != - ] || die "$name: GitHub records no sha256 for it; refusing an unchecked toolchain"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/pack-store.XXXXXX")"
  echo "pack-store.sh: $id: downloading $name" >&2
  curl -sSfL --retry 3 -o "$tmp/$name" "$url"
  echo "$sha  $tmp/$name" | sha256sum -c --quiet - || die "$name: sha256 mismatch"
  verify_provenance "$tmp/$name" "$MAIN_REF" "$name"
  unpack_toolchain "$id" "$key" "$tmp/$name" "$dir"
  rm -rf "$tmp"
  tmp=""
}

toolchain_artifact() {
  local id="$1" out="${2:?output directory}" ref="" branch="" key name out_json cands line aid digest url
  shift 2
  split_unit "$id"
  while [ $# -gt 0 ]; do
    case "$1" in
      --ref) ref="${2:?--ref <ref>}"; shift ;;
      --branch) branch="${2:?--branch <branch>}"; shift ;;
      *) echo "pack-store.sh: toolchain-artifact: unknown option $1" >&2; exit 2 ;;
    esac
    shift
  done
  [ -n "$ref" ] || { echo "pack-store.sh: toolchain-artifact needs --ref <the ref its attestation must name>" >&2; exit 2; }
  [ -n "${GH_TOKEN:-}" ] || die "toolchain-artifact needs GH_TOKEN (actions: read) to list and download artifacts"
  command -v gh >/dev/null || die "toolchain-artifact needs gh to verify an artifact's provenance"
  key="$(toolchain_key "$id")"
  name="$(asset_of "$id" "$key")"
  name="${name%.tar.zst}"
  out_json="$(api_get "actions/artifacts?name=$name&per_page=100")" || die "listing the artifacts named $name failed"
  # Candidates, newest first, as "<id> <zip sha256 or -> <download url>": not
  # expired, of the head branch when one is given. At most three are
  # downloaded: a toolchain can be gigabytes, and more than three refusals
  # in a row means a rebuild is cheaper than looking further.
  cands="$(node -e '
    const [where, s, branch] = process.argv.slice(1);
    let r;
    try { r = JSON.parse(s); } catch { console.error("pack-store.sh: " + where + ": not JSON: " + s.slice(0, 200)); process.exit(1); }
    if (!Array.isArray(r?.artifacts)) { console.error("pack-store.sh: " + where + ": " + (r?.message ?? s.slice(0, 200))); process.exit(1); }
    const ok = r.artifacts
      .filter((a) => !a.expired && (branch === "" || a.workflow_run?.head_branch === branch))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
      .slice(0, 3);
    for (const a of ok) console.log(a.id, (a.digest ?? "-").replace(/^sha256:/, ""), a.archive_download_url);
  ' "the artifacts named $name of $(repo)" "$out_json" "$branch")" || die "the artifacts named $name cannot be read"
  if [ -z "$cands" ]; then
    echo "pack-store.sh: $id: no unexpired artifact $name${branch:+ of branch $branch}" >&2
    exit 3
  fi
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/pack-store.XXXXXX")"
  while read -r aid digest url; do
    rm -rf "${tmp:?}/x" "$tmp/a.zip"
    echo "pack-store.sh: $id: downloading artifact $aid ($name)" >&2
    if ! curl -sSfL --retry 3 -H "Authorization: Bearer $GH_TOKEN" -o "$tmp/a.zip" "$url"; then
      echo "pack-store.sh: $id: artifact $aid cannot be downloaded; skipping it" >&2
      continue
    fi
    if [ "$digest" != - ] && ! echo "$digest  $tmp/a.zip" | sha256sum -c --quiet - 2>/dev/null; then
      echo "pack-store.sh: $id: artifact $aid does not match its recorded sha256; skipping it" >&2
      continue
    fi
    if ! unzip -q "$tmp/a.zip" "$name.tar.zst" -d "$tmp/x" 2>/dev/null; then
      echo "pack-store.sh: $id: artifact $aid holds no $name.tar.zst; skipping it" >&2
      continue
    fi
    if ! attested "$tmp/x/$name.tar.zst" "$ref"; then
      echo "pack-store.sh: $id: artifact $aid has no attestation that $SIGNER_WORKFLOW built it on $ref; skipping it" >&2
      continue
    fi
    mkdir -p "$out"
    mv "$tmp/x/$name.tar.zst" "$out/$name.tar.zst"
    echo "pack-store.sh: $id: taking artifact $aid, built by $SIGNER_WORKFLOW on $ref" >&2
    echo "$out/$name.tar.zst"
    return 0
  done <<<"$cands"
  echo "pack-store.sh: $id: no artifact $name built on $ref; it builds" >&2
  exit 3
}

toolchain_unpack() {
  local id="$1" archive="${2:?archive}" dir="${3:-}" key name
  split_unit "$id"
  [ -f "$archive" ] || die "$archive: no such archive"
  key="$(toolchain_key "$id")"
  name="$(asset_of "$id" "$key")"
  [ "${archive##*/}" = "$name" ] || die "$archive is not $name, the toolchain of $id's inputs here"
  unpack_toolchain "$id" "$key" "$archive" "${dir:-$(cache_dir_of "$id" "$key")}"
}

# Exits 1, naming why, unless directory $2 is, file for file, the toolchain
# of unit $1 built from HEAD's committed inputs and settings: what may be
# stored or handed to another job. Prints its key.
# shellcheck disable=SC2031 # TOOLCHAIN_ROOT is the checkout's here
clean_toolchain_key() {
  local id="$1" dir="$2" dirty key head res mcommit
  [ -f "$dir/toolchain.json" ] || die "$dir holds no toolchain.json"
  dirty="$(toolchain_dirty_paths "$id")"
  if [ -n "$dirty" ]; then
    die "$id: not storing a toolchain built from uncommitted inputs:
$dirty"
  fi
  key="$(toolchain_key "$id")"
  head="$(git -C "$TOOLCHAIN_ROOT" rev-parse HEAD)"
  # The manifest's one reader checks its unit and key (HEAD's inputs and
  # this environment's settings), names the first difference, checks every
  # file is still as listed, and prints "<key> <commit>": only the commit is
  # left to compare.
  res="$(node "$LIGHT/scripts/toolchain-manifest.mjs" check "$dir" "$id" "$key")" ||
    die "$id: $dir is not, file for file, a toolchain of HEAD's inputs and settings ($key)"
  read -r _ mcommit <<<"$res"
  [ "$mcommit" = "$head" ] || die "$id: $dir was built at $mcommit, not at HEAD ($head)"
  echo "$key"
}

# Writes toolchain directory $3 of unit $1 and key $2 as the archive $4.
write_archive() {
  local size
  tar --zstd -cf "$4" -C "$3" .
  size="$(stat -c %s "$4")"
  [ "$size" -le "$MAX_ASSET_BYTES" ] || die "${4##*/} is $size bytes, more than the $MAX_ASSET_BYTES a release asset may safely be"
  ls -l "$4" >&2
}

toolchain_archive() {
  local id="$1" dir="${2:?toolchain directory}" out="${3:?output directory}" key file
  split_unit "$id"
  key="$(clean_toolchain_key "$id" "$dir")"
  mkdir -p "$out"
  file="$out/$(asset_of "$id" "$key")"
  write_archive "$id" "$key" "$dir" "$file"
  echo "$file"
}

toolchain_publish() {
  local id="$1" archive="$2" key name r list n
  split_unit "$id"
  [ -f "$archive" ] || die "$archive: no such archive"
  key="$(toolchain_key "$id")"
  name="$(asset_of "$id" "$key")"
  [ "${archive##*/}" = "$name" ] || die "$archive is not $name, the toolchain of $id's inputs at HEAD"
  # What it holds is checked as a fetch would check it, then as a toolchain
  # built clean at HEAD (clean_toolchain_key); the archive itself is what is
  # uploaded, so the bytes stored are the bytes its attestation names.
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/pack-store.XXXXXX")"
  unpack_toolchain "$id" "$key" "$archive" "$tmp/toolchain" >/dev/null
  clean_toolchain_key "$id" "$tmp/toolchain" >/dev/null
  remove_tree "$tmp"
  tmp=""
  LIGHT_TOOLCHAIN_PROVENANCE=required verify_provenance "$archive" "$MAIN_REF" "$name"
  r="$(repo)"
  release_ensure "$TOOLCHAINS_TAG" "$r" "$TOOLCHAINS_TITLE" "$TOOLCHAINS_NOTES"
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
  release_upload "$archive" "$TOOLCHAINS_TAG" "$r"
}

ensure_stores() {
  local r
  r="$(repo)"
  release_ensure "$TAG" "$r" "$PACKS_TITLE" "$PACKS_NOTES"
  release_ensure "$TOOLCHAINS_TAG" "$r" "$TOOLCHAINS_TITLE" "$TOOLCHAINS_NOTES"
  echo "pack-store.sh: $r has the releases $TAG and $TOOLCHAINS_TAG"
}

case "${1:-}" in
  tree) tree "${2:?pack}" ;;
  has) has "${2:?pack}" ;;
  fetch) fetch "${2:?pack}" "${3:-}" ;;
  publish) publish "${2:?pack}" ;;
  toolchain-units) toolchain_units_cmd "${2:?pack}" ;;
  toolchain-key) split_unit "${2:?unit}"; toolchain_key "$2" ;;
  toolchain-key-report) toolchain_key_report "${2:?unit}" "${3:?base commit}" ;;
  toolchain-plan) toolchain_plan "${@:2}" ;;
  toolchain-dirty) toolchain_dirty "${2:?unit}" ;;
  toolchain-has) toolchain_has "${2:?unit}" ;;
  toolchain-fetch) toolchain_fetch "${2:?unit}" "${@:3}" ;;
  toolchain-unpack) toolchain_unpack "${2:?unit}" "${3:?archive}" "${4:-}" ;;
  toolchain-archive) toolchain_archive "${2:?unit}" "${3:?toolchain directory}" "${4:?output directory}" ;;
  toolchain-publish) toolchain_publish "${2:?unit}" "${3:?toolchain archive}" ;;
  toolchain-artifact) toolchain_artifact "${2:?unit}" "${3:?output directory}" "${@:4}" ;;
  ensure-stores) ensure_stores ;;
  *) sed -n '3,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 2 ;;
esac
