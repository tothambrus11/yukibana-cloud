# shellcheck shell=bash
# This file is the build environment of every toolchain. Changing it rebuilds
# all of them.
#
# What a split pack's toolchain is built from, and what reaches its build: the
# one definition of its inputs, of the settings that change its output, and
# of the environment its toolchain.sh runs in. Sourced, never run, by every
# script that keys, reports on, checks, stages or builds a toolchain
# (pack-store.sh, pack-toolchain.sh; CI's once lists and setup.sh as they
# arrive), so none of them keeps a list of its own that could drift. A
# toolchain.sh may source its staged copy too, for toolchain_jvm_proxy_opts.
#
# A split pack is one with light/packs/<pack>/toolchain.paths. Its build is
# two halves: the toolchain (compilers, sysroots, runtimes: hours, rarely
# changed), kept in the toolchain store under a key of exactly these inputs,
# and the glue (glue.sh, the pack's JavaScript: seconds, changed often),
# assembled over a fetched toolchain. A glue edit must not change the key,
# and nothing the toolchain reads may be left out of it.
#
# This file is itself an input of every toolchain, which is right, as it
# decides what they are built from and in. Assembly (pack-toolchain.sh,
# toolchain-manifest.mjs) is not an input of any.
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

# The variables of the caller's environment that reach every toolchain
# build, by name when they are set, and the ones set to a fixed value
# (NAME=value) whatever the caller has. They say where things are (PATH,
# HOME, TMPDIR, OUT, PACK_CACHE), how hard to work (JOBS, NICE), whether this
# is CI and how to reach GitHub (CI, GH_TOKEN), never what to build: a build
# script must give the same bytes whatever they are, and PATH is the
# caller's so a build finds the tools deps.apt and setup.sh installed.
# LANG is fixed so no tool's output depends on the caller's locale.
# Read-only: a knob of the same name is refused by toolchain_knobs.
TOOLCHAIN_ENV_FIXED=(PATH HOME TMPDIR CI GH_TOKEN OUT PACK_CACHE JOBS NICE LANG=C.UTF-8)

# The variables that only carry bytes to the build, passed when set: the
# proxy and no-proxy settings in both cases, and the CA bundles that let a
# TLS-intercepting proxy be trusted. They cannot change outputs, because
# every download a toolchain.sh makes is pinned by sha256 (pins.sh): through
# any proxy, with any CA, a download either has the pinned bytes or the build
# fails. That is why they are not part of any key, and why a build behind a
# proxy is still clean.
TOOLCHAIN_ENV_TRANSPORT=(
  HTTPS_PROXY https_proxy HTTP_PROXY http_proxy ALL_PROXY all_proxy
  NO_PROXY no_proxy
  SSL_CERT_FILE SSL_CERT_DIR CURL_CA_BUNDLE REQUESTS_CA_BUNDLE GIT_SSL_CAINFO
  NODE_EXTRA_CA_CERTS
  npm_config_https_proxy npm_config_proxy npm_config_cafile
)

# Whether $1 names a fixed or transport variable (one a knob may not be).
toolchain_env_reserved() {
  local v
  for v in "${TOOLCHAIN_ENV_FIXED[@]}" "${TOOLCHAIN_ENV_TRANSPORT[@]}"; do
    [ "${v%%=*}" != "$1" ] || return 0
  done
  return 1
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
        echo "toolchain-env.sh: $where:$n: ${BASH_REMATCH[1]} is declared twice" >&2
        bad=1
        continue
      fi
      if toolchain_env_reserved "${BASH_REMATCH[1]}"; then
        echo "toolchain-env.sh: $where:$n: ${BASH_REMATCH[1]} is a fixed or transport variable of every build, not a knob" >&2
        bad=1
        continue
      fi
      seen+="${BASH_REMATCH[1]} "
      printf '%s %s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    else
      # A tab or a carriage return is shown for what it is ($'...\t...').
      shown="'$line'"
      [[ "$line" != *[[:cntrl:]]* ]] || shown="$(printf '%q' "$line")"
      echo "toolchain-env.sh: $where:$n: $shown is not 'NAME source|variant  # why'" >&2
      bad=1
    fi
  done <"$file"
  return "$bad"
}

