import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { storeIdOf, unzip, zipOfCrx } from "../../shared/crx.ts";

/** A zip of these files, deflated, built by hand the way any zip tool lays one out. */
function zipOf(files: Record<string, string>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const packed = deflateRawSync(data);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, packed);
    centrals.push(central, n);
    offset += 30 + n.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

describe("Chrome extension files", () => {
  const files = { "manifest.json": '{"name":"Test","version":"1.0","manifest_version":3}', "popup/popup.html": "<p>hi</p>" };

  it("unpacks a CRX3: its header skipped, its zip read", () => {
    const zip = zipOf(files);
    const header = Buffer.from("signed header bytes");
    const crx = Buffer.concat([Buffer.from("Cr24"), Buffer.from([3, 0, 0, 0]), Buffer.from(Uint32Array.of(header.length).buffer), header, zip]);
    const out = unzip(zipOfCrx(crx));
    expect([...out.keys()]).toEqual(["manifest.json", "popup/popup.html"]);
    expect(out.get("popup/popup.html")!.toString()).toBe("<p>hi</p>");
  });

  it("refuses files that would land outside the extension's folder", () => {
    expect(() => unzip(zipOf({ "../outside.txt": "no" }))).toThrow(/outside its folder/);
    expect(() => unzip(zipOf({ "/etc/passwd": "no" }))).toThrow(/outside its folder/);
    expect(() => zipOfCrx(Buffer.from("not an extension"))).toThrow();
  });

  it("finds the extension in a store link or a bare id", () => {
    const id = "eimadpbcbfnmbkopoojfekhnkhdbieeh";
    expect(storeIdOf(`https://chromewebstore.google.com/detail/dark-reader/${id}`)).toBe(id);
    expect(storeIdOf(`https://chromewebstore.google.com/detail/dark-reader/${id}?hl=en`)).toBe(id);
    expect(storeIdOf(id)).toBe(id);
    expect(storeIdOf("https://example.com/")).toBeNull();
  });
});
