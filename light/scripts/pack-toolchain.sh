#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Decides whether a toolchain unit of a split pack must be built, builds it
# hermetically when it must (after the units it needs), and assembles the
# pack from all its units: the one script between a split pack's sources and
# app/static/packs/<pack>.
#
#   pack-toolchain.sh ensure <unit>|<pack> [--fetch-only] [--no-fetch]
#                     [--rebuild] [--build-dirty] [--any] [--from <dir>]
#                     [--no-build-deps]
#       Prints the directory of a toolchain of HEAD's inputs (and this
#       environment's variant knobs) of the unit <pack>/<unit> on stdout,
#       reusing the local copy, taking it from --from, fetching it from the
#       toolchain store, or building it, in that order. Given a pack, it does
#       so for every unit of the pack, each after the units it needs, and
#       prints one directory per line in that order (assemble's arguments).
#         reuse    $TOOLCHAIN_CACHE/built/<pack>/<unit>/<key> when its
#                  toolchain.json still lists every file at its size and
#                  mtime (not with --rebuild); one that does not is removed,
#                  naming the file. A toolchain built dirty is not reused
#                  once the build would be clean: committing exactly the
#                  inputs it was built from keeps the key, and reusing it
#                  then would leave a toolchain that is never published or
#                  recorded as HEAD's in place of one that can be. It is
#                  removed, and the clean one taken, fetched or built.
#         from     <dir>/toolchain-<pack>-<unit>-<key>.tar.zst when it is
#                  there and the build would be clean: an archive another
#                  job of the same CI run built and handed on as an
#                  artifact (pack-store.sh toolchain-archive), checked file
#                  by file like a fetch. A corrupt one fails; a missing one
#                  is no error.
#         fetch    from the store, unless the build would be dirty or
#                  --no-fetch is given. --any then fetches the unit's newest
#                  toolchain whatever its key, saying it is not this commit's
#                  (setup.sh --latest).
#         build    exit 3 instead with --fetch-only; exit 4 instead when the
#                  build would be dirty and --build-dirty is not given.
#                  Otherwise every unit it needs is ensured first, by this
#                  same command (a cycle of needs fails by name before
#                  anything is built), with --build-dirty, --no-fetch and
#                  --from passed on, and as --fetch-only with
#                  --no-build-deps, so a CI job builds exactly one unit.
#                  With --no-build-deps, --no-fetch is this unit's alone:
#                  nothing would build the units it needs, so they are
#                  still taken from --from or fetched. A CI unit job passes
#                  both, so it builds the unit its plan found missing even
#                  when another run stored it meanwhile: a toolchain fetched
#                  in its place names that run's commit, and publish and
#                  archive refuse it (pack-store.sh clean_toolchain_key).
#                  Then toolchain.sh runs in a stage holding only the unit's
#                  inputs and, read-only at $DEP_<UNIT>, the units it needs
#                  (toolchain_stage), under `env -i` with only
#                  toolchain_env_args, from the unit's own directory; its
#                  outputs are checked against the unit's `outputs`, and its
#                  files made read-only.
#       A unit it needs is ensured only when this unit is built: reusing or
#       fetching a unit needs only the dependency's key, never its files,
#       so taking the libraries never downloads the compilers.
#       Afterwards all but the unit's 2 most recently used toolchains are
#       removed from the local cache.
#   pack-toolchain.sh assemble <pack> [--out <dir>] <toolchain dir>...
#       Assembles the pack from the toolchain directories of all its units,
#       each given once (ensure <pack>'s output), into --out (default
#       app/static/packs/<pack>): links every unit's files into one tree
#       (copies them where links are impossible), refusing two units that
#       write one path; runs the pack's glue.sh over them; checks the glue
#       left every toolchain file as it was; writes the sidecar; and swaps
#       the result in. Refuses a unit's toolchain that lacks an output its
#       `outputs` declares, every time: the file is no input of the key, so
#       an output declared after a toolchain of the same key was built or
#       stored is checked here or nowhere. Refuses a toolchain of other
#       inputs unless ALLOW_OTHER_TOOLCHAIN=1 (set by setup.sh --latest) and
#       that toolchain has every output HEAD's `outputs` declares and the
#       glue's versions check passes. Refuses, every time, a unit given
#       with a unit it needs whose key is not the one its toolchain.json
#       records it was built over (toolchain-manifest.mjs needs): with
#       HEAD's keys that cannot happen, as the dependency's key is a line of
#       the unit's, but `ensure --any` fetches each unit's newest toolchain
#       on its own, and libraries built by an old compiler must not be
#       assembled with a new one (D44).
#   pack-toolchain.sh record-state <pack>
#       Prints "<tree of packs/<pack>> <blob of pack-toolchain.sh> <blob of
#       toolchain-manifest.mjs> <unit>=<key>...", the state setup.sh records
#       for a pack assembled at HEAD: the pack, assembly as the glossary
#       defines it, and each unit's toolchain (whose key already covers the
#       build environment and the units it needs), in ensure's order. Or
#       exits 5 naming why the assembled pack is not HEAD's: an uncommitted
#       change to the pack or to assembly, a dirty build, another commit's
#       toolchain, or a unit missing.
#
# Exit codes: 1 something failed (named), 2 not a split pack or unit, or bad
# usage, 3 --fetch-only would build, 4 dirty inputs not built without being
# asked, 5 record-state refuses.
#
# Glossary.
#   split pack     a pack with packs/<pack>/toolchains/. Its output is its
#                  units' toolchains plus the glue, never kept whole in a
#                  store.
#   unit           packs/<pack>/toolchains/<unit>/, named <pack>/<unit>: one
#                  keyed, stored and built part of a pack's toolchain
#                  (cpp's compilers, its VM, its libraries; rust's own
#                  language server). toolchain-key.sh's header lists its
#                  files.
#   toolchain      what a unit's toolchain.sh builds from the files
#                  toolchain_specs names (toolchain-key.sh), over the units
#                  it needs: compilers, sysroots, runtimes. Hours of work,
#                  changed rarely.
#   needs          the units a unit is built with (its `needs` file): each is
#                  ensured first, linked read-only into the stage at
#                  $DEP_<UNIT>, and its key is a line of this unit's key, so
#                  a change to the compilers re-keys the libraries built
#                  with them and nothing else.
#   build env      toolchain-build-env.sh: what reaches toolchain.sh besides
#                  its inputs (the variables let through, the dependencies,
#                  the JVM's proxy flags, the stage). One of every unit's
#                  inputs, so changing it rebuilds them all.
#   key            the hash of exactly a unit's inputs, the keys of the units
#                  it needs and its set variant knobs (pack-store.sh
#                  toolchain-key, defined by toolchain-key.sh, which is no
#                  input itself: a change of what it computes bumps the
#                  key's format tag). One key, one toolchain.
#   knob           a variable a unit's `env` declares, the only one besides
#                  the fixed and transport variables and its dependencies
#                  that reaches toolchain.sh. A `variant` knob changes the
#                  output: setting it changes the key and makes the build
#                  dirty. A `source` knob does not.
#   dirty          built from uncommitted inputs, with an uncommitted paths,
#                  env or needs file (no inputs, but they decide what
#                  reaches the build), with a set variant knob, or over a
#                  unit it needs that would be dirty. A dirty toolchain is
#                  recorded with commit "dirty", used locally, and never
#                  fetched, published, handed on or recorded as HEAD's.
#   toolchain dir  $TOOLCHAIN_CACHE/built/<pack>/<unit>/<key>: the
#                  toolchain's files, read-only, and toolchain.json, its
#                  manifest (toolchain-manifest.mjs: unit, key, commit,
#                  knobs, needs, and every file's size, sha256 and mtime).
#   glue           packs/<pack>/glue.sh and what it reads, the files the
#                  pack's glue.paths names: the pack's own JavaScript and
#                  assets. Run at assembly with OUT (the pack being
#                  assembled, every unit's files already in it) and
#                  TOOLCHAIN_DIR_<UNIT> for each unit (the unit's name
#                  upper-cased, `-` made `_`: TOOLCHAIN_DIR_COMPILERS); it
#                  adds its files, prints each one's path relative to OUT on
#                  its own line, and never changes a file of a toolchain.
#                  Run as `glue.sh --check-versions` with the same
#                  TOOLCHAIN_DIR_<UNIT> and without OUT, it checks that each
#                  unit's versions file has every version the glue reads,
#                  and exits non-zero naming what is missing. It never runs
#                  a compiler (light/packs/contract.test.mjs: no cargo,
#                  swift, sbt, gradle, emcc, em++, clang or ghc), so
#                  assembly takes seconds and needs no toolchain installed.
#   assembly       this script and toolchain-manifest.mjs: part of no key, so
#                  changing them rebuilds nothing; nor does changing the
#                  helpers they share with pack-store.sh (pack-lib.sh).
#   sidecar        app/node_modules/.cache/yukibana/toolchain-<pack>.json,
#                  written by assemble: every unit's files with their sha256
#                  and their mtimes in the assembled pack, so a later check
#                  (PM1) can tell the toolchain part of a served pack is
#                  intact without hashing it. Never served.
#
# The pin rule. Every version and download pin of a unit lives in its own
# toolchains/<unit>/pins.sh, as lines matching ^[A-Z][A-Z0-9_]*=[^$`(]*$
# (plain assignments a reader can trust without running them; toolchain.sh
# sources it). So a pin is an input of its unit alone: a test-framework pin
# rebuilds the libraries and not the compilers, and a build step's stamp
# hashes its own unit's pins.sh, never another's. The toolchain writes the
# versions it was built with into a versions file of its own, and the glue
# reads versions only from there, never from pins.sh or build.sh, so a glue
# assembled over another commit's toolchain describes the toolchain it got.
# CI never parses build.sh. (light/packs/contract.test.mjs checks that every
# unit's pins.sh is such lines, and that glue.sh and build.sh assign none.)
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
SELF="$LIGHT/scripts/pack-toolchain.sh"
STORE="$LIGHT/scripts/pack-store.sh"
MANIFEST="$LIGHT/scripts/toolchain-manifest.mjs"
TOOLCHAIN_CACHE="${TOOLCHAIN_CACHE:-$HOME/.cache/yukibana-toolchains}"
export TOOLCHAIN_CACHE
SIDECARS="$LIGHT/app/node_modules/.cache/yukibana"
# How many toolchains of a unit the local cache keeps, the one in use
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

