// Runs the spaces this device belongs to (its personal space, if sync is on, and every shared group it follows)
// and keeps them in step with the windows on screen. Each pass: apply what changed remotely since the last pass,
// then write this device's windows into the space each belongs to. A window in a shared group belongs to that
// group's space; every other window belongs to the personal space.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { applyItems, docFrom, emptyDoc, mergeDocs, newCreds, SpaceClient, stable, type Creds, type Doc, type Invite, type Item, type Status } from "./sync.ts";
import type { Win } from "./windows.ts";

const KEY = "aetherdeck.sync.v1";

interface Share { key: string; group: string; owner: boolean }
interface Saved { personal: Creds | null; shares: Record<string, Share> }

export interface SharedGroup extends Share { id: string; status: Status }
export interface SyncApi {
  personal: Creds | null;
  personalStatus: Status | null;
  shares: SharedGroup[];
  /** Group ids that are shared: they keep their id, never dissolve, and only change through their own controls. */
  sharedGroups: ReadonlySet<string>;
  notice: string | null;
  dismissNotice: () => void;
  enable: () => void;
  disable: (everywhere: boolean) => void;
  shareGroup: (group: string) => void;
  stopSharing: (id: string) => void;
  leave: (id: string) => void;
  join: (invite: Invite) => void;
  forgetAll: () => void;
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    return raw && typeof raw === "object" ? { personal: raw.personal ?? null, shares: raw.shares ?? {} } : { personal: null, shares: {} };
  } catch {
    return { personal: null, shares: {} };
  }
}

const connecting: Status = { state: "connecting", peers: 0 };

