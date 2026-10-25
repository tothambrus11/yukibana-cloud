# shellcheck shell=bash
# shellcheck source-path=SCRIPTDIR
# What a split pack's toolchain is built from, and its key: the one
# definition of a toolchain's inputs (toolchain_specs), of the settings that
# change its output (toolchain_knobs) and of the lines its key hashes
# (toolchain_lines), so no script keeps a list of its own that could drift.
# The reader of a toolchain unit's declared needs belongs here too, once
# units have them. Sourced, never run, by every script that keys, reports
# on, checks, stages or builds a toolchain (pack-store.sh, pack-toolchain.sh,
# light-packs.yml's once lists); it sources toolchain-build-env.sh itself.
#
# A split pack is one with light/packs/<pack>/toolchain.paths. Its build is
# two halves: the toolchain (compilers, sysroots, runtimes: hours, rarely
# changed), kept in the toolchain store under a key of exactly these inputs,
# and the glue (glue.sh, the pack's JavaScript: seconds, changed often),
# assembled over a fetched toolchain. A glue edit must not change the key,
# and nothing the toolchain reads may be left out of it.
#
# The key is the first 40 hex digits of the sha256 of the lines
#   yukibana-toolchain/1
#   pack <pack>
#   <mode> <git blob id> <path>   each input in the worktree, sorted by path
#   env NAME=value                each set variant knob, sorted
# where the inputs are the files toolchain_specs names, untracked ones
# included and ignored ones not; light/scripts/toolchain-build-env.sh, the
# build environment, is always one of them, so changing it rebuilds every
# toolchain.
#
# This file is not an input of any key, though it decides every key: what it
# computes reaches the key as the resolved lines above, so a comment, a
# rename or a refactor here rebuilds nothing, which is the point of keeping
# it apart from the build environment (cpp's compilers take hours). The
# price is that the key cannot see a change of what it computes. So a
# change that alters any key (another line, another order, another rule
# for what is an input or which knob counts) bumps the format tag on the
# first line, yukibana-toolchain/N, and nothing else: test-pack-store.mjs
# pins the exact lines and key of a fixed pack, and fails until the tag and
# that fixture are updated together. Assembly (pack-toolchain.sh,
# toolchain-manifest.mjs) and the store's helpers (pack-store.sh,
# pack-lib.sh) are part of no key either.
#
# For the same reason nothing that decides what reaches a build is defined
# here: the variables every build gets and the names a knob may not take
# (TOOLCHAIN_ENV_FIXED, TOOLCHAIN_ENV_TRANSPORT, toolchain_env_reserved) are
# toolchain-build-env.sh's alone, and this file, sourced after it, never
# assigns or redefines any of them. A copy here once overrode the keyed one,
# so the allowlist every build saw came from a file no key covers;
# test-pack-store.mjs fails if any name of that file is defined here again.
#
# Functions return non-zero after naming what is wrong on stderr; with
# `set -e` and `shopt -s inherit_errexit`, `x=$(toolchain_specs p)` stops the
# caller there.

# The repository root this copy of the file belongs to. Taken from the file's
# own place (<root>/light/scripts/toolchain-key.sh), so a copy extracted from
# an older commit into a scratch directory (pack-store.sh's key report)
# describes that directory, not the checkout, and keys it with that commit's
# own definition.
TOOLCHAIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=toolchain-build-env.sh
source "$TOOLCHAIN_ROOT/light/scripts/toolchain-build-env.sh"

# Whether the git pathspec $1 is an exclusion (`:!x`, `:^x`, `:(exclude)x`,
# `:(glob,exclude)x`), as opposed to one naming inputs.
toolchain_spec_excludes() {
  local magic
  case "$1" in
    ':!'* | ':^'*) return 0 ;;
    ':('*)
      magic="${1#:(}"
      magic="${magic%%)*}"
      case ",$magic," in *,exclude,*) return 0 ;; esac
      ;;
  esac
  return 1
}

