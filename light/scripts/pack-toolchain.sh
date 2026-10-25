#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Decides whether a split pack's toolchain must be built, builds it
# hermetically when it must, and assembles the pack from it: the one script
# between a split pack's sources and app/static/packs/<pack>.
#
#   pack-toolchain.sh ensure <pack> [--fetch-only] [--no-fetch] [--rebuild]
#                                   [--build-dirty] [--any]
#       Prints the directory of a toolchain of HEAD's inputs (and this
#       environment's variant knobs) on stdout, reusing the local copy,
#       fetching it from the toolchain store, or building it, in that order:
#         reuse    $TOOLCHAIN_CACHE/built/<pack>/<key> when its toolchain.json
#                  still lists every file at its size and mtime (not with
#                  --rebuild); one that does not is removed, naming the file.
#                  A toolchain built dirty is not reused once the build
#                  would be clean: committing exactly the inputs it was
#                  built from keeps the key, and reusing it then would leave
#                  a toolchain that is never published or recorded as
#                  HEAD's in place of one that can be. It is removed, and
#                  the clean one fetched or built.
#         fetch    from the store, unless the build would be dirty or
#                  --no-fetch is given. --any then fetches the pack's newest
#                  toolchain whatever its key, saying it is not this commit's
#                  (setup.sh --latest).
#         build    exit 3 instead with --fetch-only; exit 4 instead when the
#                  build would be dirty and --build-dirty is not given.
#                  Otherwise toolchain.sh runs in a stage holding only the
#                  toolchain's inputs, under `env -i` with only
#                  toolchain_env_args, its outputs are checked against
#                  toolchain.outputs, and its files made read-only.
#       Afterwards all but the pack's 2 most recently used toolchains are
#       removed from the local cache.
#   pack-toolchain.sh assemble <pack> <dir> [out]
#       Assembles the pack from toolchain <dir> into [out] (default
#       app/static/packs/<pack>): links the toolchain's files (copies them
#       where links are impossible), runs the pack's glue.sh over them, checks
#       the glue left every toolchain file as it was, writes the sidecar, and
#       swaps the result in. Refuses a toolchain that lacks an output
#       packs/<pack>/toolchain.outputs declares, every time: the file is no
#       input of the key, so an output declared after a toolchain of the
#       same key was built or stored is checked here or nowhere. Refuses a
#       toolchain of other inputs unless ALLOW_OTHER_TOOLCHAIN=1 (set by
#       setup.sh --latest) and that toolchain has every output HEAD's
#       toolchain.outputs declares and passes the glue's versions check.
#   pack-toolchain.sh record-state <pack>
#       Prints "<tree of packs/<pack>> <blob of pack-toolchain.sh> <blob of
#       toolchain-manifest.mjs> <key>", the state setup.sh records for a pack
#       assembled at HEAD: the pack, assembly as the glossary defines it, and
#       the toolchain (whose key already covers the build environment). Or
#       exits 5 naming why the assembled pack is not
#       HEAD's: an uncommitted change to the pack or to assembly, a dirty
#       build, or another commit's toolchain.
#
# Exit codes: 1 something failed (named), 2 not a split pack or bad usage,
# 3 --fetch-only would build, 4 dirty inputs not built without being asked,
# 5 record-state refuses.
#
# Glossary.
#   split pack     a pack with packs/<pack>/toolchain.paths. Its output is
#                  the toolchain plus the glue, never kept whole in a store.
#   toolchain      what packs/<pack>/toolchain.sh builds from the files
#                  toolchain_specs names (toolchain-key.sh): compilers,
#                  sysroots, runtimes. Hours of work, changed rarely.
#   build env      toolchain-build-env.sh: what reaches toolchain.sh besides
#                  its inputs (the variables let through, the JVM's proxy
#                  flags, the stage). One of every toolchain's inputs, so
#                  changing it rebuilds them all.
#   key            the hash of exactly those inputs and the set variant
#                  knobs (pack-store.sh toolchain-key, defined by
#                  toolchain-key.sh, which is no input itself: a change of
#                  what it computes bumps the key's format tag). One key, one
#                  toolchain.
#   knob           a variable toolchain.env declares, the only one besides the
#                  fixed and transport variables that reaches toolchain.sh.
#                  A `variant` knob changes the output: setting it changes the
#                  key and makes the build dirty. A `source` knob does not.
#   dirty          built from uncommitted inputs, with an uncommitted
#                  toolchain.env (no input, but it decides which knobs pass
#                  and which are keyed), or with a set variant knob.
#                  A dirty toolchain is recorded with commit "dirty", used
#                  locally, and never fetched, published or recorded as
#                  HEAD's.
#   toolchain dir  $TOOLCHAIN_CACHE/built/<pack>/<key>: the toolchain's files,
#                  read-only, and toolchain.json, its manifest
#                  (toolchain-manifest.mjs: pack, key, commit, knobs, and
#                  every file's size, sha256 and mtime).
#   glue           packs/<pack>/glue.sh and what it reads: the pack's own
#                  JavaScript and assets. Run at assembly with OUT (the pack
#                  being assembled, the toolchain's files already in it) and
#                  TOOLCHAIN_DIR; it adds its files, prints each one's path
#                  relative to OUT on its own line, and never changes a file
#                  of the toolchain. Run as `glue.sh --check-versions` with
#                  only TOOLCHAIN_DIR, it checks that the toolchain's
#                  versions.json has every version the glue reads, and exits
#                  non-zero naming what is missing.
#   assembly       this script and toolchain-manifest.mjs: part of no key, so
#                  changing them rebuilds nothing; nor does changing the
#                  helpers they share with pack-store.sh (pack-lib.sh).
#   sidecar        app/node_modules/.cache/yukibana/toolchain-<pack>.json,
#                  written by assemble: the toolchain's files with their
#                  sha256 and their mtimes in the assembled pack, so a later
#                  check (PM1) can tell the toolchain part of a served pack
#                  is intact without hashing it. Never served.
#
# The pin rule. Every version and download pin of a toolchain lives in
# packs/<pack>/pins.sh, as lines matching ^[A-Z][A-Z0-9_]*=[^$`(]*$ (plain
# assignments a reader can trust without running them; toolchain.sh sources
# it). The toolchain writes the versions it was built with into its own
# versions.json, and the glue reads versions only from there, never from
# pins.sh or build.sh, so a glue assembled over another commit's toolchain
# describes the toolchain it got. CI never parses build.sh.
#
# Removal. A toolchain's files are read-only, and the files of an assembled
# pack are hard links to them: the same inodes. So a tree is only ever
# removed by remove_tree (pack-lib.sh), which makes its directories
# writable and never chmods a file: a chmod on a linked file would make the
# toolchain in the cache writable too.
#
# Environment: TOOLCHAIN_CACHE (~/.cache/yukibana-toolchains), passed on to
# pack-store.sh; ALLOW_OTHER_TOOLCHAIN; and whatever toolchain_env_args
# passes to a build. pack-store.sh's own (LIGHT_PACKS_REPO, LIGHT_PACKS_API,
# LIGHT_TOOLCHAINS_TAG, GH_TOKEN) reach it unchanged.
set -euo pipefail
shopt -s inherit_errexit

