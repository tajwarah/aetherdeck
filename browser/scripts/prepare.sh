#!/bin/bash
# Turns the unpacked Firefox source into AetherDeck's: branding, the Room, and Mozilla's name and artwork replaced in
# the interface (licence and legal text keep Mozilla's name). Idempotent; run before every build.
set -euo pipefail
. "$(dirname "$0")/env.sh"
"$SRC/scripts/apply-overlay.sh"
"$SRC/scripts/apply-room.sh"
python3 "$SRC/scripts/rebrand-strings.py" "$ENGINE"
python3 "$SRC/scripts/rebrand-art.py" "$ENGINE" "$SRC/overlay/browser/branding/aetherdeck/default256.png"
# AetherDeck's maker and profile folder (these can only be set in the source, not from the mozconfig).
python3 - "$ENGINE/browser/moz.configure" <<'P'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace('imply_option("MOZ_APP_VENDOR", "Mozilla")', 'imply_option("MOZ_APP_VENDOR", "AetherDeck")')
if 'imply_option("MOZ_APP_PROFILE"' not in s:
    s = s.replace('imply_option("MOZ_APP_VENDOR", "AetherDeck")', 'imply_option("MOZ_APP_VENDOR", "AetherDeck")\nimply_option("MOZ_APP_PROFILE", "AetherDeck/Browser")')
assert 'imply_option("MOZ_APP_VENDOR", "AetherDeck")' in s
open(p, "w").write(s)
P
