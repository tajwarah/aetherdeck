// Window groups that follow you across devices, and groups shared with other people.
//
// A "space" is a set of windows kept on the Warpnaut server, encrypted in this browser with AES-256-GCM. The key is
// made here and travels only inside the link, after the "#", which browsers never send to a server. The server
// receives a write token derived from the key (so it can refuse strangers' writes) and a blob it cannot read.
//
// Each window is one entry, last writer wins per entry; a closed window leaves a dated tombstone so the close
// reaches the other devices. Where a window sits, its size and whether it is minimized stay on each device:
// a phone and a laptop lay the same pages out differently.
// Encryption uses the audited noble libraries rather than crypto.subtle, which browsers only provide on https or
// localhost: a phone opening Warpnaut by this computer's Wi-Fi address over plain http must be able to decrypt too.
import { gcm } from "@noble/ciphers/aes.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { arrangeGroup, dissolveSingles, placeBeside, placeWindow, type Tab, type Win } from "./windows.ts";

export interface Creds { id: string; key: string }
export interface Item { page?: Tab; group?: string; at: number; t: number; gone?: true }
/** A shared group this person follows; kept in their personal space so every device of theirs follows it too. */
export interface Link { key: string; group: string; owner: boolean; t: number; gone?: true }
export interface Doc { items: Record<string, Item>; links: Record<string, Link>; /** For a shared group's space: the group's id. */ group?: string }

export const emptyDoc = (): Doc => ({ items: {}, links: {} });
const TOMBSTONE_DAYS = 30;

/* ---------- merging ---------- */

/** Stable JSON: the same content always gives the same string, whatever order its keys were set in. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** Last writer wins; on a tie an open window beats a close (it was moved between spaces), then a fixed order. */
function newer<T extends { t: number; gone?: true }>(a: T, b: T): T {
  if (a.t !== b.t) return a.t > b.t ? a : b;
  if (!a.gone !== !b.gone) return a.gone ? b : a;
  return stable(a) >= stable(b) ? a : b;
}

function mergeMap<T extends { t: number; gone?: true }>(a: Record<string, T>, b: Record<string, T>): Record<string, T> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = out[k] ? newer(out[k], v) : v;
  return out;
}

export const mergeDocs = (a: Doc, b: Doc): Doc => ({ items: mergeMap(a.items, b.items), links: mergeMap(a.links, b.links), ...((a.group ?? b.group) ? { group: a.group ?? b.group } : {}) });
export const sameDoc = (a: Doc, b: Doc) => stable(a) === stable(b);

/** Forget closes old enough that every device has long since seen them. */
export function prune(doc: Doc, now: number): Doc {
  const cut = now - TOMBSTONE_DAYS * 864e5;
  const keep = <T extends { t: number; gone?: true }>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).filter(([, v]) => !v.gone || v.t > cut));
  return { ...doc, items: keep(doc.items), links: keep(doc.links) };
}

/** This device's windows (those that belong in this space) written over the space's last known state. */
export function docFrom(prev: Doc, wins: Win[], now: number): Doc {
  const items = { ...prev.items };
  const seen = new Set<string>();
  for (const w of wins) {
    seen.add(w.id);
    const p = prev.items[w.id];
    const next: Item = { page: w.page, group: w.group, at: p?.at ?? now, t: now };
    if (!p || p.gone || stable(p.page) !== stable(w.page) || p.group !== w.group) items[w.id] = next;
  }
  for (const [id, p] of Object.entries(prev.items)) if (!p.gone && !seen.has(id)) items[id] = { at: p.at, t: now, gone: true };
  const doc = { ...prev, items };
  return sameDoc(doc, prev) ? prev : doc;
}

/**
 * Brings this device's windows in line with the spaces: closes windows closed elsewhere, updates changed pages and
 * groups, and places new pages (beside their group when part of it is open here). Layout stays this device's own.
 */
