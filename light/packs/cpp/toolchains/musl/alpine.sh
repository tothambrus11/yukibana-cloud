# shellcheck shell=bash
# How the musl unit fetches Alpine's packages, sourced by its toolchain.sh
# after build-lib.sh and the unit's pins.sh. Defines functions only.

# apk_pin <package> <arch>: prints "<package>-<version> <sha256>" for one of
# Alpine's packages, from pins.sh's APK_<NAME>_VERSION and APK_<NAME>_<ARCH>
# (that file says how NAME is spelled); dies when either is not pinned.
apk_pin() {
  local name=${1^^}
  name=${name//+/X}
  name=APK_${name//-/_}
  local version_var=${name}_VERSION sha_var=${name}_${2^^}
  [ -n "${!version_var:-}" ] || die "$1 has no $version_var in pins.sh"
  [ -n "${!sha_var:-}" ] || die "$1 has no $sha_var in pins.sh"
  echo "$1-${!version_var} ${!sha_var}"
}

# fetch_apk <arch> <package-version> <sha256>: prints the path of a verified
# copy of that Alpine package, cached in $CACHE/targets/dl/<arch>/. It is
# taken from $ALPINE_MIRROR/<arch>/ first when that is set (a directory or a
# URL holding copies, for a revision Alpine no longer serves), then from
# ALPINE_REPO; a copy whose SHA-256 differs is named on stderr and skipped.
fetch_apk() {
  local file="$CACHE/targets/dl/$1/$2.apk" from
  mkdir -p "$CACHE/targets/dl/$1"
  if [ ! -f "$file" ] || ! echo "$3  $file" | sha256sum -c --quiet - 2>/dev/null; then
    for from in ${ALPINE_MIRROR:+"$ALPINE_MIRROR"} "$ALPINE_REPO"; do
      rm -f "$file.part"
      case $from in
        http://*|https://*) curl -sSfL -o "$file.part" "$from/$1/$2.apk" || continue ;;
        *) cp "$from/$1/$2.apk" "$file.part" 2>/dev/null || continue ;;
      esac
      echo "$3  $file.part" | sha256sum -c --quiet - 2>/dev/null && break
      echo "$(basename "$0"): checksum mismatch for $from/$1/$2.apk" >&2
      rm -f "$file.part"
    done
    [ -f "$file.part" ] || die "no copy of $1/$2.apk with sha256 $3 (ALPINE_MIRROR=${ALPINE_MIRROR:-unset}, $ALPINE_REPO)"
    mv "$file.part" "$file"
  fi
  echo "$file"
}
