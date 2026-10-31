import { describe, expect, it } from "vitest";
import { clipboardMessage, displayMessage, h264Codec, KEY, keyMessage, resetVideoMessage, rotateMessage, RtpH264, ScrcpyVideo, scrollMessage, textMessage, touchMessage, type Frame, type VideoEvent } from "../../shared/phone.ts";

const hello = (name: string, codec = 0x68323634) => {
  const b = new Uint8Array(69);
  b.set(new TextEncoder().encode(name), 1);
  new DataView(b.buffer).setUint32(65, codec);
  return b;
};
const session = (w: number, h: number) => { const b = new Uint8Array(12); b[0] = 0x80; const v = new DataView(b.buffer); v.setUint32(4, w); v.setUint32(8, h); return b; };
const packet = (flags: number, pts: bigint, data: number[]) => { const b = new Uint8Array(12 + data.length); const v = new DataView(b.buffer); v.setBigUint64(0, (BigInt(flags) << 56n) | pts); v.setUint32(8, data.length); b.set(data, 12); return b; };

describe("scrcpy's video stream", () => {
  const read = (...chunks: Uint8Array[]) => { const out: VideoEvent[] = []; const p = new ScrcpyVideo((e) => out.push(e)); chunks.forEach((c) => p.push(c)); return out; };
  it("reads the device, the size and a picture", () => {
    const e = read(hello("Pixel 9"), session(1080, 2400), packet(0x20, 5n, [1, 2, 3]));
    expect(e[0]).toEqual({ kind: "device", name: "Pixel 9" });
    expect(e[1]).toEqual({ kind: "size", width: 1080, height: 2400 });
    expect(e[2]).toMatchObject({ kind: "frame", frame: { key: true, pts: 5 } });
  });
  it("puts the decoder settings in front of the next picture", () => {
    const e = read(hello("x"), session(1, 1), packet(0x40, 0n, [9, 9]), packet(0, 7n, [1]));
    expect(e.filter((x) => x.kind === "frame")).toHaveLength(1);
    expect([...(e[2] as { frame: Frame }).frame.data]).toEqual([9, 9, 1]);
  });
  it("copes with data split at any point", () => {
    const all = new Uint8Array([...hello("x"), ...session(4, 8), ...packet(0, 3n, [7, 7, 7, 7])]);
    const bytes = [...all].map((b) => Uint8Array.of(b));
    expect(read(...bytes).map((e) => e.kind)).toEqual(["device", "size", "frame"]);
  });
  it("reports a stream it can't read", () => expect(() => read(hello("x", 0x00617631))).toThrow(/format/));
});

describe("control messages match scrcpy's layout", () => {
  it("touch", () => {
    const m = touchMessage("down", 100, 200, 1080, 2400);
    const v = new DataView(m.buffer);
    expect(m.length).toBe(32);
    expect([m[0], m[1]]).toEqual([2, 0]);
    expect(v.getBigUint64(2)).toBe(0xfffffffffffffffen);
    expect([v.getUint32(10), v.getUint32(14), v.getUint16(18), v.getUint16(20), v.getUint16(22)]).toEqual([100, 200, 1080, 2400, 0xffff]);
    expect(new DataView(touchMessage("up", 1, 1, 1, 1).buffer).getUint16(22)).toBe(0);
  });
  it("key", () => {
    const m = keyMessage("up", KEY.home);
    expect(m.length).toBe(14);
    expect([m[0], m[1], new DataView(m.buffer).getUint32(2)]).toEqual([0, 1, 3]);
  });
  it("text, cut at the server's limit", () => {
    const m = textMessage("hé");
    expect([m[0], new DataView(m.buffer).getUint32(1), m.length]).toEqual([1, 3, 8]);
    expect(textMessage("x".repeat(500)).length).toBe(305);
  });
  it("scroll", () => {
    const m = scrollMessage(5, 6, 100, 200, 0, -16);
    const v = new DataView(m.buffer);
    expect(m.length).toBe(21);
    expect([m[0], v.getUint32(1), v.getUint32(5), v.getUint16(9), v.getUint16(11), v.getInt16(13), v.getInt16(15)]).toEqual([3, 5, 6, 100, 200, 0, -32768]);
  });
  it("clipboard, pasted", () => {
    const m = clipboardMessage("hi");
    expect([m[0], m[9], new DataView(m.buffer).getUint32(10), m.length]).toEqual([9, 1, 2, 16]);
  });
  it("the one-byte commands", () => {
    expect([...displayMessage(false)]).toEqual([10, 0]);
    expect([...rotateMessage()]).toEqual([11]);
    expect([...resetVideoMessage()]).toEqual([17]);
  });
});

describe("AirPlay's RTP video", () => {
  const rtp = (seq: number, marker: boolean, body: number[]) => { const b = new Uint8Array(12 + body.length); b[0] = 0x80; b[1] = marker ? 0xe0 : 0x60; new DataView(b.buffer).setUint16(2, seq); b.set(body, 12); return b; };
  const sps = [0x67, 0x42, 0, 0x1f, 1];
  const idr = [0x65, 1, 2, 3, 4];
  const collect = () => { const out: Frame[] = []; return { out, p: new RtpH264((f) => out.push(f)) }; };
  it("rebuilds a picture from a split packet", () => {
    const { out, p } = collect();
    p.push(rtp(1, false, sps));
    p.push(rtp(2, false, [0x7c, 0x85, 1, 2]));
    p.push(rtp(3, true, [0x7c, 0x45, 3, 4]));
    expect(out[0].key).toBe(true);
    expect([...out[0].data]).toEqual([0, 0, 0, 1, ...sps, 0, 0, 0, 1, 0x65, 1, 2, 3, 4]);
    expect(h264Codec(out[0].data)).toBe("avc1.42001f");
  });
  it("unpacks several small units sent together", () => {
    const { out, p } = collect();
    p.push(rtp(1, true, [24, 0, 5, ...sps, 0, 5, ...idr]));
    expect(out[0].key).toBe(true);
  });
  it("after a lost packet, waits for the next full picture", () => {
    const { out, p } = collect();
    p.push(rtp(1, true, [24, 0, 5, ...sps, 0, 5, ...idr]));
    p.push(rtp(5, true, [0x41, 1, 2, 3, 4]));
    expect(out).toHaveLength(1);
    p.push(rtp(6, true, [24, 0, 5, ...sps, 0, 5, ...idr]));
    expect(out).toHaveLength(2);
  });
});
