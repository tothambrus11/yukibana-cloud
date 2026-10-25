# shellcheck shell=bash
# This file is the build environment of every toolchain. Its blob is a line
# of every toolchain's key, so changing it, a comment included, rebuilds all
# of them. Keep in it only what reaches a toolchain.sh.
#
# What reaches a split pack's toolchain build: the variables passed through
# from the caller (fixed, transport and declared knobs), the one value
# derived from them for the JVM, and the stage the build runs in. These shape
# what a build produces, and nothing else records them, so they are keyed as
# a file: an honest rebuild when the environment changes, never a toolchain
# built in one environment served for another.
#
# What a toolchain is built from (its inputs, its knobs, the key's lines) is
# not here but in toolchain-key.sh, which is not keyed by blob: everything
# it computes is already in the key as resolved lines, so a comment or a
# refactor there rebuilds nothing, and a deliberate change of what it
# computes bumps the key's format tag. Helpers shared by the store scripts
# are in pack-lib.sh, which is part of no key. A helper added here would
# rebuild every toolchain, cpp's hours-long compilers included: put it in
# one of those two instead unless a build reads it.
#
# Sourced, never run: by toolchain-key.sh (and so by pack-store.sh and
# pack-toolchain.sh), and by a toolchain.sh from its staged copy for
# toolchain_jvm_proxy_opts, which therefore needs nothing but this file.
# toolchain_env_args and toolchain_stage call toolchain_knobs and
# toolchain_specs, so they need toolchain-key.sh sourced as well; a staged
# toolchain.sh calls neither. This file sets no variable but the two arrays
# below, so it cannot clash with a toolchain's own scripts.
#
# Functions return non-zero after naming what is wrong on stderr; with
# `set -e` and `shopt -s inherit_errexit`, `x=$(toolchain_env_args p)` stops
# the caller there.

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
      *$'\n'*) echo "toolchain-build-env.sh: $name holds a newline; it cannot reach a toolchain build" >&2; return 1 ;;
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
      echo "toolchain-build-env.sh: cannot read a host and port from the proxy $(printf '%q' "$proxy")" >&2
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
      echo "toolchain-build-env.sh: SSL_CERT_FILE is set but there is no keytool to make the JVM's truststore of it" >&2
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
        echo "toolchain-build-env.sh: keytool refused certificate $n of $SSL_CERT_FILE" >&2
        rm -rf "$dir"
        return 1
      fi
    done
    rm -rf "$dir"
    if [ "$n" -eq 0 ]; then
      echo "toolchain-build-env.sh: SSL_CERT_FILE ($SSL_CERT_FILE) holds no certificate" >&2
      return 1
    fi
    opts+=" -Djavax.net.ssl.trustStore=$stage/truststore.p12 -Djavax.net.ssl.trustStorePassword=changeit -Djavax.net.ssl.trustStoreType=PKCS12"
  fi
  opts="${opts# }"
  # The pattern above, in POSIX classes: bash's =~ has no \S.
  if ! [[ "$opts" =~ ^(\ ?-D(https?\.(proxyHost|proxyPort|nonProxyHosts)|javax\.net\.ssl\.trustStore(Password|Type)?)=[^[:space:]]+)*$ ]]; then
    echo "toolchain-build-env.sh: the JVM flags derived from the proxy settings are not plain -Dname=value flags: $(printf '%q' "$opts")" >&2
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
# worktree is no longer an input and is not copied. The repository is the one
# TOOLCHAIN_ROOT names (toolchain-key.sh).
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
  ) || { echo "toolchain-build-env.sh: could not stage the toolchain of $pack in $dest" >&2; return 1; }
}