LIGHT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORE="$LIGHT/scripts/pack-store.sh"
MANIFEST="$LIGHT/scripts/toolchain-manifest.mjs"
TOOLCHAIN_CACHE="${TOOLCHAIN_CACHE:-$HOME/.cache/yukibana-toolchains}"
export TOOLCHAIN_CACHE
SIDECARS="$LIGHT/app/node_modules/.cache/yukibana"
# How many toolchains of a pack the local cache keeps, the one in use
# included: the current one and the one before, to switch branches cheaply.
KEEP_LOCAL=2

# shellcheck source=toolchain-key.sh
source "$LIGHT/scripts/toolchain-key.sh"
# shellcheck source=pack-lib.sh
source "$LIGHT/scripts/pack-lib.sh"

say() { echo "pack-toolchain.sh: $*" >&2; }
die() { say "$*"; exit 1; }

# A stage and a half-built toolchain or pack, removed however the script ends.
stage=""
part=""
trap '[ -z "$stage" ] || remove_tree "$stage"; [ -z "$part" ] || remove_tree "$part"' EXIT

key_of() { "$STORE" toolchain-key "$1"; }

# Prints why a build of pack $1's toolchain here would be dirty, one reason
# per line: each uncommitted input and an uncommitted toolchain.env
# (pack-store.sh toolchain-dirty), then each set variant knob as
# "NAME=value (a variant knob)". Nothing means clean.
dirty_reasons() {
  local pack="$1" out rc=0 name kind
  out="$("$STORE" toolchain-dirty "$pack")" || rc=$?
  case "$rc" in
    0) printf '%s\n' "$out" ;;
    1) ;;
    *) die "$pack: cannot tell whether its toolchain inputs are dirty" ;;
  esac
  out="$(toolchain_knobs "$pack")"
  [ -n "$out" ] || return 0
  while read -r name kind; do
    if [ "$kind" != variant ] || [ -z "${!name+x}" ]; then continue; fi
    printf '%s=%s (a variant knob)\n' "$name" "${!name}"
  done <<<"$out"
}