# The directory of unit $1's toolchains in the local cache.
unit_cache() { echo "$TOOLCHAIN_CACHE/built/$1"; }

# The variable that gives glue.sh the toolchain directory of unit $1:
# TOOLCHAIN_DIR_ and the unit's name upper-cased, `-` made `_`.
glue_var() {
  local unit="${1#*/}"
  unit="${unit^^}"
  echo "TOOLCHAIN_DIR_${unit//-/_}"
}

# Prints why a build of unit $1 here would be dirty, one reason per line:
# each uncommitted file of it or of a unit it needs (pack-store.sh
# toolchain-dirty), then each set variant knob of it or of a unit it needs
# as "NAME=value (a variant knob of <unit>)". Nothing means clean.
dirty_reasons() {
  local id="$1" out rc=0 name kind u
  local -a units=()
  out="$("$STORE" toolchain-dirty "$id")" || rc=$?
  case "$rc" in
    0) printf '%s\n' "$out" ;;
    1) ;;
    *) die "$id: cannot tell whether its toolchain inputs are dirty" ;;
  esac
  out="$(toolchain_order "$id")"
  mapfile -t units <<<"$out"
  for u in "${units[@]}"; do
    out="$(toolchain_knobs "$u")"
    [ -n "$out" ] || continue
    while read -r name kind; do
      if [ "$kind" != variant ] || [ -z "${!name+x}" ]; then continue; fi
      printf '%s=%s (a variant knob of %s)\n' "$name" "${!name}" "$u"
    done <<<"$out"
  done
}

