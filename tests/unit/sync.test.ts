import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyItems, authToken, docFrom, emptyDoc, inviteUrl, mergeDocs, newCreds, parseInvite, prune, seal, unseal, type Doc } from "../../src/lib/sync.ts";
import { regroupAfterDrop, type Win } from "../../src/lib/windows.ts";
import { SyncStore } from "../../server/sync.ts";

const page = (domain: string) => ({ id: `t-${domain}`, kind: "web" as const, src: `https://${domain}`, href: `https://${domain}`, title: domain, domain });
const win = (id: string, x: number, extra: Partial<Win> = {}): Win => ({ id, page: page(`${id}.org`), x, y: 120, w: 400, h: 300, z: 1, minimized: false, ...extra });

describe("sync documents", () => {
  it("records this device's windows, keeps unchanged entries' times, and leaves a tombstone for a closed window", () => {
    const d1 = docFrom(emptyDoc(), [win("a", 0, { group: "g" }), win("b", 430, { group: "g" })], 100);
    expect(d1.items.a).toMatchObject({ group: "g", at: 100, t: 100 });
    // moving or minimizing is this device's business: nothing to sync
    expect(docFrom(d1, [win("a", 900, { group: "g", minimized: true }), win("b", 0, { group: "g" })], 200)).toBe(d1);
    const d2 = docFrom(d1, [win("a", 0, { group: "g" })], 300);
    expect(d2.items.b).toEqual({ at: 100, t: 300, gone: true });
    expect(d2.items.a.t).toBe(100);
  });

  it("merges two devices' edits entry by entry, newest first, and agrees whichever side merges", () => {
    const base = docFrom(emptyDoc(), [win("a", 0), win("b", 500)], 100);
    const laptop = docFrom(base, [win("a", 0, { page: page("new.org") }), win("b", 500)], 200); // changed a page
    const phone = docFrom(base, [win("a", 0)], 250); // closed b
    const m1 = mergeDocs(laptop, phone);
    expect(m1).toEqual(mergeDocs(phone, laptop));
    expect(m1.items.a.page?.domain).toBe("new.org");
    expect(m1.items.b.gone).toBe(true);
  });

  it("treats a window moved into a shared group as still open (same time: open beats closed)", () => {
    const personal: Doc = { items: { a: { at: 1, t: 50, gone: true } }, links: {} };
    const shared: Doc = { items: { a: { page: page("a.org"), group: "g", at: 1, t: 50 } }, links: {}, group: "g" };
    expect(mergeDocs(personal, shared).items.a.gone).toBeUndefined();
    expect(mergeDocs(shared, personal).items.a.gone).toBeUndefined();
  });

  it("forgets tombstones after 30 days", () => {
    const d: Doc = { items: { old: { at: 0, t: 0, gone: true }, live: { page: page("x.org"), at: 0, t: 0 } }, links: {} };
    expect(Object.keys(prune(d, 31 * 864e5).items)).toEqual(["live"]);
  });

  it("applies remote changes: closes, updates, and places new pages beside their group", () => {
    const local = [win("a", 100, { group: "g" }), win("b", 530, { group: "g" }), win("c", 100, { y: 500 } as Partial<Win>)];
    const items = {
      c: { at: 1, t: 9, gone: true as const },
      b: { page: page("changed.org"), group: "g", at: 1, t: 9 },
      d: { page: page("d.org"), group: "g", at: 5, t: 9 },
      e: { page: page("e.org"), at: 6, t: 9 },
    };
    const { wins, added } = applyItems(local, items, 1600, 900, new Set());
    expect(added).toBe(2);
    expect(wins.map((w) => w.id).sort()).toEqual(["a", "b", "d", "e"]);
    expect(wins.find((w) => w.id === "b")?.page.domain).toBe("changed.org");
    const d = wins.find((w) => w.id === "d")!;
    expect(d).toMatchObject({ group: "g", minimized: false });
    expect(d.x).toBeGreaterThan(530); // beside the group, not on top of it
    expect(wins.find((w) => w.id === "e")?.group).toBeUndefined();
    // nothing new: the same array comes back, so nothing re-renders
    expect(applyItems(wins, {}, 1600, 900, new Set()).wins).toBe(wins);
  });
});

