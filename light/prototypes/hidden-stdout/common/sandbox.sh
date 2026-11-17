#!/bin/sh
# The student's side of a split run. It stands in for whatever a real
# grader would use (nsjail, bubblewrap, gVisor, a container per run): what
# matters for the experiment is the three things it takes away.
#
#   * the hidden files: each directory named before `--` is covered by an
#     empty tmpfs in a mount namespace of its own, so they are not merely
#     unreadable but absent;
#   * the trusted process: a new PID namespace with its own /proc, so the
#     student cannot find the harness's pid, let alone read its memory
#     (`/proc/<pid>/mem` needs ptrace rights, which `nobody` would not have
#     over a root process anyway);
#   * the network, so nothing can be sent anywhere but the RPC pipes and
#     stdout.
#
# It then becomes `nobody` with no-new-privs, so the tmpfs cannot be
# unmounted again. Usage: sandbox.sh DIR[:DIR]... -- COMMAND ARG...
set -eu
hide=''
while [ "$#" -gt 0 ] && [ "$1" != '--' ]; do hide="$hide $(printf %s "$1" | tr : " ")"; shift; done
[ "${1:-}" = '--' ] || { echo 'sandbox.sh: no -- before the command' >&2; exit 2; }
shift
exec unshare --mount --pid --fork --mount-proc --net -- /bin/sh -c '
  for d in '"$hide"'; do mount -t tmpfs -o size=4k,mode=0555 none "$d"; done
  exec setpriv --reuid=65534 --regid=65534 --clear-groups --no-new-privs --inh-caps=-all -- "$@"
' sandbox "$@"
