#!/bin/bash
# Starts a COPY of Firefox (never your installed one) with a throwaway profile and the Room script. See README.md.
# usage: firefox/run-spike.sh /path/to/Firefox.app [profile-dir]
#   room.uc.js = Stage 0 (own browser elements). Stage 1 (real tabs) became AetherDeck for Mac: see browser/README.md.
set -e
APP="$1"; PROFILE="${2:-/tmp/aetherdeck-ff-profile}"
HERE="$(cd "$(dirname "$0")" && pwd)"
RES="$APP/Contents/Resources"
mkdir -p "$RES/defaults/pref" "$PROFILE"
cp "$HERE/config-prefs.js" "$RES/defaults/pref/config-prefs.js"
cp "$HERE/config.js" "$RES/config.js"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true   # editing the bundle voids Mozilla's signature
cat > "$PROFILE/user.js" <<P
user_pref("browser.dom.window.dump.enabled", true);
user_pref("devtools.chrome.enabled", true);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("startup.homepage_welcome_url", "");
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
P
# Start through LaunchServices: run directly from a shell, this Firefox never gets as far as opening a window on macOS 27.
# Remote control (Marionette) makes the browser report navigator.webdriver=true, and Google refuses to sign in
# automated browsers ("This browser or app may not be secure"). So it is OFF unless you ask: AD_MARIONETTE=1.
if [ "$AD_MARIONETTE" = "1" ]; then
  open -n "$APP" --env AD_ROOM_DIR="$HERE" --env AD_ROOM_SCRIPT="${AD_ROOM_SCRIPT:-room.uc.js}" --env MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 --args --profile "$PROFILE" --no-remote --marionette about:blank
else
  open -n "$APP" --env AD_ROOM_DIR="$HERE" --env AD_ROOM_SCRIPT="${AD_ROOM_SCRIPT:-room.uc.js}" --args --profile "$PROFILE" --no-remote about:blank
fi
