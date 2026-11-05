// Phones in the browser, with no browser around it: reading scrcpy's video stream and writing its control
// messages (Android, protocol of scrcpy 5.0.1), and rebuilding H.264 video from AirPlay's RTP packets (iPhone).

export const SCRCPY_VERSION = "5.0.1";
export const SCRCPY_SHA256 = "764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536";
const H264 = 0x68323634;

export interface Frame { key: boolean; pts: number; data: Uint8Array }
export type VideoEvent = { kind: "device"; name: string } | { kind: "size"; width: number; height: number } | { kind: "frame"; frame: Frame };

const join = (a: Uint8Array, b: Uint8Array) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };

/** The first socket from scrcpy's server: a dummy byte, the device's name, the codec, then sessions and packets. */
export class ScrcpyVideo {
  private buf: Uint8Array = new Uint8Array(0);
  private started = false;
  private config: Uint8Array | null = null;
  private emit: (e: VideoEvent) => void;
  constructor(emit: (e: VideoEvent) => void) { this.emit = emit; }

  push(chunk: Uint8Array) {
    this.buf = this.buf.length ? join(this.buf, chunk) : chunk;
    if (!this.started) {
      if (this.buf.length < 69) return;
      const v = new DataView(this.buf.buffer, this.buf.byteOffset, 69);
      const name = new TextDecoder().decode(this.buf.subarray(1, 65)).replace(/\0.*$/s, "");
      const codec = v.getUint32(65);
      if (codec !== H264) throw new Error(codec <= 1 ? "The phone couldn't start sending its screen" : "The phone sent a video format AetherDeck can't read");
      this.buf = this.buf.subarray(69);
      this.started = true;
      this.emit({ kind: "device", name });
    }
    while (this.buf.length >= 12) {
      const v = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.length);
      const first = this.buf[0];
      if (first & 0x80) {
        this.emit({ kind: "size", width: v.getUint32(4), height: v.getUint32(8) });
        this.buf = this.buf.subarray(12);
        continue;
      }
      const size = v.getUint32(8);
      if (this.buf.length < 12 + size) return;
      const data = this.buf.subarray(12, 12 + size).slice();
      const pts = Number(v.getBigUint64(0) & ((1n << 61n) - 1n));
      this.buf = this.buf.subarray(12 + size);
      // The decoder settings arrive alone and belong in front of the next picture.
      if (first & 0x40) { this.config = data; continue; }
      this.emit({ kind: "frame", frame: { key: !!(first & 0x20), pts, data: this.config ? join(this.config, data) : data } });
      this.config = null;
    }
  }
}

/* ---------- control messages, as scrcpy's server reads them ---------- */

export const KEY = { home: 3, back: 4, up: 19, down: 20, left: 21, right: 22, volumeUp: 24, volumeDown: 25, power: 26, tab: 61, enter: 66, del: 67, escape: 111, forwardDel: 112, recents: 187 } as const;
const FINGER = 0xfffffffffffffffen; // scrcpy's generic finger, so taps count as touches and not as a mouse

export function touchMessage(action: "down" | "up" | "move", x: number, y: number, width: number, height: number) {
  const b = new Uint8Array(32);
  const v = new DataView(b.buffer);
  v.setUint8(0, 2);
  v.setUint8(1, { down: 0, up: 1, move: 2 }[action]);
  v.setBigUint64(2, FINGER);
  v.setUint32(10, Math.round(x));
  v.setUint32(14, Math.round(y));
  v.setUint16(18, width);
  v.setUint16(20, height);
  v.setUint16(22, action === "up" ? 0 : 0xffff);
  return b;
}

export function keyMessage(action: "down" | "up", keycode: number) {
  const b = new Uint8Array(14);
  const v = new DataView(b.buffer);
  v.setUint8(0, 0);
  v.setUint8(1, action === "down" ? 0 : 1);
  v.setUint32(2, keycode);
  return b;
}

export function textMessage(text: string) {
  const bytes = new TextEncoder().encode(text).subarray(0, 300);
  const b = new Uint8Array(5 + bytes.length);
  b[0] = 1;
  new DataView(b.buffer).setUint32(1, bytes.length);
  b.set(bytes, 5);
  return b;
}

const scrollPart = (n: number) => Math.max(-32768, Math.min(32767, Math.round((Math.max(-16, Math.min(16, n)) / 16) * 32768)));

