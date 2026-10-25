# shellcheck shell=bash
# shellcheck source-path=SCRIPTDIR
# What a toolchain unit is built from, and its key: the one definition of a
# unit's inputs (toolchain_specs), of the units it is built with
# (toolchain_needs, toolchain_order), of the settings that change its output
# (toolchain_knobs) and of the lines its key hashes (toolchain_lines), so no
# script keeps a list of its own that could drift. Sourced, never run, by
# every script that keys, reports on, checks, stages or builds a toolchain
# (pack-store.sh, pack-toolchain.sh, light-packs.yml's plan and once lists);
# it sources toolchain-build-env.sh itself.
#
# A split pack is one with light/packs/<pack>/toolchains/. Its build is two
# halves. The toolchain (compilers, sysroots, runtimes, our own compiled
# language servers: hours, rarely changed) is one or more units, each the
# directory light/packs/<pack>/toolchains/<unit>/ and named <pack>/<unit>,
# each kept in the toolchain store under a key of exactly its own inputs, so
# a test-framework pin rebuilds the unit that holds it and not the
# compilers. The glue (glue.sh and the files glue.paths names: seconds,
# changed often) is assembled over every unit of the pack. A glue edit must
# not change any key, and nothing a unit reads may be left out of its key.
#
# A unit's directory holds:
#   toolchain.sh  what builds it (run by pack-toolchain.sh in a stage)
#   pins.sh       every version and download pin it builds with
#   outputs       what it must produce (pack-toolchain.sh's check_outputs)
#   paths         optional: the pack files outside toolchains/ it builds
#                 with (toolchain_specs)
#   needs         optional: the units it is built with (toolchain_needs)
#   env           optional: its settings (toolchain_knobs)
#   and anything else it reads: sub-scripts, patches, overlays.
#
# The key is the first 40 hex digits of the sha256 of the lines
#   yukibana-toolchain/4
#   unit <pack>/<unit>
#   <mode> <git blob id> <path>   each input in the worktree, sorted by path
#   needs <pack>/<unit> <key>     each unit it needs, sorted
#   env NAME=value                each set variant knob, sorted
# where the inputs are the files toolchain_specs names, untracked ones
# included and ignored ones not; light/scripts/toolchain-build-env.sh, the
# build environment, is always one of them, so changing it rebuilds every
# toolchain. A unit's paths, outputs, env and needs files are not: paths
# decides which files are inputs, and those files are in the key; outputs
# is checked at every assembly; a knob reaches the key only as its env line
# and a dependency only as its needs line, so a comment in any of them
# rebuilds nothing. A needs line carries the dependency's own key, so a
# change to the compilers re-keys every unit built with them, and nothing
# else. (Format 1 keyed toolchain.env's blob; format 2 keyed a whole pack
# minus exclusions, so every unit of a pack would have had every sibling's
# files as inputs; format 3 is the first with units.)
#
# This file is not an input of any key, though it decides every key: what it
# computes reaches the key as the resolved lines above, so a comment, a
# rename or a refactor here rebuilds nothing, which is the point of keeping
# it apart from the build environment (cpp's compilers take hours). The
# price is that the key cannot see a change of what it computes. So a
# change that alters any key (another line, another order, another rule
# for what is an input or which knob counts) bumps the format tag on the
# first line, yukibana-toolchain/N, and nothing else: test-pack-store.mjs
# pins the exact lines and key of a fixed unit, and fails until the tag and
# that fixture are updated together. Assembly (pack-toolchain.sh,
# toolchain-manifest.mjs) and the store's helpers (pack-store.sh,
# pack-lib.sh) are part of no key either.
#
# For the same reason nothing that decides what reaches a build is defined
# here: the variables every build gets and the names a knob may not take
# (TOOLCHAIN_ENV_FIXED, TOOLCHAIN_ENV_TRANSPORT, toolchain_env_reserved,
# toolchain_dep_var) are toolchain-build-env.sh's alone, and this file,
# sourced after it, never assigns or redefines any of them. A copy here once
# overrode the keyed one, so the allowlist every build saw came from a file
# no key covers; test-pack-store.mjs fails if any name of that file is
# defined here again.
#
# Functions return non-zero after naming what is wrong on stderr; with
# `set -e` and `shopt -s inherit_errexit`, `x=$(toolchain_specs p/u)` stops
# the caller there. A unit that does not exist, or a name that is not
# <pack>/<unit>, returns 2; anything wrong in a unit's files returns 1.

