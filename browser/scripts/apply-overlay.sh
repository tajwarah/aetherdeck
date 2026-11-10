#!/bin/bash
# Copies overlay/ (AetherDeck's branding) into the Firefox source. Run before every build.
set -euo pipefail
. "$(dirname "$0")/env.sh"
rsync -a "$SRC/overlay/" "$ENGINE/"