# Prints the arguments that, after `env -i`, give pack $1's toolchain.sh its
# whole environment, one NAME=value per line: the fixed variables (those set
# here, and LANG=C.UTF-8), the transport variables that are set, and every
# declared knob that is set, source and variant alike. Nothing else reaches a
# build: a variable the pack does not declare is dropped, so it can neither
# change an output behind the key's back nor leak into a log. OUT is among
# the fixed variables, so the caller adds its own OUT=... after these.
#
# Read with `mapfile -t`; a value holding a newline cannot be one line and is
# refused (returns 1), as is a malformed toolchain.env.
toolchain_env_args() {
  local pack="${1:?pack}" out v name
  local -a names=()
  out="$(toolchain_knobs "$pack")" || return 1
  for v in "${TOOLCHAIN_ENV_FIXED[@]}"; do
    case "$v" in *=*) printf '%s\n' "$v"; continue ;; esac
    names+=("$v")
  done
  names+=("${TOOLCHAIN_ENV_TRANSPORT[@]}")
  if [ -n "$out" ]; then
    while read -r name _; do names+=("$name"); done <<<"$out"
  fi
  for name in "${names[@]}"; do
    [ -n "${!name+x}" ] || continue
    case "${!name}" in
      *$'\n'*) echo "toolchain-env.sh: $name holds a newline; it cannot reach a toolchain build" >&2; return 1 ;;
    esac
    printf '%s=%s\n' "$name" "${!name}"
  done
}