# Prints the git pathspecs of the toolchain of pack $1, one per line, from the
# repository root: the lines of light/packs/<pack>/toolchain.paths, then
# exclusions of the pack's files that are never toolchain inputs
# (toolchain.paths, toolchain.outputs, build.sh, glue.sh, requires.json),
# then light/scripts/toolchain-build-env.sh, the build environment.
#
# toolchain.paths holds one pathspec per line, magic such as `:(exclude)`
# allowed; blank lines and lines starting with `#` are ignored. It fails
# safe: it normally names the whole pack directory and excludes the glue by
# name, so a new file nobody classified counts as an input, which costs a
# rebuild, rather than as glue, which would serve a stale toolchain. For the
# same reason a naming pathspec that matches no file is an error (a typo
# would drop inputs silently), and so is a file naming no input at all (only
# exclusions would leave nothing but the build environment).
#
# Returns 2 when the pack has no toolchain.paths (it is not split), 1 for
# anything wrong in it.
toolchain_specs() {
  local pack="${1:?pack}" dir file line n=0 naming=0 found
  dir="light/packs/$pack"
  file="$TOOLCHAIN_ROOT/$dir/toolchain.paths"
  if [ ! -f "$file" ]; then
    echo "toolchain-key.sh: $pack has no toolchain ($dir/toolchain.paths)" >&2
    return 2
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    case "$line" in '' | '#'*) continue ;; esac
    if ! toolchain_spec_excludes "$line"; then
      naming=$((naming + 1))
      found="$(git -C "$TOOLCHAIN_ROOT" ls-files -co --exclude-standard -- "$line")" || return 1
      if [ -z "$found" ]; then
        echo "toolchain-key.sh: $dir/toolchain.paths:$n: '$line' matches no file" >&2
        return 1
      fi
    fi
    printf '%s\n' "$line"
  done <"$file"
  if [ "$naming" -eq 0 ]; then
    echo "toolchain-key.sh: $dir/toolchain.paths names no input, only exclusions" >&2
    return 1
  fi
  for line in toolchain.paths toolchain.outputs build.sh glue.sh requires.json; do
    printf ':(exclude)%s/%s\n' "$dir" "$line"
  done
  echo light/scripts/toolchain-build-env.sh
}

# Prints the knobs of pack $1's toolchain build as lines "NAME source" or
# "NAME variant", read from light/packs/<pack>/toolchain.env, or from $2 when
# given (the report reads a file from another commit). No file means no
# knobs. This is the one parser of toolchain.env: the key, the dirty check
# and the build environment all read it through here.
#
# Each line of toolchain.env matches
#   ^([A-Z][A-Z0-9_]*) (source|variant)( +# .*)?$
# and empty lines and lines starting with `#` are ignored. A knob is the only
# variable from the caller's environment that reaches the build besides the
# fixed and transport ones. `variant` changes what the build produces (an
# optimisation level, a target list), so a set variant knob is part of the
# toolchain's key and makes its build dirty. `source` changes only how it is
# obtained (a mirror) and never the bytes, so it is neither. Say why in the
# comment: whether a knob changes the output is the one thing a reviewer must
# check.
#
# Anything else is an error naming the file and line, never skipped: a tab, a
# carriage return (a file saved on Windows), leading or trailing blanks, a
# lower-case name, an unknown kind, a name declared twice, or a fixed or
# transport variable's name. A skipped line would be a setting that silently
# never reaches the build, or silently stays out of the key. Every bad line
# is named, then it returns 1.
toolchain_knobs() {
  local pack="${1:?pack}" file="${2:-}" where line shown n=0 bad=0 seen=" "
  if [ -z "$file" ]; then
    file="$TOOLCHAIN_ROOT/light/packs/$pack/toolchain.env"
    where="light/packs/$pack/toolchain.env"
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
        echo "toolchain-key.sh: $where:$n: ${BASH_REMATCH[1]} is a fixed or transport variable of every build, not a knob" >&2
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

# Prints the lines hashed into pack $1's toolchain key (see the header),
# reading the repository TOOLCHAIN_ROOT names: the checkout, or the scratch
# copy of an older commit that pack-store.sh's toolchain-key-report makes.
# Returns 1 when the inputs do not resolve, naming why.
toolchain_lines() {
  local pack="$1" out list path mode i=0
  local -a specs=() paths=() modes=() regular=() hashes=()
  # Every failure returns explicitly: old_toolchain_key runs this where
  # `set -e` is off, and an empty pathspec list would mean every file.
  out="$(toolchain_specs "$pack")" || return 1
  mapfile -t specs <<<"$out"
  list="$(mktemp "${TMPDIR:-/tmp}/toolchain-key.XXXXXX")" || return 1
  git -C "$TOOLCHAIN_ROOT" ls-files -co --exclude-standard -z -- "${specs[@]}" >"$list" || { rm -f "$list"; return 1; }
  mapfile -d '' -t paths < <(LC_ALL=C sort -zu "$list")
  rm -f "$list"
  # The format tag: bumped by any change that alters a key (see the header).
  echo "yukibana-toolchain/1"
  echo "pack $pack"
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
  toolchain_env_lines "$pack"
}

# Prints "env NAME=value" for each variant knob of pack $1 that is set in
# this environment, sorted; reads toolchain.env from $2 when given.
toolchain_env_lines() {
  local out name class
  out="$(toolchain_knobs "$1" "${2:-}")" || return 1
  while read -r name class; do
    [ "$class" = variant ] || continue
    [ -n "${!name+x}" ] || continue
    printf 'env %s=%s\n' "$name" "${!name}"
  done <<<"$out" | LC_ALL=C sort
}

# Prints pack $1's toolchain key: 40 lower-case hex digits, the first of the
# sha256 of toolchain_lines. Returns 1 when the lines cannot be made.
toolchain_key() {
  local lines
  lines="$(toolchain_lines "$1")" || return 1
  printf '%s\n' "$lines" | sha256sum | cut -c1-40
}