# Prints {"NAME": "value", ...} of unit $1's set variant knobs.
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

# Checks that every line of outputs text $1 (a path or glob, with ** for any
# depth; blank and # lines ignored) matches a non-empty file in directory
# $2. Names every line that does not, then returns 1; returns 1 too when no
# output is declared at all, as nothing would then be checked.
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
    say "the unit's outputs file declares no output"
    return 1
  fi
  if [ -n "$missing" ]; then
    say "these declared outputs match no non-empty file in $dir:"$'\n'"${missing%$'\n'}"
    return 1
  fi
}

# Removes all but the KEEP_LOCAL most recently used toolchains of unit $1
# from the local cache, never $2 (the one just used). Use is the directory's
# own mtime, which every ensure touches; its files' mtimes are the
# manifest's and never change.
prune() {
  local id="$1" keep="$2" n=1 line dir
  [ -d "$(unit_cache "$id")" ] || return 0
  while IFS= read -r line; do
    dir="${line#* }"
    [ "$dir" != "$keep" ] || continue
    if [ "$n" -lt "$KEEP_LOCAL" ]; then n=$((n + 1)); continue; fi
    say "$id: removing the old toolchain $dir from the local cache"
    remove_tree "$dir"
  done < <(find "$(unit_cache "$id")" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex '.*/[0-9a-f]{40}' -printf '%T@ %p\n' | sort -rn)
}