export function useSync(wins: Win[], setWins: Dispatch<SetStateAction<Win[]>>): SyncApi {
  const [saved, setSaved] = useState<Saved>(load);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const clients = useRef(new Map<string, SpaceClient>());
  const joining = useRef(new Set<string>()); // spaces opened from someone's link: never created here if missing
  const seen = useRef<Record<string, Item>>({}); // what the windows on screen were last reconciled with

  useEffect(() => {
    try {
      if (saved.personal || Object.keys(saved.shares).length) localStorage.setItem(KEY, JSON.stringify(saved));
      else localStorage.removeItem(KEY);
    } catch { /* storage unavailable: sync lasts for this visit */ }
  }, [saved]);

  const groupToSpace = useMemo(() => new Map(Object.entries(saved.shares).filter(([, s]) => s.group).map(([id, s]) => [s.group, id])), [saved.shares]);
  const sharedGroups = useMemo(() => new Set(groupToSpace.keys()), [groupToSpace]);

  const gone = useCallback((id: string) => {
    setSaved((s) => {
      if (s.personal?.id === id) {
        setNotice("Sync was turned off from another device. Your windows stay here.");
        return { ...s, personal: null };
      }
      if (!s.shares[id]) return s;
      setNotice("A shared group was stopped by the person who shared it. Your copy stays here.");
      const { [id]: _, ...rest } = s.shares;
      return { ...s, shares: rest };
    });
  }, []);

  // Start a client for every space this device belongs to; stop the ones it left.
  useEffect(() => {
    const want = new Map<string, { creds: Creds; create: boolean; group?: string }>();
    if (saved.personal) want.set(saved.personal.id, { creds: saved.personal, create: true });
    for (const [id, s] of Object.entries(saved.shares)) want.set(id, { creds: { id, key: s.key }, create: s.owner, group: s.group });
    for (const [id, c] of clients.current) if (!want.has(id)) { c.stop(); clients.current.delete(id); }
    for (const [id, w] of want) {
      if (clients.current.has(id)) continue;
      const c = new SpaceClient(w.creds, {
        doc: () => setTick((t) => t + 1),
        status: (st) => {
          setStatuses((all) => ({ ...all, [id]: st }));
          if (st.state === "gone" && clients.current.get(id) === c && c.ready) gone(id);
        },
      }, w.create && w.group ? { ...emptyDoc(), group: w.group } : undefined);
      clients.current.set(id, c);
      const create = w.create && !joining.current.has(id);
      void c.start(create).then((ok) => {
        joining.current.delete(id);
        if (!ok && clients.current.get(id) === c) {
          clients.current.delete(id);
          setSaved((s) => (s.personal?.id === id ? { ...s, personal: null } : s.shares[id] ? { ...s, shares: Object.fromEntries(Object.entries(s.shares).filter(([k]) => k !== id)) } : s));
          setNotice("That link no longer opens anything: it was turned off by whoever made it.");
        }
        setTick((t) => t + 1);
      });
    }
  }, [saved, gone]);

  useEffect(() => () => { for (const c of clients.current.values()) c.stop(); clients.current.clear(); }, []);

  // Reconcile: remote changes into the windows, then the windows into the spaces.
  useEffect(() => {
    const cs = [...clients.current.values()];
    if (!cs.length || cs.some((c) => !c.ready)) return;
    const personal = saved.personal ? clients.current.get(saved.personal.id) : undefined;

    // A joined shared group learns its group id from the space itself.
    for (const [id, s] of Object.entries(saved.shares)) {
      const g = clients.current.get(id)?.doc.group;
      if (!s.group && g) return setSaved((sv) => ({ ...sv, shares: { ...sv.shares, [id]: { ...sv.shares[id], group: g } } }));
    }
    // Shared groups followed or left on another of this person's devices.
    if (personal) {
      const links = personal.doc.links;
      const follow = Object.entries(links).filter(([id, l]) => !l.gone && !saved.shares[id]);
      const left = Object.entries(links).filter(([id, l]) => l.gone && saved.shares[id]);
      if (follow.length || left.length) {
        const closeGroups = new Set(left.filter(([, l]) => !l.owner).map(([, l]) => l.group));
        if (closeGroups.size) setWins((ws) => ws.filter((w) => !w.group || !closeGroups.has(w.group)));
        follow.forEach(([id]) => joining.current.add(id));
        return setSaved((s) => {
          const shares = { ...s.shares };
          for (const [id, l] of follow) shares[id] = { key: l.key, group: l.group, owner: l.owner };
          for (const [id] of left) delete shares[id];
          return { ...s, shares };
        });
      }
    }

    const combined = cs.reduce<Doc>((acc, c) => mergeDocs(acc, c.doc), emptyDoc()).items;
    const first = !Object.keys(seen.current).length;
    const delta = Object.fromEntries(Object.entries(combined).filter(([id, it]) => stable(seen.current[id]) !== stable(it)));
    let ws = wins;
    if (Object.keys(delta).length) {
      const r = applyItems(wins, delta, window.innerWidth, window.innerHeight, sharedGroups);
      ws = r.wins;
      if (r.added && !first) {
        const inShare = Object.keys(delta).some((id) => !delta[id].gone && personal && !personal.doc.items[id]);
        setNotice(`${r.added === 1 ? "A page" : `${r.added} pages`} arrived ${inShare ? "in a shared group" : "from your other device"}.`);
      }
    }

    const now = Date.now();
    const personalId = saved.personal?.id;
    for (const c of cs) {
      const mine = ws.filter((w) => !w.private && w.page.kind !== "assistant" && ((w.group && groupToSpace.get(w.group)) || personalId) === c.creds.id); // private windows never leave this device
      let next = docFrom(c.doc, mine, now);
      if (c === personal) {
        const links = { ...next.links };
        let added = false;
        for (const [id, s] of Object.entries(saved.shares)) {
          if (s.group && (!links[id] || links[id].gone)) { links[id] = { key: s.key, group: s.group, owner: s.owner, t: now }; added = true; }
        }
        if (added) next = { ...next, links };
      }
      c.update(next);
    }
    seen.current = cs.reduce<Doc>((acc, c) => mergeDocs(acc, c.doc), emptyDoc()).items;
    if (ws !== wins) setWins(ws);
  }, [wins, tick, saved, groupToSpace, sharedGroups, setWins]);

  const markLink = useCallback((id: string) => {
    const p = saved.personal ? clients.current.get(saved.personal.id) : undefined;
    const l = p?.doc.links[id];
    if (p && l && !l.gone) p.update({ ...p.doc, links: { ...p.doc.links, [id]: { ...l, gone: true, t: Date.now() } } });
  }, [saved.personal]);

  const dropShare = (id: string) => setSaved((s) => ({ ...s, shares: Object.fromEntries(Object.entries(s.shares).filter(([k]) => k !== id)) }));

  return {
    personal: saved.personal,
    personalStatus: saved.personal ? statuses[saved.personal.id] ?? connecting : null,
    shares: Object.entries(saved.shares).map(([id, s]) => ({ ...s, id, status: statuses[id] ?? connecting })),
    sharedGroups,
    notice,
    dismissNotice: () => setNotice(null),
    enable: () => setSaved((s) => (s.personal ? s : { ...s, personal: newCreds() })),
    disable: (everywhere) => {
      const c = saved.personal && clients.current.get(saved.personal.id);
      if (c) { clients.current.delete(c.creds.id); void (everywhere ? c.destroy() : c.stop()); }
      seen.current = {};
      setSaved((s) => ({ ...s, personal: null }));
    },
    shareGroup: (group) => {
      if (groupToSpace.has(group)) return;
      const creds = newCreds();
      setSaved((s) => ({ ...s, shares: { ...s.shares, [creds.id]: { key: creds.key, group, owner: true } } }));
    },
    stopSharing: (id) => {
      const c = clients.current.get(id);
      if (c) { clients.current.delete(id); void c.destroy(); }
      markLink(id);
      dropShare(id);
    },
    leave: (id) => {
      const group = saved.shares[id]?.group;
      const c = clients.current.get(id);
      if (c) { clients.current.delete(id); c.stop(); }
      markLink(id);
      dropShare(id);
      if (group) setWins((ws) => ws.filter((w) => w.group !== group));
    },
    join: (inv) => {
      joining.current.add(inv.creds.id);
      if (inv.kind === "sync") {
        if (saved.personal?.id === inv.creds.id) return;
        const old = saved.personal && clients.current.get(saved.personal.id);
        if (old) { clients.current.delete(old.creds.id); old.stop(); }
        setSaved((s) => ({ ...s, personal: inv.creds }));
      } else if (!saved.shares[inv.creds.id]) {
        setSaved((s) => ({ ...s, shares: { ...s.shares, [inv.creds.id]: { key: inv.creds.key, group: "", owner: false } } }));
      }
    },
    forgetAll: () => {
      for (const c of clients.current.values()) c.stop();
      clients.current.clear();
      seen.current = {};
      setSaved({ personal: null, shares: {} });
    },
  };
}