# The repository root this copy of the file belongs to. Taken from the file's
# own place (<root>/light/scripts/toolchain-key.sh), so a copy extracted from
# an older commit into a scratch directory (pack-store.sh's key report)
# describes that directory, not the checkout, and keys it with that commit's
# own definition.
TOOLCHAIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=toolchain-build-env.sh
source "$TOOLCHAIN_ROOT/light/scripts/toolchain-build-env.sh"

# Returns 0 when $1 has the shape of a unit's name, <pack>/<unit>: a pack is
# a lower-case letter then letters and digits, a unit the same with single
# hyphens between parts (haskell/ghc-wasm). Neither holds `/`, so the Actions
# cache prefix light/<pack>/<unit>/ of one unit never matches another's.
toolchain_unit_name() {
  [[ "$1" =~ ^[a-z][a-z0-9]*/[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]]
}

# Returns 0 when unit $1 exists (its directory under toolchains/ is there);
# otherwise returns 2, naming why.
toolchain_unit_check() {
  if ! toolchain_unit_name "$1"; then
    echo "toolchain-key.sh: '$1' is not a toolchain unit's name, <pack>/<unit>" >&2
    return 2
  fi
  if [ ! -d "$TOOLCHAIN_ROOT/light/packs/${1%%/*}/toolchains/${1#*/}" ]; then
    echo "toolchain-key.sh: no toolchain unit $1 (light/packs/${1%%/*}/toolchains/${1#*/}/)" >&2
    return 2
  fi
}

# Prints the units of pack $1, <pack>/<unit> one per line, in topological
# order (a unit after every unit of the pack it needs, ties by name), which
# is the order to ensure them in. Returns 2 when the pack has no
# toolchains/ directory or no unit in it (it is not split), 1 when a
# directory there has no unit's name or the units' needs are wrong.
toolchain_units() {
  local pack="${1:?pack}" dir d name bad=0 out
  local -a units=()
  dir="$TOOLCHAIN_ROOT/light/packs/$pack/toolchains"
  if [ ! -d "$dir" ]; then
    echo "toolchain-key.sh: $pack has no toolchain units (light/packs/$pack/toolchains/)" >&2
    return 2
  fi
  for d in "$dir"/*/; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    if ! toolchain_unit_name "$pack/$name"; then
      echo "toolchain-key.sh: light/packs/$pack/toolchains/$name/ is not a unit's name (lower-case letters and digits, single hyphens between parts)" >&2
      bad=1
      continue
    fi
    units+=("$pack/$name")
  done
  [ "$bad" = 0 ] || return 1
  if [ "${#units[@]}" -eq 0 ]; then
    echo "toolchain-key.sh: $pack has no toolchain units (light/packs/$pack/toolchains/ is empty)" >&2
    return 2
  fi
  mapfile -t units < <(printf '%s\n' "${units[@]}" | LC_ALL=C sort)
  out="$(toolchain_order "${units[@]}")" || return 1
  # Only this pack's units: a dependency in another pack is that pack's.
  awk -v p="$pack/" 'index($0, p) == 1' <<<"$out"
}

# Prints the git pathspecs of unit $1's inputs, one per line, from the
# repository root:
#   - its directory, light/packs/<pack>/toolchains/<unit>, then exclusions of
#     the four files in it that are never inputs (paths, outputs, env,
#     needs; see the header);
#   - light/packs/<pack>/<line> for each line of its `paths` file;
#   - light/scripts/toolchain-build-env.sh, the build environment.
#
# `paths` is an inclusion list: one pack file, directory or glob per line,
# relative to the pack's directory (build-lib.sh, patches/llvm-*.patch,
# vm/); blank lines and lines starting with `#` are ignored. It names the
# sub-scripts, patches, overlays and shared libraries the unit builds with
# that are not in its own directory. A file two units name is an input of
# both (a shared library). A line that matches no file is an error, as a
# typo would drop inputs silently; so is a line that names anything under
# toolchains/: a sibling unit's files are never an input, and its outputs
# reach this unit only through `needs`. Nor may a line be a pathspec with
# magic, absolute, or climb out of the pack with `..`.
#
# Nothing in the pack is an input unless a unit names it, so a new file
# nobody classified is in no key. That is not left to chance:
# light/packs/contract.test.mjs names every tracked file of a split pack
# that no unit's directory, no unit's paths and no glue.paths owns.
toolchain_specs() {
  local id="${1:?unit}" pack unit dir file line n=0 found under
  toolchain_unit_check "$id" || return
  pack="${id%%/*}"
  unit="${id#*/}"
  dir="light/packs/$pack/toolchains/$unit"
  echo "$dir"
  for line in paths outputs env needs; do
    printf ':(exclude)%s/%s\n' "$dir" "$line"
  done
  file="$TOOLCHAIN_ROOT/$dir/paths"
  if [ -f "$file" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      n=$((n + 1))
      line="${line#"${line%%[![:space:]]*}"}"
      line="${line%"${line##*[![:space:]]}"}"
      case "$line" in '' | '#'*) continue ;; esac
      case "$line" in
        :* | /*)
          echo "toolchain-key.sh: $dir/paths:$n: '$line' is not a path inside the pack (no pathspec magic, nothing absolute)" >&2
          return 1
          ;;
      esac
      case "/$line/" in
        */../*)
          echo "toolchain-key.sh: $dir/paths:$n: '$line' climbs out of the pack" >&2
          return 1
          ;;
      esac
      found="$(git -C "$TOOLCHAIN_ROOT" ls-files -co --exclude-standard -- "light/packs/$pack/$line")" || return 1
      if [ -z "$found" ]; then
        echo "toolchain-key.sh: $dir/paths:$n: '$line' matches no file" >&2
        return 1
      fi
      under="$(awk -v t="light/packs/$pack/toolchains/" 'index($0, t) == 1 && !f { print; f = 1 }' <<<"$found")"
      if [ -n "$under" ]; then
        echo "toolchain-key.sh: $dir/paths:$n: '$line' names $under, under toolchains/: a unit's own files are in its directory, and a sibling's files are never its inputs (its outputs reach it through needs)" >&2
        return 1
      fi
      printf 'light/packs/%s/%s\n' "$pack" "$line"
    done <"$file"
  fi
  echo light/scripts/toolchain-build-env.sh
}

# Prints the units unit $1 is built with, <pack>/<unit> one per line in the
# order its `needs` file lists them, read from that file, or from $2 when
# given (the report reads a file from another commit). No file means none.
#
# Each line of `needs` is a unit's name; blank lines and lines starting with
# `#` are ignored, and so is anything after ` #` (say why the unit needs
# it). A unit is needed when this unit's build reads its outputs: cpp's
# libraries are compiled by the compilers unit's cc-cross and stamped on it,
# so `libs` needs `cpp/compilers`. pack-toolchain.sh builds or fetches every
# needed unit first and gives the build its directory, read-only, as
# $DEP_<UNIT> (toolchain-build-env.sh); a unit not declared here is not
# there at all. A dependency may be in another pack.
#
# Anything else is an error naming the file and line: a line that is no
# unit's name, a unit that does not exist, the unit itself, or one listed
# twice. Every bad line is named, then it returns 1.
toolchain_needs() {
  local id="${1:?unit}" file="${2:-}" where line n=0 bad=0 seen=" "
  if [ -z "$file" ]; then
    where="light/packs/${id%%/*}/toolchains/${id#*/}/needs"
    file="$TOOLCHAIN_ROOT/$where"
  else
    where="$file"
  fi
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line="${line%%[[:space:]]#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    case "$line" in '' | '#'*) continue ;; esac
    if ! toolchain_unit_name "$line"; then
      echo "toolchain-key.sh: $where:$n: '$line' is not a toolchain unit's name, <pack>/<unit>" >&2
      bad=1
    elif [ "$line" = "$id" ]; then
      echo "toolchain-key.sh: $where:$n: $id cannot need itself" >&2
      bad=1
    elif [[ "$seen" == *" $line "* ]]; then
      echo "toolchain-key.sh: $where:$n: $line is listed twice" >&2
      bad=1
    elif [ ! -d "$TOOLCHAIN_ROOT/light/packs/${line%%/*}/toolchains/${line#*/}" ]; then
      echo "toolchain-key.sh: $where:$n: no toolchain unit $line (light/packs/${line%%/*}/toolchains/${line#*/}/)" >&2
      bad=1
    else
      seen+="$line "
      printf '%s\n' "$line"
    fi
  done <"$file"
  return "$bad"
}

