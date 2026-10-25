# shellcheck shell=bash
# What a split pack's toolchain is built from: the one definition of its
# inputs and of the settings that change its output. Sourced, never run, by
# every script that keys, reports on, checks, stages or builds a toolchain
# (pack-store.sh now; pack-toolchain.sh, CI's once lists and setup.sh as
# they arrive), so none of them keeps a list of its own that could drift.
#
# A split pack is one with light/packs/<pack>/toolchain.paths. Its build is
# two halves: the toolchain (compilers, sysroots, runtimes: hours, rarely
# changed), kept in the toolchain store under a key of exactly these inputs,
# and the glue (glue.sh, the pack's JavaScript: seconds, changed often),
# assembled over a fetched toolchain. A glue edit must not change the key,
# and nothing the toolchain reads may be left out of it.
#
# This file is itself an input of every toolchain: changing it rebuilds
# every toolchain, which is right, as it decides what they are built from.
# Assembly (pack-toolchain.sh) is not an input of any.
#
# Functions return non-zero after naming what is wrong on stderr; with
# `set -e` and `shopt -s inherit_errexit`, `x=$(toolchain_specs p)` stops the
# caller there.

# The repository root this copy of the file belongs to. Taken from the file's
# own place (<root>/light/scripts/toolchain-env.sh), so a copy extracted from
# an older commit into a scratch directory (pack-store.sh's key report)
# describes that directory, not the checkout.
TOOLCHAIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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
# then light/scripts/toolchain-env.sh.
#
# toolchain.paths holds one pathspec per line, magic such as `:(exclude)`
# allowed; blank lines and lines starting with `#` are ignored. It fails
# safe: it normally names the whole pack directory and excludes the glue by
# name, so a new file nobody classified counts as an input, which costs a
# rebuild, rather than as glue, which would serve a stale toolchain. For the
# same reason a naming pathspec that matches no file is an error (a typo
# would drop inputs silently), and so is a file naming no input at all (only
# exclusions would leave nothing but this file).
#
# Returns 2 when the pack has no toolchain.paths (it is not split), 1 for
# anything wrong in it.
toolchain_specs() {
  local pack="${1:?pack}" dir file line n=0 naming=0 found
  dir="light/packs/$pack"
  file="$TOOLCHAIN_ROOT/$dir/toolchain.paths"
  if [ ! -f "$file" ]; then
    echo "toolchain-env.sh: $pack has no toolchain ($dir/toolchain.paths)" >&2
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
        echo "toolchain-env.sh: $dir/toolchain.paths:$n: '$line' matches no file" >&2
        return 1
      fi
    fi
    printf '%s\n' "$line"
  done <"$file"
  if [ "$naming" -eq 0 ]; then
    echo "toolchain-env.sh: $dir/toolchain.paths names no input, only exclusions" >&2
    return 1
  fi
  for line in toolchain.paths toolchain.outputs build.sh glue.sh requires.json; do
    printf ':(exclude)%s/%s\n' "$dir" "$line"
  done
  echo light/scripts/toolchain-env.sh
}

# Prints the knobs of pack $1's toolchain build as lines "NAME source" or
# "NAME variant", read from light/packs/<pack>/toolchain.env, or from $2 when
# given (the report reads a file from another commit). No file means no
# knobs.
#
# Each line of toolchain.env is `NAME source|variant  # why`; blank lines and
# lines starting with `#` are ignored. A knob is the only variable from the
# caller's environment that reaches the build besides the fixed and
# transport-only ones. `variant` changes what the build produces (an
# optimisation level, a target list), so a set variant knob is part of the
# toolchain's key. `source` changes only how it is obtained (a mirror, a
# job count) and never the bytes, so it is not. The reason is required:
# whether a knob changes the output is the one thing a reviewer must check.
#
# Every malformed or repeated line is named, then it returns 1.
toolchain_knobs() {
  local pack="${1:?pack}" file="${2:-}" where line n=0 bad=0 seen=" "
  if [ -z "$file" ]; then
    file="$TOOLCHAIN_ROOT/light/packs/$pack/toolchain.env"
    where="light/packs/$pack/toolchain.env"
  else
    where="$file"
  fi
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in '' | '#'*) continue ;; esac
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)[[:space:]]+(source|variant)[[:space:]]+#[[:space:]]*[^[:space:]] ]]; then
      if [[ "$seen" == *" ${BASH_REMATCH[1]} "* ]]; then
        echo "toolchain-env.sh: $where:$n: ${BASH_REMATCH[1]} is declared twice" >&2
        bad=1
        continue
      fi
      seen+="${BASH_REMATCH[1]} "
      printf '%s %s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    else
      echo "toolchain-env.sh: $where:$n: '$line' is not 'NAME source|variant  # why'" >&2
      bad=1
    fi
  done <"$file"
  return "$bad"
}