# Prints the JVM flags (-Dname=value, separated by single spaces, or nothing)
# that make Gradle, sbt and every other JVM a toolchain.sh starts use the
# transport variables: a pure function of them, so a build behind a proxy
# needs no knob and keeps its key. java and scala's toolchain.sh export it
# as JAVA_TOOL_OPTIONS.
#
#   HTTPS_PROXY (or https_proxy)  -Dhttps.proxyHost, -Dhttps.proxyPort and the
#       same two for http: the host and port of the URL, any user and path
#       dropped; a URL without a port gets its scheme's (80, 443; 1080, as
#       curl, without a scheme).
#   NO_PROXY (or no_proxy)        -Dhttp.nonProxyHosts, its commas turned to
#       `|` and a leading `.` to `*.`, the JVM's form of the same list.
#   SSL_CERT_FILE                 a PKCS12 truststore of every certificate in
#       that bundle, built with keytool as $1/truststore.p12 (password
#       changeit), and -Djavax.net.ssl.trustStore, ...Password and ...Type.
#       keytool takes one certificate per run, so this takes about a second
#       per certificate; $1 is the build's stage, removed after it.
#
# The result must match
#   ^( ?-D(https?\.(proxyHost|proxyPort|nonProxyHosts)|javax\.net\.ssl\.trustStore(Password|Type)?)=\S+)*$
# or it returns 1 naming it: JAVA_TOOL_OPTIONS is split on blanks, so a value
# with one would pass something else to every JVM of the build.
toolchain_jvm_proxy_opts() {
  local stage="${1:?stage directory}" proxy="${HTTPS_PROXY:-${https_proxy:-}}"
  local no="${NO_PROXY:-${no_proxy:-}}" opts="" rest host port scheme item list="" n=0 dir
  if [ -n "$proxy" ]; then
    scheme=""
    rest="$proxy"
    case "$rest" in *://*) scheme="${rest%%://*}"; rest="${rest#*://}" ;; esac
    rest="${rest%%/*}"
    rest="${rest##*@}"
    if [[ "$rest" =~ ^\[([^]]*)\](:([0-9]+))?$ ]] || [[ "$rest" =~ ^([^:]*)(:([0-9]+))?$ ]]; then
      host="${BASH_REMATCH[1]}"
      port="${BASH_REMATCH[3]}"
    else
      echo "toolchain-env.sh: cannot read a host and port from the proxy $(printf '%q' "$proxy")" >&2
      return 1
    fi
    if [ -z "$port" ]; then
      case "$scheme" in http) port=80 ;; https) port=443 ;; *) port=1080 ;; esac
    fi
    opts+=" -Dhttps.proxyHost=$host -Dhttps.proxyPort=$port -Dhttp.proxyHost=$host -Dhttp.proxyPort=$port"
  fi
  if [ -n "$no" ]; then
    local -a items=()
    IFS=, read -r -a items <<<"$no"
    for item in "${items[@]}"; do
      item="${item//[[:space:]]/}"
      [ -n "$item" ] || continue
      case "$item" in .*) item="*$item" ;; esac
      list+="${list:+|}$item"
    done
    [ -z "$list" ] || opts+=" -Dhttp.nonProxyHosts=$list"
  fi
  if [ -n "${SSL_CERT_FILE:-}" ]; then
    if ! command -v keytool >/dev/null; then
      echo "toolchain-env.sh: SSL_CERT_FILE is set but there is no keytool to make the JVM's truststore of it" >&2
      return 1
    fi
    dir="$(mktemp -d "$stage/truststore.XXXXXX")" || return 1
    # One file per certificate of the bundle.
    awk -v d="$dir" '/-----BEGIN CERTIFICATE-----/ { n++; f = sprintf("%s/%05d.pem", d, n) } f { print > f } /-----END CERTIFICATE-----/ { close(f); f = "" }' "$SSL_CERT_FILE" || return 1
    rm -f "$stage/truststore.p12"
    for item in "$dir"/*.pem; do
      [ -e "$item" ] || continue
      n=$((n + 1))
      # JAVA_TOOL_OPTIONS of the caller would only add noise, and the
      # caller's own truststore must not be what is read.
      if ! JAVA_TOOL_OPTIONS='' keytool -importcert -noprompt -alias "ca-$n" -file "$item" \
        -keystore "$stage/truststore.p12" -storetype PKCS12 -storepass changeit >/dev/null 2>&1; then
        echo "toolchain-env.sh: keytool refused certificate $n of $SSL_CERT_FILE" >&2
        rm -rf "$dir"
        return 1
      fi
    done
    rm -rf "$dir"
    if [ "$n" -eq 0 ]; then
      echo "toolchain-env.sh: SSL_CERT_FILE ($SSL_CERT_FILE) holds no certificate" >&2
      return 1
    fi
    opts+=" -Djavax.net.ssl.trustStore=$stage/truststore.p12 -Djavax.net.ssl.trustStorePassword=changeit -Djavax.net.ssl.trustStoreType=PKCS12"
  fi
  opts="${opts# }"
  # The pattern above, in POSIX classes: bash's =~ has no \S.
  if ! [[ "$opts" =~ ^(\ ?-D(https?\.(proxyHost|proxyPort|nonProxyHosts)|javax\.net\.ssl\.trustStore(Password|Type)?)=[^[:space:]]+)*$ ]]; then
    echo "toolchain-env.sh: the JVM flags derived from the proxy settings are not plain -Dname=value flags: $(printf '%q' "$opts")" >&2
    return 1
  fi
  printf '%s\n' "$opts"
}

# Copies into directory $2 (made if missing) exactly the files of pack $1's
# toolchain: those `toolchain_specs` names, untracked ones included and
# ignored ones not, at their paths from the repository root, with their
# modes and symlinks. A toolchain.sh runs in such a copy, so a file it reads
# that is no input (the glue, build.sh) is simply not there and the build
# fails, rather than the key missing an input. A file deleted in the
# worktree is no longer an input and is not copied.
toolchain_stage() {
  local pack="${1:?pack}" dest="${2:?stage directory}" out
  local -a specs=()
  out="$(toolchain_specs "$pack")" || return 1
  mapfile -t specs <<<"$out"
  mkdir -p "$dest" || return 1
  (
    set -o pipefail
    git -C "$TOOLCHAIN_ROOT" ls-files -co --exclude-standard -z -- "${specs[@]}" |
      while IFS= read -r -d '' path; do
        if [ -e "$TOOLCHAIN_ROOT/$path" ] || [ -L "$TOOLCHAIN_ROOT/$path" ]; then printf '%s\0' "$path"; fi
      done |
      tar -C "$TOOLCHAIN_ROOT" --null --no-recursion -T - -cf - |
      tar -C "$dest" -xf -
  ) || { echo "toolchain-env.sh: could not stage the toolchain of $pack in $dest" >&2; return 1; }
}