# Prints units $@ and every unit they need, transitively, one per line, each
# after every unit it needs: the order in which to ensure them. When the
# needs form a cycle, nothing can be built first, so it returns 1 naming the
# cycle (a/x -> a/y -> a/x) rather than recursing forever.
toolchain_order() {
  local u
  local -A toolchain_order_state=()
  local -a toolchain_order_out=()
  for u in "$@"; do
    toolchain_unit_check "$u" || return 1
    toolchain_order_visit "$u" "" || return 1
  done
  [ "${#toolchain_order_out[@]}" -eq 0 ] || printf '%s\n' "${toolchain_order_out[@]}"
}

# toolchain_order's depth-first visit of unit $1, reached by the path $2
# ("a -> b -> "). Uses its caller's toolchain_order_state (1 while the unit
# is being visited, 2 once it is done) and toolchain_order_out.
toolchain_order_visit() {
  local u="$1" path="$2" out d
  local -a deps=()
  case "${toolchain_order_state[$u]:-0}" in
    2) return 0 ;;
    1)
      echo "toolchain-key.sh: the needs of these units form a cycle, so none can be built first: $u -> ${path#*"$u -> "}$u" >&2
      return 1
      ;;
  esac
  toolchain_order_state[$u]=1
  out="$(toolchain_needs "$u")" || return 1
  [ -z "$out" ] || mapfile -t deps <<<"$out"
  for d in "${deps[@]}"; do
    toolchain_order_visit "$d" "$path$u -> " || return 1
  done
  toolchain_order_state[$u]=2
  toolchain_order_out+=("$u")
}