# Prints {"NAME": "value", ...} of pack $1's set variant knobs.
variant_knobs_json() {
  local out name kind
  local -a names=()
  out="$(toolchain_knobs "$1")"
  if [ -n "$out" ]; then
    while read -r name kind; do
      [ "$kind" = variant ] && [ -n "${!name+x}" ] && names+=("$name")
    done <<<"$out"
  fi
  # Exported for the one node process that reads them, not for any build.
  # shellcheck disable=SC2163 # each name is the variable to export
  for name in "${names[@]}"; do export "$name"; done
  node -e 'const o = {}; for (const n of process.argv.slice(1)) o[n] = process.env[n]; console.log(JSON.stringify(o));' -- "${names[@]}"
}

# Checks that every line of toolchain.outputs text $1 (a path or glob, with
# ** for any depth; blank and # lines ignored) matches a non-empty file in
# directory $2. Names every line that does not, then returns 1; returns 1
# too when no output is declared at all, as nothing would then be checked.
check_outputs() {
  local text="$1" dir="$2" line n=0 missing="" f ok
  local -a matches=()
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    case "$line" in '' | '#'*) continue ;; esac
    n=$((n + 1))
    ok=""
    # The glob is the line's own: no word splitting, ** recursing, dot files
    # matched, nothing left unexpanded.
    mapfile -d '' -t matches < <(
      shopt -s nullglob globstar dotglob
      IFS=''
      # shellcheck disable=SC2206 # the line is a glob, expanded on purpose
      m=("$dir"/$line)
      [ "${#m[@]}" -eq 0 ] || printf '%s\0' "${m[@]}"
    )
    for f in "${matches[@]}"; do
      if [ -f "$f" ] && [ -s "$f" ]; then ok=1; break; fi
    done
    [ -n "$ok" ] || missing+="  $line"$'\n'
  done <<<"$text"
  if [ "$n" -eq 0 ]; then
    say "toolchain.outputs declares no output"
    return 1
  fi
  if [ -n "$missing" ]; then
    say "these declared outputs match no non-empty file in $dir:"$'\n'"${missing%$'\n'}"
    return 1
  fi
}

# Removes all but the KEEP_LOCAL most recently used toolchains of pack $1
# from the local cache, never $2 (the one just used). Use is the directory's
# own mtime, which every ensure touches; its files' mtimes are the
# manifest's and never change.
prune() {
  local pack="$1" keep="$2" n=1 line dir
  [ -d "$TOOLCHAIN_CACHE/built/$pack" ] || return 0
  while IFS= read -r line; do
    dir="${line#* }"
    [ "$dir" != "$keep" ] || continue
    if [ "$n" -lt "$KEEP_LOCAL" ]; then n=$((n + 1)); continue; fi
    say "$pack: removing the old toolchain $dir from the local cache"
    remove_tree "$dir"
  done < <(find "$TOOLCHAIN_CACHE/built/$pack" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex '.*/[0-9a-f]{40}' -printf '%T@ %p\n' | sort -rn)
}

# Marks toolchain $2 of pack $1 as just used, prunes the others, prints it.
use() {
  touch "$2"
  prune "$1" "$2"
  echo "$2"
}

