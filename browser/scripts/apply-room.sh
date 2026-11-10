#!/bin/bash
# Puts the Room into the Firefox source: copies room-src/ and wires it into browser.xhtml and components/moz.build (idempotent).
set -euo pipefail
. "$(dirname "$0")/env.sh"
rsync -a "$SRC/room-src/" "$ENGINE/"
python3 - "$ENGINE" <<'P'
import sys
e=sys.argv[1]
p=e+"/browser/base/content/browser.xhtml"; s=open(p).read()
tag='  <script src="chrome://browser/content/aetherdeck/room-loader.js"></script>\n'
if tag not in s:
    a='  <script src="chrome://browser/content/browser-main.js"></script>\n'
    assert a in s; open(p,'w').write(s.replace(a,a+tag))
p=e+"/browser/components/moz.build"; s=open(p).read()
if '"aetherdeck",' not in s:
    assert '    "aboutlogins",\n' in s; open(p,'w').write(s.replace('    "aboutlogins",\n','    "aboutlogins",\n    "aetherdeck",\n',1))
P
# Remove Mozilla's "Add-ons for Firefox" default top site from the new tab page.
sed -i.orig 's#,https://addons.mozilla.org##g' "$ENGINE/browser/extensions/newtab/lib/DefaultSites.sys.mjs" && rm -f "$ENGINE/browser/extensions/newtab/lib/DefaultSites.sys.mjs.orig"