# Prints the knobs of unit $1's build as lines "NAME source" or
# "NAME variant", read from its `env` file, or from $2 when given (the
# report reads a file from another commit). No file means no knobs. This is
# the one parser of a unit's env: the key, the dirty check and the build
# environment all read it through here.
#
# Each line of `env` matches
#   ^([A-Z][A-Z0-9_]*) (source|variant)( +# .*)?$
# and empty lines and lines starting with `#` are ignored. A knob is the only
# variable from the caller's environment that reaches the build besides the
# fixed and transport ones and the dependencies. `variant` changes what the
# build produces (an optimisation level, a target list), so a set variant
# knob is part of the unit's key and makes its build dirty. `source` changes
# only how it is obtained (a mirror) and never the bytes, so it is neither.
# Say why in the comment: whether a knob changes the output is the one thing
# a reviewer must check.
#
# Anything else is an error naming the file and line, never skipped: a tab, a
# carriage return (a file saved on Windows), leading or trailing blanks, a
# lower-case name, an unknown kind, a name declared twice, or a name every
# build already has (a fixed or transport variable, or a DEP_ one). A
# skipped line would be a setting that silently never reaches the build, or
# silently stays out of the key. Every bad line is named, then it returns 1.
toolchain_knobs() {
  local id="${1:?unit}" file="${2:-}" where line shown n=0 bad=0 seen=" "
  if [ -z "$file" ]; then
    where="light/packs/${id%%/*}/toolchains/${id#*/}/env"
    file="$TOOLCHAIN_ROOT/$where"
  else
    where="$file"
  fi
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    case "$line" in '' | '#'*) continue ;; esac
    # The pattern's `.*` would take a carriage return or a tab in the
    # comment: control characters are refused first.
    if [[ "$line" != *[[:cntrl:]]* ]] && [[ "$line" =~ ^([A-Z][A-Z0-9_]*)\ (source|variant)(\ +#\ .*)?$ ]]; then
      if [[ "$seen" == *" ${BASH_REMATCH[1]} "* ]]; then
        echo "toolchain-key.sh: $where:$n: ${BASH_REMATCH[1]} is declared twice" >&2
        bad=1
        continue
      fi
      if toolchain_env_reserved "${BASH_REMATCH[1]}"; then
        echo "toolchain-key.sh: $where:$n: ${BASH_REMATCH[1]} is a variable every build is given (fixed, transport or a dependency's), not a knob" >&2
        bad=1
        continue
      fi
      seen+="${BASH_REMATCH[1]} "
      printf '%s %s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    else
      # A tab or a carriage return is shown for what it is ($'...\t...').
      shown="'$line'"
      [[ "$line" != *[[:cntrl:]]* ]] || shown="$(printf '%q' "$line")"
      echo "toolchain-key.sh: $where:$n: $shown is not 'NAME source|variant  # why'" >&2
      bad=1
    fi
  done <"$file"
  return "$bad"
}

# Prints the lines hashed into unit $1's key (see the header), reading the
# repository TOOLCHAIN_ROOT names: the checkout, or the scratch copy of an
# older commit that pack-store.sh's toolchain-key-report makes. Returns 1
# when the inputs, the needs or the knobs do not resolve, naming why (2 for
# a unit that does not exist).
toolchain_lines() {
  local id="$1" out list path mode i=0 d k rc=0
  local -a specs=() paths=() modes=() regular=() hashes=() deps=()
  toolchain_unit_check "$id" || return
  # Every failure returns explicitly: old_toolchain_key runs this where
  # `set -e` is off, and an empty pathspec list would mean every file. A
  # cycle of needs is refused here, before the recursion below could loop.
  toolchain_order "$id" >/dev/null || return 1
  out="$(toolchain_specs "$id")" || return 1
  mapfile -t specs <<<"$out"
  list="$(mktemp "${TMPDIR:-/tmp}/toolchain-key.XXXXXX")" || return 1
  git -C "$TOOLCHAIN_ROOT" ls-files -co --exclude-standard -z -- "${specs[@]}" >"$list" || { rm -f "$list"; return 1; }
  mapfile -d '' -t paths < <(LC_ALL=C sort -zu "$list")
  rm -f "$list"
  # The format tag: bumped by any change that alters a key (see the header).
  echo "yukibana-toolchain/4"
  echo "unit $id"
  # Modes first, then every regular file hashed by one git process (with the
  # path's filters, so a committed file gives its blob id).
  for path in "${paths[@]}"; do
    case "$path" in *$'\n'*) echo "toolchain-key.sh: a toolchain input's name holds a newline: $path" >&2; return 1 ;; esac
    if [ -L "$TOOLCHAIN_ROOT/$path" ]; then
      mode=120000
    elif [ -f "$TOOLCHAIN_ROOT/$path" ]; then
      if [ -x "$TOOLCHAIN_ROOT/$path" ]; then mode=100755; else mode=100644; fi
      regular+=("$path")
    elif [ ! -e "$TOOLCHAIN_ROOT/$path" ]; then
      mode=- # deleted in the worktree: no longer an input
    else
      echo "toolchain-key.sh: $path is neither a file nor a symlink (a submodule?); a toolchain input must be one" >&2
      return 1
    fi
    modes+=("$mode")
  done
  if [ "${#regular[@]}" -gt 0 ]; then
    out="$(printf '%s\n' "${regular[@]}" | git -C "$TOOLCHAIN_ROOT" hash-object --stdin-paths)" || return 1
    mapfile -t hashes <<<"$out"
  fi
  local r=0
  for i in "${!paths[@]}"; do
    path="${paths[$i]}"
    case "${modes[$i]}" in
      -) ;;
      120000) echo "120000 $(printf '%s' "$(readlink "$TOOLCHAIN_ROOT/$path")" | git -C "$TOOLCHAIN_ROOT" hash-object --stdin) $path" ;;
      *) echo "${modes[$i]} ${hashes[$r]} $path"; r=$((r + 1)) ;;
    esac
  done
  out="$(toolchain_needs "$id")" || return 1
  [ -z "$out" ] || mapfile -t deps <<<"$out"
  out=""
  for d in "${deps[@]}"; do
    k="$(toolchain_key "$d")" || rc=1
    [ "$rc" = 0 ] || return 1
    out+="needs $d $k"$'\n'
  done
  [ -z "$out" ] || printf '%s' "$out" | LC_ALL=C sort
  toolchain_env_lines "$id"
}

# Prints "env NAME=value" for each variant knob of unit $1 that is set in
# this environment, sorted; reads its env file from $2 when given.
toolchain_env_lines() {
  local out name class
  out="$(toolchain_knobs "$1" "${2:-}")" || return 1
  while read -r name class; do
    [ "$class" = variant ] || continue
    [ -n "${!name+x}" ] || continue
    printf 'env %s=%s\n' "$name" "${!name}"
  done <<<"$out" | LC_ALL=C sort
}

# Prints unit $1's key: 40 lower-case hex digits, the first of the sha256 of
# toolchain_lines. Returns 1 when the lines cannot be made (2 for a unit
# that does not exist).
toolchain_key() {
  local lines
  lines="$(toolchain_lines "$1")" || return
  printf '%s\n' "$lines" | sha256sum | cut -c1-40
}