ensure() {
  local pack="${1:?pack}" fetch_only="" no_fetch="" rebuild="" build_dirty="" any=""
  shift
  split_pack "$pack"
  while [ $# -gt 0 ]; do
    case "$1" in
      --fetch-only) fetch_only=1 ;;
      --no-fetch) no_fetch=1 ;;
      --rebuild) rebuild=1 ;;
      --build-dirty) build_dirty=1 ;;
      --any) any=1 ;;
      *) say "ensure: unknown option $1"; exit 2 ;;
    esac
    shift
  done
  local key dir reasons res mcommit out rc
  key="$(key_of "$pack")"
  dir="$TOOLCHAIN_CACHE/built/$pack/$key"
  reasons="$(dirty_reasons "$pack")"

  if [ -z "$rebuild" ] && [ -d "$dir" ]; then
    # On success check prints only "<key> <commit>"; on failure only its
    # one line naming why.
    if res="$(node "$MANIFEST" check "$dir" "$pack" "$key" 2>&1)"; then
      read -r _ mcommit <<<"$res"
      if [ "$mcommit" != dirty ] || [ -n "$reasons" ]; then
        say "$pack: reusing toolchain $key"
        use "$pack" "$dir"
        return 0
      fi
      say "$pack: not reusing $dir: it was built dirty, and these inputs are committed and no variant knob is set, so a clean toolchain of the same key replaces it"
    else
      say "$pack: not reusing $dir: ${res#toolchain-manifest.mjs: }"
    fi
    remove_tree "$dir"
  fi

  if [ -z "$reasons" ] && [ -z "$no_fetch" ]; then
    rc=0
    "$STORE" toolchain-fetch "$pack" "$dir" >/dev/null || rc=$?
    case "$rc" in
      0) use "$pack" "$dir"; return 0 ;;
      3) ;;
      *) die "$pack: fetching toolchain $key failed" ;;
    esac
  fi
  if [ -n "$any" ] && [ -z "$no_fetch" ]; then
    rc=0
    out="$("$STORE" toolchain-fetch "$pack" --any)" || rc=$?
    case "$rc" in
      0)
        out="$(tail -n 1 <<<"$out")"
        [ "$(basename "$out")" = "$key" ] || say "$pack: $out is not this commit's toolchain (that is $key); assemble it with ALLOW_OTHER_TOOLCHAIN=1"
        use "$pack" "$out"
        return 0
        ;;
      3) ;;
      *) die "$pack: fetching the newest toolchain failed" ;;
    esac
  fi

  if [ -n "$fetch_only" ]; then
    say "$pack: no toolchain $key here or in the store: it would build"
    exit 3
  fi
  if [ -n "$reasons" ] && [ -z "$build_dirty" ]; then
    say "$pack: the toolchain's inputs are dirty, so it is not built without being asked:"$'\n'"  ${reasons//$'\n'/$'\n'  }"$'\n'"build it anyway with: setup.sh --build-toolchain $pack"
    exit 4
  fi
  build "$pack" "$key" "$dir" "$reasons"
  use "$pack" "$dir"
}

# Builds pack $1's toolchain of key $2 into $3; $4 are the dirty reasons.
build() {
  local pack="$1" key="$2" dir="$3" reasons="$4" out commit knobs outputs
  local -a args=()
  outputs="$LIGHT/packs/$pack/toolchain.outputs"
  [ -f "$outputs" ] || die "$pack: packs/$pack/toolchain.outputs is missing: a toolchain must declare what it builds"
  [ -f "$LIGHT/packs/$pack/toolchain.sh" ] || die "$pack: packs/$pack/toolchain.sh is missing"
  out="$(toolchain_env_args "$pack")"
  mapfile -t args <<<"$out"
  knobs="$(variant_knobs_json "$pack")"
  commit=dirty
  [ -n "$reasons" ] || commit="$(git -C "$LIGHT" rev-parse HEAD)"

  stage="$(mktemp -d "${TMPDIR:-/tmp}/pack-toolchain-stage.XXXXXX")"
  toolchain_stage "$pack" "$stage"
  mkdir -p "$(dirname "$dir")"
  part="$dir.part"
  remove_tree "$part"
  mkdir "$part"
  say "$pack: building toolchain $key${reasons:+ (dirty)}"
  # In the stage's copy of the pack directory, so what is not an input is
  # not there; stdout to stderr, as stdout is the toolchain's directory.
  if ! (cd "$stage/light/packs/$pack" && env -i "${args[@]}" OUT="$part" "$BASH" toolchain.sh >&2); then
    die "$pack: toolchain.sh failed; nothing was recorded"
  fi
  remove_tree "$stage"
  stage=""
  [ ! -e "$part/toolchain.json" ] || die "$pack: toolchain.sh wrote a toolchain.json; that name is the manifest's"
  check_outputs "$(cat "$outputs")" "$part" || die "$pack: the toolchain does not have every output packs/$pack/toolchain.outputs declares; nothing was recorded"
  node "$MANIFEST" write "$part" "$pack" "$key" "$commit" "$knobs"
  find "$part" -type f -exec chmod a-w {} +
  remove_tree "$dir"
  mv "$part" "$dir"
  part=""
  say "$pack: built toolchain $key"
}

