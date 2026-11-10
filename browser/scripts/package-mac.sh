#!/bin/bash
# Builds the Mac release of AetherDeck (Apple silicon):
#   1. the AetherDeck interface (vite) and the server bundled into one file (esbuild),
#   2. Node (official build, checked against nodejs.org's SHA-256 list) to run that server inside the app,
#   3. the browser itself (branding and the Room copied in, then Mozilla's build),
#   4. the app with Contents/Resources/aetherdeck added, signed ad hoc, in a .dmg, plus its SHA-256.
# Usage: AETHERDECK_WORK=/path/with/40GB browser/scripts/package-mac.sh [--skip-build]
# The result is in $WORK/release/. Signing with a Developer ID and notarizing need an Apple developer account (not done).
set -euo pipefail
. "$(dirname "$0")/env.sh"
REPO="$(cd "$SRC/.." && pwd)"
NODE_VERSION="v26.13.0"
APP_VERSION="$(node -p "require('$REPO/package.json').version")"
OUT="$WORK/release"
STAGE="$WORK/stage"
mkdir -p "$OUT" "$WORK/dl"

echo "== 1. interface and server"
(cd "$REPO" && npx vite build >/dev/null)
rm -rf "$STAGE" && mkdir -p "$STAGE/aetherdeck/server" "$STAGE/aetherdeck/bin"
(cd "$REPO" && npx esbuild server/cli.ts --bundle --platform=node --format=esm --target=node24 --minify-syntax --legal-comments=external \
  --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" \
  --outfile="$STAGE/aetherdeck/server/server.mjs" --log-level=warning)
cp -R "$REPO/dist" "$STAGE/aetherdeck/dist"
cp "$REPO/LICENSE" "$REPO/NOTICE" "$STAGE/aetherdeck/"

echo "== 2. Node $NODE_VERSION"
tgz="node-$NODE_VERSION-darwin-arm64.tar.gz"
[ -f "$WORK/dl/$tgz" ] || curl -fsSL -o "$WORK/dl/$tgz" "https://nodejs.org/dist/$NODE_VERSION/$tgz"
curl -fsSL -o "$WORK/dl/SHASUMS256-node.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
want="$(grep " $tgz\$" "$WORK/dl/SHASUMS256-node.txt" | cut -d' ' -f1)"
got="$(shasum -a 256 "$WORK/dl/$tgz" | cut -d' ' -f1)"
[ -n "$want" ] && [ "$want" = "$got" ] || { echo "Node checksum mismatch: $got != $want" >&2; exit 1; }
tar -xzf "$WORK/dl/$tgz" -C "$STAGE" "node-$NODE_VERSION-darwin-arm64/bin/node" "node-$NODE_VERSION-darwin-arm64/LICENSE"
mv "$STAGE/node-$NODE_VERSION-darwin-arm64/bin/node" "$STAGE/aetherdeck/bin/node"
mv "$STAGE/node-$NODE_VERSION-darwin-arm64/LICENSE" "$STAGE/aetherdeck/bin/NODE-LICENSE"
rm -rf "$STAGE/node-$NODE_VERSION-darwin-arm64"

echo "== 3. browser"
if [ "${1:-}" != "--skip-build" ]; then
  "$SRC/scripts/prepare.sh"
  "$SRC/scripts/mach" build > "$WORK/build-release.log" 2>&1 || { tail -30 "$WORK/build-release.log"; exit 1; }
fi
# The build's own app is symlinks into dist/bin; mach package makes the real, self-contained one in dist/aetherdeck/.
"$SRC/scripts/mach" package > "$WORK/package-release.log" 2>&1 || { tail -30 "$WORK/package-release.log"; exit 1; }
BUILT="$ENGINE/obj-full/dist/aetherdeck/AetherDeck.app"
[ -d "$BUILT" ] || { echo "No built app at $BUILT" >&2; exit 1; }

echo "== 4. app and disk image"
APP="$STAGE/AetherDeck.app"
ditto "$BUILT" "$APP"
cp -R "$STAGE/aetherdeck" "$APP/Contents/Resources/aetherdeck"
xattr -cr "$APP"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
DMG="$OUT/AetherDeck-$APP_VERSION-mac-arm64.dmg"
rm -f "$DMG"
mkdir -p "$STAGE/dmg" && rm -rf "$STAGE/dmg/"* && mv "$APP" "$STAGE/dmg/" && ln -s /Applications "$STAGE/dmg/Applications"
hdiutil create -quiet -volname "AetherDeck" -srcfolder "$STAGE/dmg" -fs HFS+ -format ULFO "$DMG"
(cd "$OUT" && shasum -a 256 "$(basename "$DMG")" > "$(basename "$DMG").sha256")
echo "Done: $DMG"
du -h "$DMG"