# Marks toolchain $2 of unit $1 as just used, prunes the others, prints it.
use() {
  touch "$2"
  prune "$1" "$2"
  echo "$2"
}

ensure() {
  local target="${1:?unit or pack}" out rc u
  local -a units=()
  shift
  case "$target" in
    */*) ensure_unit "$target" "$@" ;;
    *)
      split_pack "$target"
      out="$(toolchain_units "$target")"
      mapfile -t units <<<"$out"
      # One process per unit, as a unit's ensure exits with its own code.
      for u in "${units[@]}"; do
        rc=0
        out="$("$SELF" ensure "$u" "$@")" || rc=$?
        [ "$rc" = 0 ] || exit "$rc"
        printf '%s\n' "$out"
      done
      ;;
  esac
}

ensure_unit() {
  local id="${1:?unit}" fetch_only="" no_fetch="" rebuild="" build_dirty="" any="" from="" no_build_deps=""
  shift
  split_unit "$id"
  while [ $# -gt 0 ]; do
    case "$1" in
      --fetch-only) fetch_only=1 ;;
      --no-fetch) no_fetch=1 ;;
      --rebuild) rebuild=1 ;;
      --build-dirty) build_dirty=1 ;;
      --any) any=1 ;;
      --from) from="${2:?--from <dir>}"; shift ;;
      --no-build-deps) no_build_deps=1 ;;
      *) say "ensure: unknown option $1"; exit 2 ;;
    esac
    shift
  done
  local key dir reasons res mcommit out rc archive
  key="$(key_of "$id")"
  dir="$(unit_cache "$id")/$key"
  reasons="$(dirty_reasons "$id")"

  if [ -z "$rebuild" ] && [ -d "$dir" ]; then
    # On success check prints only "<key> <commit>"; on failure only its
    # one line naming why.
    if res="$(node "$MANIFEST" check "$dir" "$id" "$key" 2>&1)"; then
      read -r _ mcommit <<<"$res"
      if [ "$mcommit" != dirty ] || [ -n "$reasons" ]; then
        say "$id: reusing toolchain $key"
        use "$id" "$dir"
        return 0
      fi
      say "$id: not reusing $dir: it was built dirty, and these inputs are committed and no variant knob is set, so a clean toolchain of the same key replaces it"
    else
      say "$id: not reusing $dir: ${res#toolchain-manifest.mjs: }"
    fi
    remove_tree "$dir"
  fi

  if [ -z "$reasons" ] && [ -n "$from" ]; then
    archive="$from/toolchain-${id%%/*}-${id#*/}-$key.tar.zst"
    if [ -f "$archive" ]; then
      say "$id: taking toolchain $key from $archive"
      "$STORE" toolchain-unpack "$id" "$archive" "$dir" >/dev/null || die "$id: $archive is refused"
      use "$id" "$dir"
      return 0
    fi
  fi
  if [ -z "$reasons" ] && [ -z "$no_fetch" ]; then
    rc=0
    "$STORE" toolchain-fetch "$id" "$dir" >/dev/null || rc=$?
    case "$rc" in
      0) use "$id" "$dir"; return 0 ;;
      3) ;;
      *) die "$id: fetching toolchain $key failed" ;;
    esac
  fi
  if [ -n "$any" ] && [ -z "$no_fetch" ]; then
    rc=0
    out="$("$STORE" toolchain-fetch "$id" --any)" || rc=$?
    case "$rc" in
      0)
        out="$(tail -n 1 <<<"$out")"
        [ "$(basename "$out")" = "$key" ] || say "$id: $out is not this commit's toolchain (that is $key); assemble it with ALLOW_OTHER_TOOLCHAIN=1"
        use "$id" "$out"
        return 0
        ;;
      3) ;;
      *) die "$id: fetching the newest toolchain failed" ;;
    esac
  fi

  if [ -n "$fetch_only" ]; then
    say "$id: no toolchain $key here${from:+, in $from} or in the store: it would build"
    exit 3
  fi
  if [ -n "$reasons" ] && [ -z "$build_dirty" ]; then
    say "$id: the toolchain's inputs are dirty, so it is not built without being asked:"$'\n'"  ${reasons//$'\n'/$'\n'  }"$'\n'"build it anyway with: setup.sh --build-toolchain $id"
    exit 4
  fi

  # The units it needs, each by this same command, so each is reused,
  # taken, fetched or built, and pruned, as if asked for alone.
  local dep d
  local -a flags=() staged=() deps=()
  [ -z "$build_dirty" ] || flags+=(--build-dirty)
  [ -z "$from" ] || flags+=(--from "$from")
  # --no-fetch reaches the units it needs only when they may be built
  # here: under --no-build-deps they are fetch-only, and a fetch-only
  # dependency that may not be fetched could come from nowhere but --from.
  if [ -n "$no_build_deps" ]; then
    flags+=(--fetch-only --no-build-deps)
  elif [ -n "$no_fetch" ]; then
    flags+=(--no-fetch)
  fi
  out="$(toolchain_needs "$id")"
  [ -z "$out" ] || mapfile -t deps <<<"$out"
  for dep in "${deps[@]}"; do
    rc=0
    d="$("$SELF" ensure "$dep" "${flags[@]}")" || rc=$?
    if [ "$rc" != 0 ]; then
      [ -z "$no_build_deps" ] || [ "$rc" != 3 ] || say "$id: needs $dep, which is not here${from:+, in $from} or in the store, and --no-build-deps builds no unit but $id"
      exit "$rc"
    fi
    staged+=("$dep=$(tail -n 1 <<<"$d")")
  done
  build "$id" "$key" "$dir" "$reasons" "${staged[@]}"
  use "$id" "$dir"
}

