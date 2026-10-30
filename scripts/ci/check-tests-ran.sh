#!/usr/bin/env bash
set -euo pipefail

usage="usage: $(basename "$0") <cargo test log> <module path>..."

if [ "$#" -lt 2 ]; then
  echo "$usage" >&2
  exit 2
fi

log=$1
shift

for module in "$@"; do
  if ! grep -Eq "^test ${module}::[[:alnum:]_:]+ \.\.\. ok$" "$log"; then
    echo "no passing test ran in ${module}" >&2
    exit 1
  fi
done
