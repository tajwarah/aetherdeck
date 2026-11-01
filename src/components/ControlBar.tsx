// The dock: the one fixed control, at the bottom. The globe (home), the person's own sites and tools in their
// order, "Add", and whatever is minimized. Drag an item to reorder it; right-click (or long-press) to move or
// remove it. Everything else (all places, all windows, library, devices, settings) sits behind the chevron.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { groupName, type Win } from "../lib/windows.ts";
import { PLACES, PlacesGrid, type Place } from "./Launcher.tsx";
import { hostOf, moveItem, siteItem, type DockItem } from "../lib/dock.ts";
import { thumbs } from "../lib/desktop.ts";

interface Props {
  wins: Win[];
  home: boolean;
  overview: boolean;
  items: DockItem[];
  onItems: (items: DockItem[]) => void;
  onHome: () => void;
  onItem: (item: DockItem, at: { x: number; y: number }) => void;
  onPlace: (place: Place, at: { x: number; y: number }) => void;
  onOverview: (on: boolean) => void;
  onRestore: (ids: string[]) => void;
  /** Sync across devices: off, shared groups only, or the personal space's connection state. */
  syncState: "off" | "shared" | "connecting" | "live" | "offline" | "gone";
  onSync: () => void;
  onSettings?: () => void;
  /** Desktop app: history, bookmarks and downloads; how many downloads are running. */
  onLibrary?: () => void;
  downloading?: number;
  /** Something is running that the dock should show (a download, an AI answer). */
  aiReady: boolean;
}

const icon = (d: ReactNode, size = 21) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
const at = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

