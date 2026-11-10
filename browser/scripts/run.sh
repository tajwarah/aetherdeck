#!/bin/bash
# Launch AetherDeck on a named profile (default room6). Clears the profile's startup cache first: quick front-end
# rebuilds keep the same build id, so Firefox would otherwise keep running OLD compiled scripts (the Room, its button).
. "$(dirname "$0")/env.sh"
P="$WORK/profiles/${1:-room6}"
mkdir -p "$P"
if pgrep -f "AetherDeck.app/Contents/MacOS/aetherdeck.*$P" >/dev/null; then echo "already running on $P"; exit 0; fi
rm -rf "$P/startupCache"
open -n "$ENGINE/obj-full/dist/AetherDeck.app" --args -profile "$P" -no-remote
