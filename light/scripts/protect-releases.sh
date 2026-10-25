#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Makes Light's releases immutable, once, as a repository admin: a published
# light-v* release (Light) or light-modules-v* release (the modules'
# tarballs, light-modules.yml) can then change neither its assets nor its
# tag, and no such tag can be moved or deleted. Run it by hand with gh signed in as
# an admin of the repository; running it again changes nothing.
#
#   light/scripts/protect-releases.sh
#
# What it does, in this order:
#   1. creates the two stores, light-packs and light-toolchains, unless they
#      exist (pack-store.sh ensure-stores). They are rolling prereleases that
#      gain an asset per build, and release immutability, a setting of the
#      whole repository, locks what is published while it is on. Created
#      first, they are published before it is.
#   2. creates or updates the tag ruleset "light-v releases": on
#      refs/tags/light-v* and refs/tags/light-modules-v*, no update (a tag
#      cannot move) and no deletion. (A host pins a modules release by its
#      URL, so a moved tag would change what an install from it gets.)
#      Creating a tag stays allowed: that is how a release starts.
#   3. turns release immutability on.
#   4. checks that neither store says it is immutable. If one does, the
#      stores could take no new build, so immutability is turned off again
#      and the script fails naming the release: it is a decision for a
#      person (move the stores to another repository, or keep releases
#      mutable), not something to work around here.
#
# light-release.yml publishes a release as a draft with every asset first,
# so immutability takes the release whole. The stores are not trusted for
# being immutable anyway: every toolchain is verified when it is fetched
# (pack-store.sh, Provenance).
#
# Environment: LIGHT_PACKS_REPO (default: the origin's GitHub repository),
# and what gh reads.
set -euo pipefail
shopt -s inherit_errexit

LIGHT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORE="$LIGHT/scripts/pack-store.sh"
RULESET="light-v releases"

die() { echo "protect-releases.sh: $*" >&2; exit 1; }

repo() {
  if [ -n "${LIGHT_PACKS_REPO:-}" ]; then echo "$LIGHT_PACKS_REPO"; return; fi
  local url
  url="$(git -C "$LIGHT" remote get-url origin 2>/dev/null || true)"
  case "$url" in
    *github.com[:/]*) url="${url#*github.com[:/]}"; echo "${url%.git}" ;;
    *) die "no GitHub origin; set LIGHT_PACKS_REPO=<owner>/<repo>" ;;
  esac
}

r="$(repo)"
command -v gh >/dev/null || die "needs gh, signed in as an admin of $r"

# 1.
"$STORE" ensure-stores

# 2. The ruleset's body, the same whether it is created or updated.
body="$(node -e '
  console.log(JSON.stringify({
    name: process.argv[1],
    target: "tag",
    enforcement: "active",
    conditions: { ref_name: { include: ["refs/tags/light-v*", "refs/tags/light-modules-v*"], exclude: [] } },
    rules: [{ type: "update" }, { type: "deletion" }],
  }));
' "$RULESET")"
existing="$(gh api "repos/$r/rulesets?includes_parents=false" --paginate --jq ".[] | select(.name == \"$RULESET\") | .id")" ||
  die "cannot list $r's rulesets (is gh signed in as an admin?)"
if [ -n "$existing" ]; then
  gh api --method PUT "repos/$r/rulesets/$existing" --input - >/dev/null <<<"$body" || die "cannot update ruleset $existing ($RULESET)"
  echo "protect-releases.sh: updated the tag ruleset \"$RULESET\" ($existing)"
else
  gh api --method POST "repos/$r/rulesets" --input - >/dev/null <<<"$body" || die "cannot create the tag ruleset \"$RULESET\""
  echo "protect-releases.sh: created the tag ruleset \"$RULESET\""
fi

# 3.
gh api --method PUT "repos/$r/immutable-releases" >/dev/null || die "cannot turn on release immutability for $r"
echo "protect-releases.sh: release immutability is on for $r"

# 4.
for tag in light-packs light-toolchains; do
  immutable="$(gh api "repos/$r/releases/tags/$tag" --jq '.immutable')" || die "cannot read release $tag of $r"
  if [ "$immutable" = true ]; then
    gh api --method DELETE "repos/$r/immutable-releases" >/dev/null ||
      die "release $tag is immutable, so the store can take no new build, and turning immutability off again failed: turn it off in the repository's settings"
    die "release $tag is immutable, so the store could take no new build; release immutability is off again. Decide whether the stores move elsewhere or releases stay mutable"
  fi
done
echo "protect-releases.sh: light-packs and light-toolchains still take new builds"
