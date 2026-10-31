// Sync spaces: how window groups follow you across devices and reach the people you share them with.
// The browser encrypts each space with a key that lives only in the link (after the #, never sent here).
// This store keeps the scrambled blob, a version number, and a hash of a write token derived from the key.
// It cannot read pages, titles or addresses. Spaces untouched for 90 days are removed.
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const MAX_BLOB = 256 * 1024;
const TTL_MS = 90 * 24 * 3600 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

interface Record { v: number; auth: string; blob: string; updated: string }
type Listener = (e: { v?: number; peers?: number; gone?: true }) => void;

export const validId = (id: string) => ID_RE.test(id);
export const validToken = (t: string) => TOKEN_RE.test(t);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class SyncError extends Error {
  readonly status: number;
  readonly v?: number;
  constructor(status: number, message: string, v?: number) {
    super(message);
    this.status = status;
    this.v = v;
  }
}

export class SyncStore {
  private mem = new Map<string, Record>();
  private listeners = new Map<string, Set<Listener>>();
  private ready: Promise<void>;
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.ready = mkdir(dir, { recursive: true }).then(() => this.sweep()).catch(() => undefined);
  }

  private file(id: string) { return join(this.dir, `${id}.json`); }

  private async load(id: string): Promise<Record | null> {
    await this.ready;
    const hit = this.mem.get(id);
    if (hit) return hit;
    try {
      const rec = JSON.parse(await readFile(this.file(id), "utf8")) as Record;
      this.mem.set(id, rec);
      return rec;
    } catch {
      return null;
    }
  }

  private async save(id: string, rec: Record) {
    this.mem.set(id, rec);
    const tmp = `${this.file(id)}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(rec));
    await rename(tmp, this.file(id));
  }

  private check(rec: Record, token: string) {
    if (!same(rec.auth, hash(token))) throw new SyncError(403, "This link does not open this space");
  }

  async get(id: string, token: string) {
    const rec = await this.load(id);
    if (!rec) throw new SyncError(404, "This space no longer exists");
    this.check(rec, token);
    return { v: rec.v, blob: rec.blob, peers: this.peers(id) };
  }

  /** Compare-and-swap: writes only on top of version `base` (0 creates the space). */
  async put(id: string, token: string, base: number, blob: string) {
    if (blob.length > MAX_BLOB) throw new SyncError(413, "This space is too large to sync");
    const rec = await this.load(id);
    if (!rec) {
      if (base !== 0) throw new SyncError(404, "This space no longer exists");
      await this.save(id, { v: 1, auth: hash(token), blob, updated: new Date().toISOString() });
      this.emit(id, { v: 1 });
      return { v: 1 };
    }
    this.check(rec, token);
    if (rec.v !== base) throw new SyncError(409, "Changed elsewhere", rec.v);
    const v = rec.v + 1;
    await this.save(id, { ...rec, v, blob, updated: new Date().toISOString() });
    this.emit(id, { v });
    return { v };
  }

  async remove(id: string, token: string) {
    const rec = await this.load(id);
    if (!rec) return;
    this.check(rec, token);
    this.mem.delete(id);
    await rm(this.file(id), { force: true });
    this.emit(id, { gone: true });
  }

  /** Live updates: called with each new version, and with the number of devices connected. */
  async subscribe(id: string, token: string, fn: Listener) {
    await this.get(id, token);
    const set = this.listeners.get(id) ?? new Set();
    this.listeners.set(id, set);
    set.add(fn);
    this.emit(id, { peers: set.size });
    return () => {
      set.delete(fn);
      if (!set.size) this.listeners.delete(id);
      else this.emit(id, { peers: set.size });
    };
  }

  peers(id: string) { return this.listeners.get(id)?.size ?? 0; }

  private emit(id: string, e: Parameters<Listener>[0]) {
    for (const fn of this.listeners.get(id) ?? []) fn({ ...e, peers: e.peers ?? this.peers(id) });
  }

  private async sweep() {
    const now = Date.now();
    for (const name of await readdir(this.dir)) {
      if (!name.endsWith(".json")) continue;
      const f = join(this.dir, name);
      const s = await stat(f).catch(() => null);
      if (s && now - s.mtimeMs > TTL_MS) await rm(f, { force: true });
    }
  }
}
