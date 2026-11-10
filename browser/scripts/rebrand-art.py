#!/usr/bin/env python3
"""Replaces Mozilla/Firefox artwork (fox mascots, Firefox and Mozilla logos) with the AetherDeck mark, keeping each file's size.
Idempotent. Placeholder art: swap in designed artwork later."""
import base64, pathlib, re, subprocess, sys, tempfile, os
root = pathlib.Path(sys.argv[1]); icon = pathlib.Path(sys.argv[2])
tmp = pathlib.Path(tempfile.mkdtemp())
small = tmp / "i128.png"
subprocess.run(["sips", "-z", "128", "128", str(icon), "--out", str(small)], capture_output=True)
b64 = base64.b64encode(small.read_bytes()).decode()
name_re = re.compile(r"(fox|firefox|mozilla|mascot|^kit-)", re.I)
skip = re.compile(r"(/test|/tests|node_modules|obj-full|/docs/|storybook|/branding/|/installer/|aetherdeck|tippytop|mask)", re.I)
n = 0
for d in ["browser", "toolkit"]:
    for f in (root / d).rglob("*"):
        if not f.is_file() or f.suffix.lower() not in (".svg", ".png", ".webp", ".jpg"): continue
        if not name_re.search(f.name) or skip.search(str(f.relative_to(root))): continue
        if f.suffix.lower() == ".svg":
            s = f.read_text(encoding="utf-8", errors="ignore")
            if "aetherdeck-art" in s: continue
            m = re.search(r'viewBox="([\d.\-\s,]+)"', s)
            vb = m.group(1).replace(",", " ").split() if m else ["0", "0", "100", "100"]
            w, h = float(vb[2]), float(vb[3]); side = min(w, h)
            f.write_text(f'<!-- aetherdeck-art --><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="{vb[0]} {vb[1]} {vb[2]} {vb[3]}"><image x="{float(vb[0]) + (w - side) / 2}" y="{float(vb[1]) + (h - side) / 2}" width="{side}" height="{side}" xlink:href="data:image/png;base64,{b64}"/></svg>', encoding="utf-8")
        else:
            out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(f)], capture_output=True, text=True).stdout
            try:
                pw = int(re.search(r"pixelWidth: (\d+)", out).group(1)); ph = int(re.search(r"pixelHeight: (\d+)", out).group(1))
            except Exception: continue
            side = max(pw, ph)
            subprocess.run(["sips", "-z", str(side), str(side), str(icon), "--out", str(f)], capture_output=True)
            if (pw, ph) != (side, side): subprocess.run(["sips", "-z", str(ph), str(pw), str(f)], capture_output=True)
        n += 1
print("artwork files replaced:", n)