# Builds unit $1's toolchain of key $2 into $3; $4 are the dirty reasons,
# and each argument after them <unit>=<dir>, a unit it needs and its
# toolchain.
build() {
  local id="$1" key="$2" dir="$3" reasons="$4" out commit knobs needs outputs unitdir arg
  shift 4
  local -a args=()
  unitdir="$LIGHT/packs/${id%%/*}/toolchains/${id#*/}"
  outputs="$unitdir/outputs"
  [ -f "$outputs" ] || die "$id: packs/$id/outputs is missing: a unit must declare what it builds"
  [ -f "$unitdir/toolchain.sh" ] || die "$id: its toolchain.sh is missing (packs/${id%%/*}/toolchains/${id#*/}/toolchain.sh)"
  knobs="$(variant_knobs_json "$id")"
  local -a pairs=()
  for arg in "$@"; do
    out="$(key_of "${arg%%=*}")"
    pairs+=("${arg%%=*}" "$out")
  done
  needs="$(node -e 'const a = process.argv.slice(1), o = {}; for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1]; console.log(JSON.stringify(o));' -- "${pairs[@]}")"
  commit=dirty
  [ -n "$reasons" ] || commit="$(git -C "$LIGHT" rev-parse HEAD)"

  stage="$(mktemp -d "${TMPDIR:-/tmp}/pack-toolchain-stage.XXXXXX")"
  toolchain_stage "$id" "$stage" "$@"
  out="$(toolchain_env_args "$id" "$stage")"
  mapfile -t args <<<"$out"
  mkdir -p "$(dirname "$dir")"
  part="$dir.part"
  remove_tree "$part"
  mkdir "$part"
  say "$id: building toolchain $key${reasons:+ (dirty)}"
  # In the stage's copy of the unit's directory, so what is not an input is
  # not there; stdout to stderr, as stdout is the toolchain's directory.
  if ! (cd "$stage/light/packs/${id%%/*}/toolchains/${id#*/}" && env -i "${args[@]}" OUT="$part" "$BASH" toolchain.sh >&2); then
    die "$id: toolchain.sh failed; nothing was recorded"
  fi
  remove_tree "$stage"
  stage=""
  [ ! -e "$part/toolchain.json" ] || die "$id: toolchain.sh wrote a toolchain.json; that name is the manifest's"
  check_outputs "$(cat "$outputs")" "$part" || die "$id: the toolchain does not have every output its outputs file declares; nothing was recorded"
  node "$MANIFEST" write "$part" "$id" "$key" "$commit" "$knobs" "$needs"
  find "$part" -type f -exec chmod a-w {} +
  remove_tree "$dir"
  mv "$part" "$dir"
  part=""
  say "$id: built toolchain $key"
}