/** The few sites whose marks are drawn here; every other site shows its own icon. */
function Glyph({ item }: { item: DockItem }) {
  const [failed, setFailed] = useState(0);
  if (item.action === "files") return <span className="dk__tile dk__tile--files">{icon(<><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" fill="currentColor" fillOpacity="0.25" /><path d="M3.5 10h17" /></>, 26)}</span>;
  if (item.action === "phone") return <span className="dk__tile dk__tile--phone">{icon(<><rect x="7" y="3" width="10" height="18" rx="2.2" /><path d="M11 18h2" /></>)}</span>;
  if (item.action === "station") return <span className="dk__tile dk__tile--station">{icon(<><circle cx="12" cy="12" r="3" /><circle cx="12" cy="4.5" r="1.6" /><circle cx="18.5" cy="16" r="1.6" /><circle cx="5.5" cy="16" r="1.6" /><path d="M12 6.1V9M17.1 15.2l-2.5-1.5M6.9 15.2l2.5-1.5" /></>)}</span>;
  if (item.action === "research") return <span className="dk__tile dk__tile--research">{icon(<><circle cx="6" cy="7" r="2.500" /><circle cx="18" cy="7" r="2.500" /><circle cx="12" cy="17" r="2.500" /><path d="M8.300 8.300l2.500 6.400M15.700 8.300l-2.500 6.400M8.500 7h7" /></>)}</span>;
  if (item.action === "ai") return <span className="dk__tile dk__tile--ai">{icon(<><path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9Z" fill="currentColor" fillOpacity="0.85" /><path d="M18 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8Z" fill="currentColor" /></>, 26)}</span>;
  const host = hostOf(item.url ?? "");
  if (host === "youtube.com") return <svg className="dk__brand" viewBox="0 0 28 28" width="34" height="34" aria-hidden="true"><rect x="2" y="6" width="24" height="16.5" rx="5" fill="#ff1f1f" /><path d="M11.5 10.3v7.9l6.6-3.95Z" fill="#fff" /></svg>;
  if (host === "open.spotify.com" || host === "spotify.com") return <svg className="dk__brand" viewBox="0 0 28 28" width="34" height="34" aria-hidden="true"><circle cx="14" cy="14" r="12" fill="#1ed760" /><path d="M7.6 10.6c4.2-1.3 9.3-.9 12.9 1.2M8.3 14.2c3.5-1 7.6-.6 10.6 1.1M9 17.6c2.8-.7 5.6-.4 7.9.9" fill="none" stroke="#0b0b0b" strokeWidth="1.9" strokeLinecap="round" /></svg>;
  if (host === "facebook.com") return <svg className="dk__brand" viewBox="0 0 28 28" width="34" height="34" aria-hidden="true"><circle cx="14" cy="14" r="12" fill="#1877f2" /><path d="M15.3 26v-8.6h2.8l.45-3.3H15.3v-2.1c0-.95.3-1.6 1.65-1.6h1.7V7.5c-.3 0-1.3-.12-2.45-.12-2.45 0-4.1 1.5-4.1 4.2v2.5H9.35v3.3h2.75V26Z" fill="#fff" /></svg>;
  const sources = [`https://${host}/apple-touch-icon.png`, `https://${host}/favicon.ico`];
  if (failed >= sources.length) return <span className="dk__tile dk__tile--letter">{item.label.charAt(0).toUpperCase()}</span>;
  return <img className="dk__site" src={sources[failed]} alt="" referrerPolicy="no-referrer" onError={() => setFailed((n) => n + 1)} />;
}

export function ControlBar({ wins, home, overview, items, onItems, onHome, onItem, onPlace, onOverview, onRestore, syncState, onSync, onSettings, onLibrary, downloading = 0, aiReady }: Props) {
  const [gridOpen, setGridOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ index: number; x: number } | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const visible = wins.filter((w) => !w.minimized);
  const minimized = wins.filter((w) => w.minimized);
  // One entry per minimized group (or lone window).
  const entries = [...new Map(minimized.map((w) => [w.group ?? w.id, w])).keys()].map((key) => {
    const members = minimized.filter((w) => (w.group ?? w.id) === key);
    return { key, ids: members.map((m) => m.id), label: members.length > 1 ? groupName(members) : members[0].page.title, count: members.length, first: members[0] };
  });
  const remove = (i: number) => { onItems(items.filter((_, j) => j !== i)); setMenu(null); };
  const move = (i: number, to: number) => { onItems(moveItem(items, i, to)); setMenu((m) => (m ? { ...m, index: Math.max(0, Math.min(items.length - 1, to)) } : m)); };

  return (
    <>
      {gridOpen && <PlacesGrid onPick={(p, a) => { setGridOpen(false); onPlace(p, a); }} onClose={() => setGridOpen(false)} />}
      {adding && <AddPanel items={items} wins={wins} onAdd={(it) => { onItems([...items.filter((x) => x.id !== it.id), it]); setAdding(false); }} onClose={() => setAdding(false)} />}
      {moreOpen && (
        <div className="dk__more" data-ui role="menu" aria-label="More" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setMoreOpen(false); } }}>
          <MoreItem label="All places" onClick={() => { setMoreOpen(false); setGridOpen(true); }} glyph={icon(<><rect x="4" y="4" width="6.5" height="6.5" rx="1.8" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" /></>, 18)} autoFocus />
          {visible.length > 1 && <MoreItem label={overview ? "Back to windows" : "See all windows"} onClick={() => { setMoreOpen(false); onOverview(!overview); }} glyph={icon(<><rect x="7" y="4" width="13" height="10" rx="2" /><path d="M4 8.5V18a2 2 0 0 0 2 2h10" /></>, 18)} />}
          {onLibrary && <MoreItem label={`History, bookmarks, downloads${downloading ? ` (${downloading} running)` : ""}`} onClick={() => { setMoreOpen(false); onLibrary(); }} glyph={icon(<><path d="M5 4.5h3.5v15H5zM10.5 4.5H14v15h-3.5z" /><path d="m16 5.2 3.3-.9 3 14.3-3.3.9z" /></>, 18)} />}
          <MoreItem label={syncState === "live" ? "Devices and sharing · syncing" : "Devices and sharing"} onClick={() => { setMoreOpen(false); onSync(); }} glyph={icon(<><rect x="2.5" y="5" width="13" height="9.5" rx="1.6" /><path d="M6 18h6" /><rect x="15.5" y="9" width="6" height="10.5" rx="1.4" /></>, 18)} />
          {onSettings && <MoreItem label="Settings, AI and search" onClick={() => { setMoreOpen(false); onSettings(); }} glyph={icon(<><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M4.2 12H1.8M22.2 12h-2.4M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7" /></>, 18)} />}
        </div>
      )}
      {menu && items[menu.index] && (
        <div className="dk__menu" data-ui role="menu" style={{ left: menu.x }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setMenu(null); } }}>
          <p className="dk__menu-title">{items[menu.index].label}</p>
          <button role="menuitem" disabled={menu.index === 0} onClick={() => move(menu.index, menu.index - 1)} autoFocus>Move left</button>
          <button role="menuitem" disabled={menu.index === items.length - 1} onClick={() => move(menu.index, menu.index + 1)}>Move right</button>
          <button role="menuitem" className="is-danger" onClick={() => remove(menu.index)}>Remove from dock</button>
        </div>
      )}
      {(menu || moreOpen) && <div className="dk__scrim" onPointerDown={() => { setMenu(null); setMoreOpen(false); }} />}

      <div className="controlbar" data-ui role="toolbar" aria-label="Dock">
        <button className={`dk__item dk__web ${home ? "is-home" : ""}`} onClick={onHome} aria-label="Web — home" title="Home">
          <span className="cb__orb">{icon(<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5Z" /></>, 24)}</span>
          <span className="dk__label">Web</span>
        </button>
        <span className="cb__sep" aria-hidden="true" />
        <nav className="dk__items" aria-label="Your dock">
          {items.map((it, i) => (
            <button key={it.id} className={`dk__item ${drag?.over === i && drag.from !== i ? "is-drop" : ""} ${drag?.from === i ? "is-dragging" : ""}`}
              draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDrag({ from: i, over: i }); }}
              onDragOver={(e) => { if (drag) { e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); } }}
              onDrop={(e) => { e.preventDefault(); if (drag) onItems(moveItem(items, drag.from, i)); setDrag(null); }}
              onDragEnd={() => setDrag(null)}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ index: i, x: at(e.currentTarget).x }); }}
              onKeyDown={(e) => { if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); onItems(moveItem(items, i, i + (e.key === "ArrowLeft" ? -1 : 1))); } }}
              onClick={(e) => onItem(it, at(e.currentTarget))}
              aria-label={it.label} title={`${it.label} · drag to reorder, right-click for options`}>
              <span className="dk__icon"><Glyph item={it} />{it.action === "ai" && aiReady && <span className="dk__dot" aria-hidden="true" />}</span>
              <span className="dk__label">{it.label}</span>
            </button>
          ))}
          <button className="dk__item" onClick={() => setAdding((v) => !v)} aria-expanded={adding} aria-label="Add to the dock" title="Add a site to the dock">
            <span className="dk__icon"><span className="dk__tile dk__tile--add">{icon(<path d="M12 5v14M5 12h14" />, 22)}</span></span>
            <span className="dk__label">Add</span>
          </button>
        </nav>
        {entries.length > 0 && <span className="cb__sep" aria-hidden="true" />}
        {entries.length > 0 && (
          <div className="dk__mins">
            {entries.slice(-5).map((e) => {
              const shot = thumbs.get(e.first.id);
              return (
                <button key={e.key} className="dk__min" onClick={() => onRestore(e.ids)} title={`Restore ${e.label}`} aria-label={`Restore ${e.label}${e.count > 1 ? `, ${e.count} pages` : ""}`}>
                  {shot ? <img src={shot} alt="" /> : <span className="dk__min-name">{e.first.page.kind === "assistant" ? "✦" : e.first.page.domain.replace(/^www\./, "").charAt(0).toUpperCase()}<small>{e.label}</small></span>}
                  {e.count > 1 && <span className="cb__count">{e.count}</span>}
                </button>
              );
            })}
          </div>
        )}
        <button className={`dk__chev ${moreOpen ? "is-on" : ""}`} onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} aria-label="More: all places, windows, library, devices, settings" title="More">
          {icon(<path d={moreOpen ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />, 18)}
          {(downloading > 0 || syncState === "live") && <span className="cb__sync-dot cb__sync-dot--busy" aria-hidden="true" />}
        </button>
      </div>
    </>
  );
}

