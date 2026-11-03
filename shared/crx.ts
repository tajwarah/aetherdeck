// Chrome extension files, unpacked: a CRX is a signed header and then a zip. Pure, so it can be tested on its own;
// electron/extensions.ts uses it to install from the Chrome Web Store.
import { isAbsolute, normalize } from "node:path";
import { inflateRawSync } from "node:zlib";

const MAX_UNPACKED = 300 * 1024 * 1024;

/** The zip inside a CRX (versions 2 and 3), or the file itself when it's already a zip. */
export function zipOfCrx(buf: Buffer): Buffer {
  if (buf.subarray(0, 4).toString("latin1") === "PK\u0003\u0004") return buf;
  if (buf.subarray(0, 4).toString("latin1") !== "Cr24") throw new Error("This isn't a Chrome extension file.");
  const version = buf.readUInt32LE(4);
  if (version === 3) return buf.subarray(12 + buf.readUInt32LE(8));
  if (version === 2) return buf.subarray(16 + buf.readUInt32LE(8) + buf.readUInt32LE(12));
  throw new Error(`Unknown extension file version ${version}.`);
}

/** Every file of a zip, by its path inside it. Refuses paths that would land outside the folder, and zip bombs. */
export function unzip(zip: Buffer): Map<string, Buffer> {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("The extension's archive is damaged.");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  if (count > 20000) throw new Error("The extension has too many files.");
  const files = new Map<string, Buffer>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("The extension's archive is damaged.");
    const method = zip.readUInt16LE(at + 10);
    const packed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const clean = normalize(name).replace(/\\/g, "/");
    if (isAbsolute(clean) || clean.startsWith("../") || clean === ".." || name.includes("\\")) throw new Error(`The extension has a file outside its folder: ${name}`);
    if (packed === 0xffffffff || size === 0xffffffff) throw new Error("The extension's archive is too large.");
    total += size;
    if (total > MAX_UNPACKED) throw new Error("The extension unpacks to more than 300 MB.");
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error("The extension's archive is damaged.");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + packed);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw, { maxOutputLength: size + 1 }) : null;
    if (!data) throw new Error(`The extension uses a compression Warpnaut can't read (${method}).`);
    if (data.length !== size) throw new Error("The extension's archive is damaged.");
    files.set(clean, data);
  }
  return files;
}

/** A Chrome Web Store extension's id, from its id or any link to it. */
export const storeIdOf = (text: string) => text.match(/(?:^|[/?=])([a-p]{32})(?:$|[/?#&])/)?.[1] ?? (/^[a-p]{32}$/.test(text.trim()) ? text.trim() : null);