# The sidecar of pack $1.
sidecar_of() { echo "$SIDECARS/toolchain-$1.json"; }

assemble() {
  local pack="${1:?pack}" out="" key res mkey mcommit other=0 files f missing="" writable u dir dirty=""
  local -a units=() dirs=() glue=()
  local -A dir_of=()
  shift
  split_pack "$pack"
  while [ $# -gt 0 ]; do
    case "$1" in
      --out) out="${2:?--out <dir>}"; shift ;;
      -*) say "assemble: unknown option $1"; exit 2 ;;
      *) dirs+=("$1") ;;
    esac
    shift
  done
  out="$(realpath -m "${out:-$LIGHT/app/static/packs/$pack}")"
  res="$(toolchain_units "$pack")"
  mapfile -t units <<<"$res"
  # Which unit each directory is, by its manifest; every unit once.
  for dir in "${dirs[@]}"; do
    [ -f "$dir/toolchain.json" ] || die "$pack: $dir holds no toolchain.json; it is not a toolchain"
    dir="$(cd "$dir" && pwd)"
    u="$(node -e 'const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(typeof m.unit === "string" ? m.unit : "?")' "$dir/toolchain.json")"
    [[ " ${units[*]} " == *" $u "* ]] || die "$pack: $dir is a toolchain of $u, not of a unit of $pack (${units[*]})"
    [ -z "${dir_of[$u]+x}" ] || die "$pack: two toolchains of $u given: ${dir_of[$u]} and $dir"
    case "$out/" in "$dir/"*) die "$pack: cannot assemble into $out, inside the toolchain $dir" ;; esac
    dir_of[$u]="$dir"
  done
  for u in "${units[@]}"; do
    [ -n "${dir_of[$u]+x}" ] || die "$pack: no toolchain of $u given; assemble takes every unit of the pack (pack-toolchain.sh ensure $pack prints them)"
  done
  dirs=()
  for u in "${units[@]}"; do dirs+=("${dir_of[$u]}"); done

  # 1. Checks, unit by unit.
  for u in "${units[@]}"; do
    dir="${dir_of[$u]}"
    key="$(key_of "$u")"
    glue+=("$(glue_var "$u")=$dir")
    if [ "${ALLOW_OTHER_TOOLCHAIN:-}" = 1 ]; then
      res="$(node "$MANIFEST" check "$dir" "$u" -)" || die "$u: $dir is not the toolchain its toolchain.json lists"
      read -r mkey mcommit <<<"$res"
      if [ "$mkey" != "$key" ]; then
        other=1
        local head_outputs
        head_outputs="$(git -C "$LIGHT" show "HEAD:light/packs/${u%%/*}/toolchains/${u#*/}/outputs")" ||
          die "$u: HEAD has no outputs file of $u to check another toolchain against"
        check_outputs "$head_outputs" "$dir" || die "$u: the toolchain $mkey lacks outputs HEAD declares; it cannot stand in for $key"
        say "warning: $u: assembling over the toolchain $mkey, not this commit's $key (ALLOW_OTHER_TOOLCHAIN)"
      fi
    else
      res="$(node "$MANIFEST" check "$dir" "$u" "$key")" || die "$u: $dir is not a toolchain of HEAD's inputs ($key) as its toolchain.json lists"
      read -r mkey mcommit <<<"$res"
    fi
    # A toolchain of this key has every output the worktree declares.
    # Checked whichever way the toolchain came (built, reused, taken or
    # fetched), because the outputs file is no input of the key: an output
    # declared after this toolchain was built keeps the key and would
    # otherwise never be looked for. (Another commit's toolchain was
    # checked against HEAD's file above.)
    if [ "$mkey" = "$key" ]; then
      f="$LIGHT/packs/${u%%/*}/toolchains/${u#*/}/outputs"
      [ -f "$f" ] || die "$u: its outputs file is missing: a unit must declare what it builds"
      check_outputs "$(cat "$f")" "$dir" ||
        die "$u: the toolchain $mkey lacks outputs its outputs file declares; as that file is no input of the key, declare a new output in the same change as the toolchain.sh edit that builds it"
    fi
    [ "$mcommit" != dirty ] || dirty+=" $u"
    writable="$(find "$dir" -type f ! -path "$dir/toolchain.json" -perm /222 -print -quit)"
    [ -z "$writable" ] || die "$u: $writable is writable; a toolchain's files are read-only, so that assembly cannot write into it"
  done
  node "$MANIFEST" overlap "${dirs[@]}" || die "$pack: its units cannot be linked into one pack"
  node "$MANIFEST" needs "${dirs[@]}" || die "$pack: a unit is given with another toolchain of a unit it needs than the one it was built over"
  if [ "$other" = 1 ]; then
    (cd "$LIGHT/packs/$pack" && env -u OUT "${glue[@]}" bash glue.sh --check-versions >&2) ||
      die "$pack: the glue's versions check refuses the toolchains it was given"
  fi

  # 2. Link (or copy) every unit into one tree. The units write no path
  # twice (overlap, above), so a later unit only adds to the tree.
  mkdir -p "$(dirname "$out")"
  part="$out.part"
  remove_tree "$part"
  if ! link_units cp -al "$part" "${dirs[@]}" 2>/dev/null; then
    remove_tree "$part"
    say "$pack: cannot hard-link its toolchains into $(dirname "$out"); copying them"
    link_units cp -a "$part" "${dirs[@]}"
  fi

  # 3. The glue.
  files="$(cd "$LIGHT/packs/$pack" && env OUT="$part" "${glue[@]}" bash glue.sh)" || die "$pack: glue.sh failed"

  # 4. What it printed is there, and every toolchain is as it was.
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in /* | ../* | */../* | ..) missing+="  $f (not a path inside the pack)"$'\n'; continue ;; esac
    [ -e "$part/$f" ] || missing+="  $f"$'\n'
  done <<<"$files"
  [ -z "$missing" ] || die "$pack: glue.sh printed files it did not make:"$'\n'"${missing%$'\n'}"
  for dir in "${dirs[@]}"; do
    writable="$(find "$dir" -type f ! -path "$dir/toolchain.json" -perm /222 -print -quit)"
    [ -z "$writable" ] || die "$pack: glue.sh made $writable writable, a file of a toolchain itself"
  done

  # 5. The sidecar, checking every linked file on the way.
  node "$MANIFEST" linked "$pack" "$part" "$(sidecar_of "$pack")" "$other" "${dirs[@]}" || die "$pack: the assembled pack is refused"

  # 6. Swap it in.
  remove_tree "$out"
  mv "$part" "$out"
  part=""
  say "$pack: assembled $out from ${units[*]}"
  # 7.
  [ -z "$dirty" ] || say "warning: $pack: built dirty:$dirty; this pack is for this machine only"
}

# Runs `$1 $2 <dir> <into>` (cp -al or cp -a) for each toolchain directory
# after $3, the tree $3 being made by the first and added to by the rest,
# and removes each toolchain.json it brings: the manifests are the
# toolchains', not the pack's.
link_units() {
  local cp1="$1" cp2="$2" into="$3" dir
  shift 3
  for dir in "$@"; do
    if [ -e "$into" ]; then
      "$cp1" "$cp2" "$dir/." "$into/" || return 1
    else
      "$cp1" "$cp2" "$dir" "$into" || return 1
    fi
    rm -f "$into/toolchain.json"
  done
}

record_state() {
  local pack="${1:?pack}" tree dirty sidecar res line spack sother u skey scommit key state=""
  local -a units=()
  local -A seen=()
  split_pack "$pack"
  refuse() { say "$pack: not recording the assembled pack as HEAD's: $*"; exit 5; }
  tree="$(git -C "$LIGHT" rev-parse "HEAD:light/packs/$pack")"
  dirty="$(git -C "$LIGHT" status --porcelain --untracked-files=all -- "packs/$pack" scripts/pack-toolchain.sh scripts/pack-lib.sh scripts/toolchain-key.sh scripts/toolchain-build-env.sh scripts/toolchain-manifest.mjs)"
  [ -z "$dirty" ] || refuse "uncommitted changes:"$'\n'"$dirty"
  [ -z "${ALLOW_OTHER_TOOLCHAIN:-}" ] || refuse "ALLOW_OTHER_TOOLCHAIN is set: the pack may be over another commit's toolchain"
  sidecar="$(sidecar_of "$pack")"
  [ -f "$sidecar" ] || refuse "it was never assembled ($sidecar is missing)"
  res="$(node "$MANIFEST" sidecar "$sidecar")" || refuse "its sidecar cannot be read"
  read -r spack sother <<<"$(head -n 1 <<<"$res")"
  [ "$spack" = "$pack" ] || refuse "its sidecar is of pack $spack"
  [ "$sother" != 1 ] || refuse "it was assembled over another commit's toolchain"
  while read -r u skey scommit; do
    [ -n "$u" ] || continue
    [ "$scommit" != dirty ] || refuse "the toolchain of $u was built dirty"
    seen[$u]="$skey"
  done < <(tail -n +2 <<<"$res")
  res="$(toolchain_units "$pack")"
  mapfile -t units <<<"$res"
  for u in "${units[@]}"; do
    [ -n "${seen[$u]+x}" ] || refuse "it was assembled without $u"
    key="$(key_of "$u")"
    [ "${seen[$u]}" = "$key" ] || refuse "it was assembled over the toolchain ${seen[$u]} of $u, but HEAD's inputs give $key"
    state+=" $u=$key"
    unset 'seen[$u]'
  done
  for u in "${!seen[@]}"; do refuse "it was assembled with $u, which is no unit of $pack at HEAD"; done
  # Assembly is this script and toolchain-manifest.mjs (the glossary): a
  # change to either can change what an assembled pack is, so either is a
  # field. toolchain-build-env.sh is not: it is a line of every key already.
  echo "$tree $(git -C "$LIGHT" hash-object scripts/pack-toolchain.sh) $(git -C "$LIGHT" hash-object scripts/toolchain-manifest.mjs)$state"
}

case "${1:-}" in
  ensure) ensure "${2:?unit or pack}" "${@:3}" ;;
  assemble) assemble "${2:?pack}" "${@:3}" ;;
  record-state) record_state "${2:?pack}" ;;
  *) sed -n '3,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 2 ;;
esac
