#!/usr/bin/env python3
"""Replaces the visible word "Firefox" with "AetherDeck" in en-US UI strings (idempotent). URLs and lowercase paths are left alone."""
import re, sys, pathlib
root = pathlib.Path(sys.argv[1])
pat = re.compile(r'(?<![\w/.\-@:%=?&#])Firefox(?![\w/\-.@:%=?&#])')
n = 0
# Lines that must keep Mozilla's name: licence and legal text, anything with a URL or a placeable for a link.
MOZ_LINE_KEEP = re.compile(r"(http|License|MPL|licen|trademark|Foundation|mozilla\.org|Public)", re.I)
moz = re.compile(r"(?<![\w/.\-@:%=?&#])Mozilla(?![\w/\-.@:%=?&#])")
def fix(text):
    out = []
    for line in text.split("\n"):
        if not MOZ_LINE_KEEP.search(line):
            line = moz.sub("AetherDeck", line)
        out.append(line)
    return "\n".join(out)
for d in ["browser/locales/en-US", "toolkit/locales/en-US", "browser/extensions/newtab/webext-glue"]:
    base = root / d
    if not base.exists(): continue
    for f in base.rglob("*"):
        if f.suffix not in (".ftl", ".properties", ".dtd", ".inc") or not f.is_file(): continue
        s = f.read_text(encoding="utf-8", errors="ignore")
        t = fix(pat.sub("AetherDeck", s))
        if t != s:
            f.write_text(t, encoding="utf-8"); n += 1
print("files changed:", n)