# The sidecar of pack $1.
sidecar_of() { echo "$SIDECARS/toolchain-$1.json"; }

assemble() {
  local pack="${1:?pack}" dir="${2:?toolchain directory}" out="${3:-}" key res mkey mcommit other=0 files f missing="" writable
  split_pack "$pack"
  out="${out:-$LIGHT/app/static/packs/$pack}"
  [ -f "$dir/toolchain.json" ] || die "$pack: $dir holds no toolchain.json; it is not a toolchain"
  dir="$(cd "$dir" && pwd)"
  out="$(realpath -m "$out")"
  case "$out/" in "$dir/"*) die "$pack: cannot assemble into $out, inside the toolchain itself" ;; esac
  key="$(key_of "$pack")"

  # 1. Checks.
  if [ "${ALLOW_OTHER_TOOLCHAIN:-}" = 1 ]; then
    res="$(node "$MANIFEST" check "$dir" "$pack" -)" || die "$pack: $dir is not the toolchain its toolchain.json lists"
    read -r mkey mcommit <<<"$res"
    if [ "$mkey" != "$key" ]; then
      other=1
      local head_outputs
      head_outputs="$(git -C "$LIGHT" show "HEAD:light/packs/$pack/toolchain.outputs")" ||
        die "$pack: HEAD has no packs/$pack/toolchain.outputs to check another toolchain against"
      check_outputs "$head_outputs" "$dir" || die "$pack: the toolchain $mkey lacks outputs HEAD declares; it cannot stand in for $key"
      (cd "$LIGHT/packs/$pack" && env -u OUT TOOLCHAIN_DIR="$dir" bash glue.sh --check-versions >&2) ||
        die "$pack: the glue's versions check refuses the toolchain $mkey"
      say "warning: $pack: assembling over the toolchain $mkey, not this commit's $key (ALLOW_OTHER_TOOLCHAIN)"
    fi
  else
    res="$(node "$MANIFEST" check "$dir" "$pack" "$key")" || die "$pack: $dir is not a toolchain of HEAD's inputs ($key) as its toolchain.json lists"
    read -r mkey mcommit <<<"$res"
  fi
  # A toolchain of this key has every output the worktree declares. Checked
  # whichever way the toolchain came (built, reused or fetched), because
  # toolchain.outputs is no input of the key: an output declared after this
  # toolchain was built keeps the key and would otherwise never be looked
  # for. (Another commit's toolchain was checked against HEAD's file above.)
  if [ "$other" = 0 ]; then
    [ -f "$LIGHT/packs/$pack/toolchain.outputs" ] ||
      die "$pack: packs/$pack/toolchain.outputs is missing: a toolchain must declare what it builds"
    check_outputs "$(cat "$LIGHT/packs/$pack/toolchain.outputs")" "$dir" ||
      die "$pack: the toolchain $mkey lacks outputs packs/$pack/toolchain.outputs declares; as that file is no input of the key, declare a new output in the same change as the toolchain.sh edit that builds it"
  fi
  writable="$(find "$dir" -type f ! -path "$dir/toolchain.json" -perm /222 -print -quit)"
  [ -z "$writable" ] || die "$pack: $writable is writable; a toolchain's files are read-only, so that assembly cannot write into it"

  # 2. Link (or copy) the toolchain.
  mkdir -p "$(dirname "$out")"
  part="$out.part"
  remove_tree "$part"
  if ! cp -al "$dir" "$part" 2>/dev/null; then
    remove_tree "$part"
    say "$pack: cannot hard-link $dir into $(dirname "$out"); copying it"
    cp -a "$dir" "$part"
  fi
  rm -f "$part/toolchain.json"

  # 3. The glue.
  files="$(cd "$LIGHT/packs/$pack" && OUT="$part" TOOLCHAIN_DIR="$dir" bash glue.sh)" || die "$pack: glue.sh failed"

  # 4. What it printed is there, and the toolchain is as it was.
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in /* | ../* | */../* | ..) missing+="  $f (not a path inside the pack)"$'\n'; continue ;; esac
    [ -e "$part/$f" ] || missing+="  $f"$'\n'
  done <<<"$files"
  [ -z "$missing" ] || die "$pack: glue.sh printed files it did not make:"$'\n'"${missing%$'\n'}"
  writable="$(find "$dir" -type f ! -path "$dir/toolchain.json" -perm /222 -print -quit)"
  [ -z "$writable" ] || die "$pack: glue.sh made $writable writable, a file of the toolchain itself"

  # 5. The sidecar, checking every linked file on the way.
  node "$MANIFEST" linked "$dir" "$pack" "$part" "$(sidecar_of "$pack")" "$other" || die "$pack: the assembled pack is refused"

  # 6. Swap it in.
  remove_tree "$out"
  mv "$part" "$out"
  part=""
  say "$pack: assembled $out from toolchain $mkey"
  # 7.
  [ "$mcommit" != dirty ] || say "warning: $pack: the toolchain was built dirty; this pack is for this machine only"
}

record_state() {
  local pack="${1:?pack}" tree dirty sidecar res spack skey scommit sother key
  split_pack "$pack"
  refuse() { say "$pack: not recording the assembled pack as HEAD's: $*"; exit 5; }
  tree="$(git -C "$LIGHT" rev-parse "HEAD:light/packs/$pack")"
  dirty="$(git -C "$LIGHT" status --porcelain --untracked-files=all -- "packs/$pack" scripts/pack-toolchain.sh scripts/pack-lib.sh scripts/toolchain-key.sh scripts/toolchain-build-env.sh scripts/toolchain-manifest.mjs)"
  [ -z "$dirty" ] || refuse "uncommitted changes:"$'\n'"$dirty"
  [ -z "${ALLOW_OTHER_TOOLCHAIN:-}" ] || refuse "ALLOW_OTHER_TOOLCHAIN is set: the pack may be over another commit's toolchain"
  sidecar="$(sidecar_of "$pack")"
  [ -f "$sidecar" ] || refuse "it was never assembled ($sidecar is missing)"
  res="$(node "$MANIFEST" sidecar "$sidecar")" || refuse "its sidecar cannot be read"
  read -r spack skey scommit sother <<<"$res"
  [ "$spack" = "$pack" ] || refuse "its sidecar is of pack $spack"
  [ "$scommit" != dirty ] || refuse "its toolchain was built dirty"
  [ "$sother" != 1 ] || refuse "it was assembled over another commit's toolchain"
  key="$(key_of "$pack")"
  [ "$skey" = "$key" ] || refuse "it was assembled over the toolchain $skey, but HEAD's inputs give $key"
  # Assembly is this script and toolchain-manifest.mjs (the glossary): a
  # change to either can change what an assembled pack is, so either is a
  # field. toolchain-build-env.sh is not: it is a line of the key already.
  echo "$tree $(git -C "$LIGHT" hash-object scripts/pack-toolchain.sh) $(git -C "$LIGHT" hash-object scripts/toolchain-manifest.mjs) $key"
}

case "${1:-}" in
  ensure) ensure "${2:?pack}" "${@:3}" ;;
  assemble) assemble "${2:?pack}" "${3:?toolchain directory}" "${4:-}" ;;
  record-state) record_state "${2:?pack}" ;;
  *) sed -n '3,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 2 ;;
esac
