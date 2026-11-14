# shellcheck shell=bash
# What the C/C++ pack's glue (glue.sh) uses and no unit does: named in
# glue.paths only, so an edit here rebuilds no toolchain. Defines functions
# only.

# raw_size <file>: prints <file>'s size in bytes, or 0 when there is none, as
# the workers' progress defines take it (a host that sends .br gives a
# compressed Content-Length, so the decoded size travels in the bundle).
raw_size() {
  stat -c %s "$1" 2>/dev/null || echo 0
}

# sizes_json <dir> <path...>: prints a JSON object of each regular file
# under the paths (relative to <dir>, globs expanded there, .gz and .br
# siblings left out) to its raw size, keys sorted: what TOOLCHAIN_SIZES and
# TARGET_SIZES are defined to. Nothing found prints {}.
sizes_json() {
  local dir=$1 body
  shift
  body=$(cd "$dir" && find "$@" -type f ! -name '*.br' ! -name '*.gz' 2>/dev/null | LC_ALL=C sort |
    while read -r f; do printf '"%s":%s,' "$f" "$(stat -c %s "$f")"; done)
  printf '{%s}\n' "${body%,}"
}