export function applyItems(wins: Win[], items: Record<string, Item>, vw: number, vh: number, shared: ReadonlySet<string>): { wins: Win[]; added: number } {
  let ws = wins.filter((w) => !items[w.id]?.gone);
  let changed = ws.length !== wins.length;
  ws = ws.map((w) => {
    const it = items[w.id];
    if (!it?.page || (stable(it.page) === stable(w.page) && it.group === w.group)) return w;
    changed = true;
    return { ...w, page: it.page, group: it.group };
  });
  const have = new Set(ws.map((w) => w.id));
  const fresh = Object.entries(items).filter(([id, it]) => !it.gone && it.page && !have.has(id)).sort((a, b) => a[1].at - b[1].at);
  let z = Math.max(0, ...ws.map((w) => w.z));
  for (const [id, it] of fresh) {
    const members = it.group ? ws.filter((m) => m.group === it.group && !m.minimized) : [];
    const anchor = members.reduce<Win | undefined>((a, m) => (!a || m.x > a.x ? m : a), undefined);
    const win: Omit<Win, "x" | "y" | "w" | "h"> = { id, page: it.page!, group: it.group, z: ++z, minimized: false };
    if (anchor) {
      const { fits, ...rect } = placeBeside(ws, anchor, vw, vh);
      ws = [...ws, { ...win, ...rect }];
      if (!fits) ws = arrangeGroup(ws, it.group!, vw, vh);
    } else ws = [...ws, { ...win, ...placeWindow(ws, vw, vh) }];
  }
  if (!changed && !fresh.length) return { wins, added: 0 };
  return { wins: dissolveSingles(ws, shared), added: fresh.length };
}

/* ---------- keys, links and encryption ---------- */

const te = new TextEncoder();
const td = new TextDecoder();

