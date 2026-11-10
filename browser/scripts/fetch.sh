#!/bin/bash
# Downloads the pinned Firefox source, checks it against Mozilla's published SHA-256 list, and unpacks it into engine/.
set -euo pipefail
. "$(dirname "$0")/env.sh"
mkdir -p "$WORK/dl" "$ENGINE"
base="https://archive.mozilla.org/pub/firefox/releases/$VERSION"
tar_name="firefox-$VERSION.source.tar.xz"
curl -sSL -o "$WORK/dl/$tar_name" "$base/source/$tar_name"
curl -sSL -o "$WORK/dl/SHA256SUMS" "$base/SHA256SUMS"
want="$(grep "source/$tar_name\$" "$WORK/dl/SHA256SUMS" | cut -d' ' -f1)"
got="$(shasum -a 256 "$WORK/dl/$tar_name" | cut -d' ' -f1)"
[ "$want" = "$got" ] || { echo "checksum mismatch: $got != $want" >&2; exit 1; }
nice -n 19 tar -xJf "$WORK/dl/$tar_name" -C "$ENGINE" --strip-components=1
