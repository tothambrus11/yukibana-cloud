#!/usr/bin/env bash
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
# Environment: LIGHT_PACKS_REPO (default: the origin's GitHub repository, else
# tothambrus11/yukibana-cloud), LIGHT_PACKS_TAG (light-packs), KEEP (8), and
# LIGHT_PACKS_API (https://api.github.com), which test-pack-store.mjs points
# at a server of its own.
set -euo pipefail

LIGHT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKS="$LIGHT/app/static/packs"
TREES="$LIGHT/.pack-trees"
TAG="${LIGHT_PACKS_TAG:-light-packs}"
API="${LIGHT_PACKS_API:-https://api.github.com}"
KEEP="${KEEP:-8}"

die() { echo "pack-store.sh: $*" >&2; exit 1; }

# A download or archive being made, removed however the script ends.
tmp=""
trap '[ -z "$tmp" ] || rm -rf "$tmp"' EXIT

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

# The release's assets as lines "<name> <sha256 or -> <created_at> <url>",
# or nothing when the release does not exist. The API is asked without
# credentials unless GH_TOKEN is set (60 requests an hour per address).
assets() {
  local auth=()
  [ -n "${GH_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GH_TOKEN")
  curl -sSL "${auth[@]}" -H 'Accept: application/vnd.github+json' \
    "$API/repos/$(repo)/releases/tags/$TAG" |
    node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        const r = JSON.parse(s);
        if (!Array.isArray(r.assets)) { if (r.status === "404" || r.message === "Not Found") return; throw new Error(r.message ?? s); }
        for (const a of r.assets) console.log(a.name, (a.digest ?? "-").replace(/^sha256:/, ""), a.created_at, a.browser_download_url);
      });'
}

fetch() {
  local pack="$1" any="${2:-}" want name sha url
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
  [ -f "$PACKS/$pack/server.js" ] || die "app/static/packs/$pack is not built (no server.js)"
  name="$pack-$(tree "$pack").tar.zst"
  r="$(repo)"
  if ! gh release view "$TAG" --repo "$r" >/dev/null 2>&1; then
    # Several pack jobs may get here at once: one creates, the rest find it.
    gh release create "$TAG" --repo "$r" --prerelease --latest=false --title "Yukibana Light packs (build store)" \
      --notes "Built language packs of Yukibana Light, one asset per pack and version of its sources: <pack>-<git tree id of light/packs/<pack>>.tar.zst. Written by .github/workflows/light-packs.yml and read by light/scripts/pack-store.sh (light/setup.sh); not a release of the app." \
      >/dev/null 2>&1 || gh release view "$TAG" --repo "$r" >/dev/null
  fi
  if gh release view "$TAG" --repo "$r" --json assets --jq '.assets[].name' | grep -qxF "$name"; then
    echo "pack-store.sh: $name is in the store already"
  else
    tmp="$(mktemp -d "${TMPDIR:-/tmp}/pack-store.XXXXXX")"
    tar --zstd -cf "$tmp/$name" -C "$PACKS" "$pack"
    ls -l "$tmp/$name"
    # Another run may have stored the same build meanwhile: that is a success.
    gh release upload "$TAG" "$tmp/$name" --repo "$r" ||
      gh release view "$TAG" --repo "$r" --json assets --jq '.assets[].name' | grep -qxF "$name"
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

case "${1:-}" in
  tree) tree "${2:?pack}" ;;
  fetch) fetch "${2:?pack}" "${3:-}" ;;
  publish) publish "${2:?pack}" ;;
  *) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 2 ;;
esac
