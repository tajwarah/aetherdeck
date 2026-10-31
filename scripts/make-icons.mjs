// Makes every icon from build/icon.svg: .icns for macOS, .ico for Windows, a set of PNGs for Linux.
// Needs rsvg-convert, and on macOS iconutil. The results are kept in the repository; run this when the icon changes.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const png = (svg, size, out) => execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), "-o", out, svg]);
// Windows and Linux have no margin around their icons: the same art, cropped to fill the square.
const master = readFileSync("build/icon.svg", "utf8");
const work = mkdtempSync(join(tmpdir(), "horus-icons-"));
const full = join(work, "full.svg");
writeFileSync(full, master.replace('viewBox="0 0 1024 1024"', 'viewBox="84 84 856 856"'));

png("build/icon.svg", 1024, "build/icon.png");
mkdirSync("build/icons", { recursive: true });
for (const s of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) png(full, s, `build/icons/${s}x${s}.png`);

const set = join(work, "icon.iconset");
mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  png("build/icon.svg", s, join(set, `icon_${s}x${s}.png`));
  png("build/icon.svg", s * 2, join(set, `icon_${s}x${s}@2x.png`));
}
execFileSync("iconutil", ["-c", "icns", set, "-o", "build/icon.icns"]);

// An .ico is a small directory followed by PNGs.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((s) => readFileSync(`build/icons/${s}x${s}.png`));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let at = head.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  head[e] = s === 256 ? 0 : s;
  head[e + 1] = s === 256 ? 0 : s;
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(images[i].length, e + 8);
  head.writeUInt32LE(at, e + 12);
  at += images[i].length;
});
writeFileSync("build/icon.ico", Buffer.concat([head, ...images]));
rmSync(work, { recursive: true });