describe("sync links and encryption", () => {
  it("round-trips a space through encryption and refuses the wrong key or space", async () => {
    const c = newCreds();
    expect(c.id).toHaveLength(22);
    expect(c.key).toHaveLength(43);
    const doc = docFrom(emptyDoc(), [win("a", 0)], 1);
    const blob = await seal(c, doc);
    expect(blob).not.toContain("a.org"); // the server never sees addresses
    expect(await unseal(c, blob)).toEqual(doc);
    await expect(unseal({ ...c, key: newCreds().key }, blob)).rejects.toThrow();
    await expect(unseal({ ...c, id: newCreds().id }, blob)).rejects.toThrow(); // bound to its space
    expect(await authToken(c.key)).toHaveLength(43);
    expect(await authToken(c.key)).not.toContain(c.key);
  });

  it("puts the key after the #, and reads only well-formed links", () => {
    const c = newCreds();
    const url = inviteUrl("http://192.168.1.5:5173/", "group", c);
    expect(url).toBe(`http://192.168.1.5:5173/#group=${c.id}.${c.key}`);
    expect(parseInvite(new URL(url).hash)).toEqual({ kind: "group", creds: c });
    expect(parseInvite("#sync=short.key")).toBeNull();
    expect(parseInvite("#other=x")).toBeNull();
  });
});

describe("shared groups on screen", () => {
  it("never pulls private windows into a shared group, and lets a dropped window join one", () => {
    const shared = new Set(["s"]);
    const ws = [win("a", 0, { group: "s" }), win("b", 430, { group: "p" }), win("c", 860, { group: "p" }), win("d", 2000)];
    // a shared window dropped beside a private group: nothing changes
    const r1 = regroupAfterDrop(ws, "a", shared);
    expect(r1.map((w) => w.group)).toEqual(["s", "p", "p", undefined]);
    // a lone window dropped beside the shared group joins it (only that window)
    const r2 = regroupAfterDrop(ws.map((w) => (w.id === "d" ? { ...w, x: -430 } : w)), "d", shared);
    expect(r2.find((w) => w.id === "d")?.group).toBe("s");
    // a shared group of one stays a group
    const r3 = regroupAfterDrop([win("a", 0, { group: "s" }), win("z", 3000)], "z", shared);
    expect(r3[0].group).toBe("s");
  });
});

describe("sync store (server)", () => {
  it("creates, versions, refuses stale or foreign writes, notifies listeners, and deletes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "warpnaut-sync-"));
    const store = new SyncStore(dir);
    const id = newCreds().id;
    const token = await authToken(newCreds().key);
    expect(await store.put(id, token, 0, "blob1")).toEqual({ v: 1 });
    const events: unknown[] = [];
    const stop = await store.subscribe(id, token, (e) => events.push(e));
    expect(await store.put(id, token, 1, "blob2")).toEqual({ v: 2 });
    await expect(store.put(id, token, 1, "stale")).rejects.toMatchObject({ status: 409, v: 2 });
    await expect(store.get(id, await authToken(newCreds().key))).rejects.toMatchObject({ status: 403 });
    expect(await store.get(id, token)).toEqual({ v: 2, blob: "blob2", peers: 1 });
    expect(JSON.parse(await readFile(join(dir, `${id}.json`), "utf8"))).not.toHaveProperty("token");
    await store.remove(id, token);
    expect(events).toEqual([{ peers: 1 }, { v: 2, peers: 1 }, { gone: true, peers: 1 }]);
    stop();
    await expect(store.get(id, token)).rejects.toMatchObject({ status: 404 });
    expect(await readdir(dir)).toEqual([]);
  });
});
