# shellcheck shell=sh
# Shared by the stub's compilers and vm units (both name it in their paths
# file), so one pack file is an input of two units: editing it re-keys both,
# and libs only through its needs line on compilers.

# Writes the versions file of unit $1 into $OUT: {"<name>":"<version>"}.
stub_versions() {
  printf '{"%s":"%s"}\n' "$2" "$3" > "$OUT/versions-$1.json"
}