export function scrollMessage(x: number, y: number, width: number, height: number, dx: number, dy: number) {
  const b = new Uint8Array(21);
  const v = new DataView(b.buffer);
  v.setUint8(0, 3);
  v.setUint32(1, Math.round(x));
  v.setUint32(5, Math.round(y));
  v.setUint16(9, width);
  v.setUint16(11, height);
  v.setInt16(13, scrollPart(dx));
  v.setInt16(15, scrollPart(dy));
  return b;
}

export function clipboardMessage(text: string) {
  const bytes = new TextEncoder().encode(text).subarray(0, 200_000);
  const b = new Uint8Array(14 + bytes.length);
  const v = new DataView(b.buffer);
  v.setUint8(0, 9);
  v.setUint8(9, 1); // and paste it
  v.setUint32(10, bytes.length);
  b.set(bytes, 14);
  return b;
}

/** Turns the phone's own display off or on; mirroring carries on either way. */
export const displayMessage = (on: boolean) => Uint8Array.of(10, on ? 1 : 0);
export const rotateMessage = () => Uint8Array.of(11);
/** Asks for a fresh full picture, after a pause or a lost frame. */
export const resetVideoMessage = () => Uint8Array.of(17);

/* ---------- AirPlay's video, as RTP packets from UxPlay ---------- */

const START = Uint8Array.of(0, 0, 0, 1);

/** Rebuilds whole pictures from RTP. After a lost packet it waits for the next full picture. */
export class RtpH264 {
  private nals: Uint8Array[] = [];
  private partial: Uint8Array[] = [];
  private seq = -1;
  private broken = true;
  private emit: (f: Frame) => void;
  constructor(emit: (f: Frame) => void) { this.emit = emit; }

  private add(nal: Uint8Array) { this.nals.push(START, nal); }

  push(p: Uint8Array) {
    if (p.length < 13 || p[0] >> 6 !== 2) return;
    const v = new DataView(p.buffer, p.byteOffset, p.length);
    let at = 12 + (p[0] & 0x0f) * 4;
    if (p[0] & 0x10) at += 4 + v.getUint16(at + 2) * 4;
    if (p[0] & 0x20) p = p.subarray(0, p.length - p[p.length - 1]);
    const seq = v.getUint16(2);
    if (this.seq >= 0 && seq !== ((this.seq + 1) & 0xffff)) { this.broken = true; this.nals = []; this.partial = []; }
    this.seq = seq;
    const body = p.subarray(at);
    if (!body.length) return;
    const type = body[0] & 0x1f;
    if (type >= 1 && type <= 23) this.add(body);
    else if (type === 24) {
      for (let i = 1; i + 2 <= body.length;) {
        const n = (body[i] << 8) | body[i + 1];
        this.add(body.subarray(i + 2, i + 2 + n));
        i += 2 + n;
      }
    } else if (type === 28 && body.length > 2) {
      const fu = body[1];
      if (fu & 0x80) this.partial = [Uint8Array.of((body[0] & 0xe0) | (fu & 0x1f))];
      this.partial.push(body.subarray(2));
      if (fu & 0x40) {
        const size = this.partial.reduce((n, x) => n + x.length, 0);
        const nal = new Uint8Array(size);
        let o = 0;
        for (const x of this.partial) { nal.set(x, o); o += x.length; }
        this.add(nal);
        this.partial = [];
      }
    }
    if (!(p[1] & 0x80) || !this.nals.length) return;
    const key = this.nals.some((n) => n.length > 4 && (n[0] & 0x1f) === 5);
    const hasSps = this.nals.some((n) => n.length > 4 && (n[0] & 0x1f) === 7);
    if (key && hasSps) this.broken = false;
    if (!this.broken) {
      const size = this.nals.reduce((n, x) => n + x.length, 0);
      const data = new Uint8Array(size);
      let o = 0;
      for (const x of this.nals) { data.set(x, o); o += x.length; }
      this.emit({ key: key && hasSps, pts: Math.round((v.getUint32(4) / 90) * 1000), data });
    }
    this.nals = [];
  }
}

/** The codec name WebCodecs needs, read from the first picture's settings. Null until they arrive. */
export function h264Codec(data: Uint8Array): string | null {
  for (let i = 0; i + 7 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 && (data[i + 3] & 0x1f) === 7) {
      const hex = (n: number) => n.toString(16).padStart(2, "0");
      return `avc1.${hex(data[i + 4])}${hex(data[i + 5])}${hex(data[i + 6])}`;
    }
  }
  return null;
}
