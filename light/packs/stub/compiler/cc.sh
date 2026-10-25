#!/bin/sh
# The stub's "compiler": prints a library made of its input, stamped with
# the compiler's version, so a library built by another compiler differs.
printf 'built by cc %s from:\n' "$STUB_CC_VERSION"
cat "$1"
