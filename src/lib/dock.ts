// The dock's contents: the person's own sites and tools, in their order. Kept in this browser's storage.

export type DockAction = "files" | "ai" | "station" | "phone";

export interface DockItem {
  id: string;
  label: string;
  /** A site the item opens (or brings back, when a window of it is already open). */
  url?: string;
  /** A built-in tool instead of a site. */
  action?: DockAction;
}

export const DEFAULT_DOCK: DockItem[] = [
  { id: "youtube", label: "YouTube", url: "https://www.youtube.com/" },
  { id: "spotify", label: "Spotify", url: "https://open.spotify.com/" },
  { id: "facebook", label: "Facebook", url: "https://www.facebook.com/" },
  { id: "files", label: "Files", action: "files" },
  { id: "ai", label: "AI", action: "ai" },
  { id: "station", label: "Agents", action: "station" },
  { id: "phone", label: "Phone", action: "phone" },
];

const KEY = "horus.dock.v1";

export function loadDock(): DockItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const items = raw ? (JSON.parse(raw) as DockItem[]) : null;
    if (!Array.isArray(items)) return DEFAULT_DOCK;
    const kept = items.filter((i) => i && typeof i.id === "string" && typeof i.label === "string" && (i.url || i.action));
    // A dock from before the Agent Station gets it once; after that, removing it is the person's choice.
    if (!localStorage.getItem(`${KEY}.station`) && !kept.some((i) => i.action === "station")) kept.push({ id: "station", label: "Agents", action: "station" });
    if (!localStorage.getItem(`${KEY}.phone`) && !kept.some((i) => i.action === "phone")) kept.push({ id: "phone", label: "Phone", action: "phone" });
    return kept;
  } catch {
    return DEFAULT_DOCK;
  }
}

export function saveDock(items: DockItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
    for (const a of ["station", "phone"]) if (items.some((i) => i.action === a)) localStorage.setItem(`${KEY}.${a}`, "1");
  } catch { /* storage unavailable: the dock lasts for this visit */ }
}

export const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** A dock item for a site, from what the person typed ("nytimes.com", "https://…"). Null when it isn't an address. */
export function siteItem(input: string, label?: string): DockItem | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  const host = hostOf(url);
  if (!host.includes(".")) return null;
  const name = label?.trim() || host.split(".").slice(-2, -1)[0].replace(/^./, (c) => c.toUpperCase());
  return { id: `site:${host}`, label: name, url };
}

/** Move one item to another position. Pure; exported for tests. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return items;
  const next = [...items];
  const [it] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, it);
  return next;
}