export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64u(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** A new space: a 128-bit id and a 256-bit key. */
export const newCreds = (): Creds => ({ id: b64u(random(16)), key: b64u(random(32)) });

/** What the server checks writes against. Derived one way from the key, so it reveals nothing about it. */
export async function authToken(key: string) {
  return b64u(sha256(te.encode(`nexus-sync-auth:${key}`)));
}

export async function seal(c: Creds, doc: Doc): Promise<string> {
  const iv = random(12);
  const ct = gcm(unb64u(c.key), iv, te.encode(c.id)).encrypt(te.encode(JSON.stringify(doc)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64u(out);
}

export async function unseal(c: Creds, blob: string): Promise<Doc> {
  const raw = unb64u(blob);
  const pt = gcm(unb64u(c.key), raw.subarray(0, 12), te.encode(c.id)).decrypt(raw.subarray(12));
  const doc = JSON.parse(td.decode(pt)) as Partial<Doc>;
  return { items: doc.items && typeof doc.items === "object" ? doc.items : {}, links: doc.links && typeof doc.links === "object" ? doc.links : {}, ...(typeof doc.group === "string" ? { group: doc.group } : {}) };
}

export type InviteKind = "sync" | "group";
export interface Invite { kind: InviteKind; creds: Creds }

export const inviteUrl = (base: string, kind: InviteKind, c: Creds) => `${base.replace(/\/+$/, "")}/#${kind}=${c.id}.${c.key}`;

export function parseInvite(hash: string): Invite | null {
  const m = hash.match(/^#?(sync|group)=([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/);
  return m ? { kind: m[1] as InviteKind, creds: { id: m[2], key: m[3] } } : null;
}

/* ---------- one live space ---------- */

export interface Status { state: "connecting" | "live" | "offline" | "gone"; peers: number }

interface Handlers { doc: (d: Doc) => void; status: (s: Status) => void }

/**
 * Keeps one space in step with the server: fetches it, listens for new versions over a server-sent event stream,
 * and writes local changes on top of the version it last saw (merging and retrying if another device got there first).
 */
export class SpaceClient {
  doc: Doc = emptyDoc();
  ready = false;
  private v = 0;
  private token = "";
  private alive = true;
  private ctrl = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing = false;
  private dirty = false;
  private status: Status = { state: "connecting", peers: 0 };

  readonly creds: Creds;
  private on: Handlers;

  constructor(creds: Creds, on: Handlers, initial?: Doc) {
    this.creds = creds;
    this.on = on;
    if (initial) this.doc = initial;
  }

  private headers(extra: Record<string, string> = {}) { return { "X-Sync-Auth": this.token, ...extra }; }
  private url(suffix = "") { return `/api/sync/${this.creds.id}${suffix}`; }
  private setStatus(s: Partial<Status>) { this.status = { ...this.status, ...s }; this.on.status(this.status); }

  /** Resolves true once the space is loaded (made, when `create`), false if it no longer exists. */
  async start(create: boolean): Promise<boolean> {
    this.token = await authToken(this.creds.key);
    for (let wait = 1000; this.alive; wait = Math.min(wait * 2, 15_000)) {
      try {
        const res = await fetch(this.url(), { headers: this.headers(), signal: this.ctrl.signal });
        if (res.status === 404 && create) {
          const made = await fetch(this.url(), { method: "PUT", headers: this.headers({ "Content-Type": "application/json" }), body: JSON.stringify({ base: 0, blob: await seal(this.creds, this.doc) }), signal: this.ctrl.signal });
          if (!made.ok) throw new Error(`HTTP ${made.status}`);
          this.v = ((await made.json()) as { v: number }).v;
        } else if (res.status === 404 || res.status === 403) {
          this.setStatus({ state: "gone" });
          return false;
        } else if (!res.ok) throw new Error(`HTTP ${res.status}`);
        else await this.take((await res.json()) as { v: number; blob: string });
        this.ready = true;
        this.on.doc(this.doc);
        void this.listen();
        return true;
      } catch {
        if (!this.alive) return false;
        this.setStatus({ state: "offline" });
        await sleep(wait);
      }
    }
    return false;
  }

  /** Merge a server version into what this device has, and write back if this device knows more. */
  private async take(remote: { v: number; blob: string }) {
    if (remote.v <= this.v) return;
    const theirs = await unseal(this.creds, remote.blob);
    const merged = mergeDocs(this.doc, theirs);
    this.v = remote.v;
    this.doc = merged;
    if (!sameDoc(merged, theirs)) this.schedule();
  }

  private async pull() {
    const res = await fetch(this.url(), { headers: this.headers(), signal: this.ctrl.signal });
    if (res.status === 404 || res.status === 403) return this.gone();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const before = this.doc;
    await this.take((await res.json()) as { v: number; blob: string });
    if (this.doc !== before) this.on.doc(this.doc);
  }

  private gone() {
    this.alive = false;
    this.ctrl.abort();
    this.setStatus({ state: "gone", peers: 0 });
  }

  private async listen() {
    for (let wait = 1000; this.alive; wait = Math.min(wait * 2, 15_000)) {
      try {
        const res = await fetch(this.url("/events"), { headers: this.headers(), signal: this.ctrl.signal });
        if (res.status === 404 || res.status === 403) return this.gone();
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        wait = 1000;
        await this.pull(); // anything written while this device was away
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let cut: number;
          while ((cut = buf.indexOf("\n\n")) >= 0) {
            const line = buf.slice(0, cut).split("\n").find((l) => l.startsWith("data: "));
            buf = buf.slice(cut + 2);
            if (!line) continue;
            const e = JSON.parse(line.slice(6)) as { v?: number; peers?: number; gone?: true };
            if (e.gone) return this.gone();
            this.setStatus({ state: "live", ...(e.peers !== undefined ? { peers: e.peers } : {}) });
            if (e.v && e.v > this.v) await this.pull();
          }
        }
      } catch {
        if (!this.alive) return;
      }
      if (!this.alive) return;
      this.setStatus({ state: "offline" });
      await sleep(wait);
    }
  }

  /** Replace this device's view of the space (computed from its windows) and write it soon. */
  update(next: Doc) {
    if (!this.alive || sameDoc(next, this.doc)) return;
    this.doc = next;
    this.schedule();
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.push(), 250);
  }

  private async push() {
    if (this.writing) { this.dirty = true; return; }
    this.writing = true;
    try {
      do {
        this.dirty = false;
        for (let attempt = 0; attempt < 6 && this.alive; attempt++) {
          const doc = prune(this.doc, Date.now());
          const res = await fetch(this.url(), { method: "PUT", headers: this.headers({ "Content-Type": "application/json" }), body: JSON.stringify({ base: this.v, blob: await seal(this.creds, doc) }), signal: this.ctrl.signal });
          if (res.ok) { this.v = Math.max(this.v, ((await res.json()) as { v: number }).v); break; }
          if (res.status === 409) { await this.pull(); continue; } // another device wrote first: merge, then write on top
          if (res.status === 404 || res.status === 403) return this.gone();
          throw new Error(`HTTP ${res.status}`);
        }
      } while (this.dirty && this.alive);
    } catch {
      if (this.alive) { this.setStatus({ state: "offline" }); this.timer = setTimeout(() => void this.push(), 3000); }
    } finally {
      this.writing = false;
    }
  }

  stop() {
    this.alive = false;
    clearTimeout(this.timer);
    this.ctrl.abort();
  }

  /** Remove the space from the server: every device and person following it is told it is gone. */
  async destroy() {
    this.stop();
    await fetch(this.url(), { method: "DELETE", headers: this.headers() }).catch(() => undefined);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