function MoreItem({ label, glyph, onClick, autoFocus }: { label: string; glyph: ReactNode; onClick: () => void; autoFocus?: boolean }) {
  return <button role="menuitem" className="dk__more-item" onClick={onClick} autoFocus={autoFocus}>{glyph}<span>{label}</span></button>;
}

/** Adding to the dock: an address, an open window's site, or one of the places. */
function AddPanel({ items, wins, onAdd, onClose }: { items: DockItem[]; wins: Win[]; onAdd: (it: DockItem) => void; onClose: () => void }) {
  const [addr, setAddr] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const have = new Set(items.map((i) => i.url && hostOf(i.url)));
  const open = [...new Map(wins.filter((w) => w.page.kind === "web" && !w.private && !have.has(hostOf(w.page.href))).map((w) => [hostOf(w.page.href), w])).values()].slice(0, 4);
  const places = PLACES.filter((p) => p.url && !have.has(hostOf(p.url))).slice(0, 6);
  const tools = (["files", "ai"] as const).filter((a) => !items.some((i) => i.action === a));
  return (
    <section className="dk__add" data-ui role="dialog" aria-label="Add to the dock" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <form onSubmit={(e) => { e.preventDefault(); const it = siteItem(addr, name); if (it) onAdd(it); else setError("Enter a web address, like nytimes.com"); }}>
        <p className="dk__add-title">Add to the dock</p>
        <input ref={input} value={addr} onChange={(e) => { setAddr(e.target.value); setError(""); }} placeholder="Address, e.g. github.com" aria-label="Web address" spellCheck={false} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" aria-label="Name" />
        {error && <p className="dk__add-error" role="alert">{error}</p>}
        <div className="sheet__row"><button className="btn btn--small btn--primary" type="submit" disabled={!addr.trim()}>Add</button><button className="btn btn--small" type="button" onClick={onClose}>Cancel</button></div>
      </form>
      {(open.length > 0 || places.length > 0 || tools.length > 0) && (
        <div className="dk__add-suggest">
          {open.map((w) => <button key={w.id} className="assist__chip" onClick={() => onAdd(siteItem(w.page.href, w.page.title.length < 24 ? w.page.title : undefined)!)}>Open now: {hostOf(w.page.href)}</button>)}
          {tools.map((a) => <button key={a} className="assist__chip" onClick={() => onAdd({ id: a, label: a === "ai" ? "AI" : "Files", action: a })}>{a === "ai" ? "AI assistant" : "Files"}</button>)}
          {places.map((p: Place) => <button key={p.id} className="assist__chip" onClick={() => onAdd({ id: `site:${hostOf(p.url!)}`, label: p.label, url: p.url })}>{p.label}</button>)}
        </div>
      )}
    </section>
  );
}
