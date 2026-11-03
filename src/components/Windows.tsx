// Floating windows. A browser window holds tabs, shown one at a time: its tab strip on top, then a bar with the
// address and the window's controls; drag either to move it. The windows behind the one you are using recede.
// Windows dropped beside each other link into a
// group, drawn as a thread of light, and the group moves, arranges, minimizes and restores together.
// Sites that refuse to be framed say so and open in the person's own browser instead; nothing is proxied.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { captureBeforeMinimize, desktop, pages } from "../lib/desktop.ts";
import { LiveControls, LivePage, type LiveState } from "./LivePage.tsx";
import { Assistant } from "./Assistant.tsx";
import { CurvedPage } from "./CurvedPage.tsx";
import type { DockItem } from "../lib/dock.ts";
import { PhoneScreen } from "./PhoneScreen.tsx";
import { Surround } from "./Surround.tsx";
import type { CrewMember } from "./RoomWidgets.tsx";
import { arrangeGroup, awayTabs, boundsOf, closeTab, edgeGap, groupName, membersOf, overviewTiles, regroupAfterDrop, showTab, SNAP, tabsOf, toggleMaximize, videoTab, type Tab, type Win } from "../lib/windows.ts";

interface Props {
  wins: Win[];
  update: (fn: (w: Win[]) => Win[]) => void;
  overview: boolean;
  onOverview: (on: boolean) => void;
  /** "+": open the composer to add a page beside this window, in its group. */
  onAddPage: (win: Win) => void;
  /** The crew, for the 360° room's agents widget, and the way to the Agent Station. */
  roomCrew: CrewMember[];
  onRoomCrew: () => void;
  /** The + on a window's tab strip: a new tab in that window. */
  onNewTab: (win: Win) => void;
  /** Read a page inside the space instead (the reading view), for sites that cannot be framed. */
  onRead: (url: string) => void;
  /** Groups shared with other people (see useSync): they keep together and show who is there. */
  shared: ReadonlySet<string>;
  sharePeers: Record<string, number>;
  onShare: (group: string) => void;
  /** Desktop app: a question typed into a page's address bar becomes a map. */
  onAsk: (q: string) => void;
  /** The 360° view: tabs side by side around the person. */
  surround: boolean;
  onRoomHome: () => void;
  onFloating: () => void;
  onOpenUrl: (url: string) => void;
  dock: DockItem[];
  onDock: (item: DockItem, at: { x: number; y: number }) => void;
  newTab: number;
  /** Desktop app: the window whose find bar is open, and the window whose address was asked for (with a counter). */
  findIn: string | null;
  onFindClose: () => void;
  addressFocus: { id: string; seq: number } | null;
  /** The assistant: the connected model (or null), whether it reads images, and how to connect one. */
  ai: { model: string | null; vision: boolean };
  onConnectAI: () => void;
  /** A file dropped onto an assistant window replaces what it holds. */
  onAttach: (win: Win, file: File) => void;
  /** Keep this window's site in the dock. */
  onPin: (win: Win) => void;
  pinned: (win: Win) => boolean;
}

const MIN_W = 320;
const MIN_H = 220;

/**
 * A drag or resize in progress. While it lasts the windows move on the GPU (their `translate`, or their size for a
 * resize) without re-rendering anything; the new frame is committed to the app's state once, when it ends.
 */
type Gesture = {
  kind: "move" | "size" | "group"; id: string; sx: number; sy: number; start: Map<string, { x: number; y: number; w: number; h: number }>; moved: boolean; edge?: string;
  dx: number; dy: number; raf: number;
};
/** Resize handles: every edge and corner (n, s, e, w and the four between). */
const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export function Windows({ wins, update, overview, onOverview, onAddPage, onNewTab, roomCrew, onRoomCrew, onRead, shared, sharePeers, onShare, onAsk, findIn, onFindClose, addressFocus, ai, onConnectAI, onAttach, onPin, pinned, surround, onRoomHome, onFloating, onOpenUrl, dock, onDock, newTab }: Props) {
  const [live, setLive] = useState<Record<string, LiveState>>({});
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-fullpage", !!fullscreen);
    if (!fullscreen) return;
    // Leaving full screen from the menu or the green button takes the page out of it too.
    return desktop?.on("warpnaut:fullscreen", (on) => { if (!on) { void desktop!.invoke("curve:exitFullscreen", fullscreen); setFullscreen(null); } });
  }, [fullscreen]);
  const [flat, setFlat] = useState<ReadonlySet<string>>(new Set()); // pages the curve engine couldn't take
  const [busy, setBusy] = useState(false); // while dragging, frames stop eating pointer events
  const [snapTo, setSnapTo] = useState<string | null>(null);
  const [reloads, setReloads] = useState<Record<string, number>>({});
  const gesture = useRef<Gesture | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const away = surround ? new Set<string>() : awayTabs(wins); // tabs behind the one showing in their window; in the room every tab shows
  const visible = wins.filter((w) => !w.minimized && !away.has(w.id));
  const front = visible.reduce<Win | undefined>((a, w) => (!a || w.z > a.z ? w : a), undefined);
  const tiles = overview ? overviewTiles(visible, vw, vh) : null;

  const raise = (ids: string[]) => update((ws) => {
    let top = Math.max(0, ...ws.map((w) => w.z));
    if (ids.length === 1 && ws.find((w) => w.id === ids[0])?.z === top) return ws;
    const z = new Map(ids.map((id) => [id, ++top]));
    return ws.map((w) => (z.has(w.id) ? { ...w, z: z.get(w.id)! } : w));
  });

  const begin = (e: RPointerEvent, kind: Gesture["kind"], id: string, ids: string[], edge?: string) => {
    if (e.button !== 0 || overview) return;
    e.preventDefault();
    const start = new Map(wins.filter((w) => ids.includes(w.id)).map((w) => [w.id, { x: w.x, y: w.y, w: w.w, h: w.h }]));
    gesture.current = { kind, id, sx: e.clientX, sy: e.clientY, start, moved: false, edge, dx: 0, dy: 0, raf: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setBusy(true);
  };

  /** Where a window being moved or resized is right now, given how far the pointer has gone. */
  const placed = (g: Gesture, w: Win): Win => {
    const s = g.start.get(w.id);
    if (!s) return w;
    const { dx, dy } = g;
    if (g.kind !== "size") return { ...w, x: Math.max(-s.w + 120, Math.min(vw - 120, s.x + dx)), y: Math.max(56, Math.min(vh - 120, s.y + dy)), restore: undefined };
    const edge = g.edge ?? "se";
    let { x, y, w: width, h } = s;
    if (edge.includes("e")) width = Math.max(MIN_W, s.w + dx);
    if (edge.includes("s")) h = Math.max(MIN_H, s.h + dy);
    if (edge.includes("w")) { width = Math.max(MIN_W, s.w - dx); x = s.x + s.w - width; }
    if (edge.includes("n")) { h = Math.max(MIN_H, s.h - dy); y = Math.max(56, s.y + s.h - h); h = s.y + s.h - y; }
    return { ...w, x, y, w: width, h, restore: undefined };
  };

  /** One frame of a gesture: the moving windows, their group's threads and toolbar, straight in the DOM. */
  const paint = () => {
    const g = gesture.current;
    if (!g) return;
    g.raf = 0;
    const now = visible.map((w) => placed(g, w));
    const stage = stageRef.current;
    if (!stage) return;
    for (const w of now) {
      const s = g.start.get(w.id);
      const el = s && stage.querySelector<HTMLElement>(`[data-window="${w.id}"]`);
      if (!s || !el) continue;
      if (g.kind === "size") Object.assign(el.style, { left: `${w.x}px`, top: `${w.y}px`, width: `${w.w}px`, height: `${w.h}px` });
      else el.style.translate = `${w.x - s.x}px ${w.y - s.y}px`;
    }
    for (const l of linksOf(now)) for (const path of stage.querySelectorAll<SVGPathElement>(`[data-link="${l.key}"]`)) path.setAttribute("d", l.d);
    for (const [group, el] of [...stage.querySelectorAll<HTMLElement>("[data-group]")].map((el) => [el.dataset.group!, el] as const)) {
      const b = boundsOf(membersOf(now, group));
      el.style.left = `${b.x + b.w / 2}px`;
      el.style.top = `${Math.min(b.y + b.h + 48, vh - 168)}px`;
    }
    if (g.kind === "move") {
      // Show which window this one would join if dropped now.
      const me = now.find((w) => w.id === g.id);
      const near = !me || (me.group && shared.has(me.group)) ? undefined : now.find((w) => w.id !== g.id && (!me.group || w.group !== me.group) && edgeGap(me, w) <= SNAP);
      setSnapTo(near?.id ?? null);
    }
  };

  const onMove = (e: RPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    g.dx = e.clientX - g.sx;
    g.dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(g.dx, g.dy) < 4) return;
    g.moved = true;
    if (!g.raf) g.raf = requestAnimationFrame(paint);
  };

  const onEnd = () => {
    const g = gesture.current;
    gesture.current = null;
    setBusy(false);
    setSnapTo(null);
    if (!g) return;
    cancelAnimationFrame(g.raf);
    if (!g.moved) return;
    const final = new Map(wins.filter((w) => g.start.has(w.id)).map((w) => [w.id, placed(g, w)]));
    // Hand the frame back from the GPU to the layout before React renders it, so nothing slides or jumps.
    for (const [id, w] of final) {
      const el = stageRef.current?.querySelector<HTMLElement>(`[data-window="${id}"]`);
      if (!el) continue;
      Object.assign(el.style, { translate: "", left: `${w.x}px`, top: `${w.y}px`, width: `${w.w}px`, height: `${w.h}px` });
      el.getBoundingClientRect();
    }
    update((ws) => {
      const next = ws.map((w) => final.get(w.id) ?? w);
      return g.kind === "move" ? regroupAfterDrop(next, g.id, shared) : next;
    });
  };

  const nudge = (win: Win, dx: number, dy: number) => update((ws) => regroupAfterDrop(ws.map((w) => (w.id === win.id ? { ...w, x: w.x + dx, y: w.y + dy, restore: undefined } : w)), win.id, shared));
  const setMin = (list: string[], minimized: boolean) => {
    const stacks = new Set(wins.filter((w) => list.includes(w.id) && w.stack).map((w) => w.stack));
    const ids = wins.filter((w) => list.includes(w.id) || (w.stack && stacks.has(w.stack))).map((w) => w.id); // a window minimizes with all its tabs
    const apply = () => update((ws) => ws.map((w) => (ids.includes(w.id) ? { ...w, minimized } : w)));
    if (minimized) void captureBeforeMinimize(ids).then(apply); else apply();
  };

  const groups = [...new Set(visible.map((w) => w.group).filter(Boolean))] as string[];
  const links = linksOf(visible);

  return (
    <div className={`windows ${busy ? "is-busy" : ""} ${overview ? "is-overview" : ""}`} data-ui onPointerMove={onMove} onPointerUp={onEnd} onPointerCancel={onEnd}>
      <div className="stage" ref={stageRef}>
        <svg className="links" aria-hidden="true" width={vw} height={vh}>
          {links.map((l) => (
            <g key={l.key}><path d={l.d} data-link={l.key} className="link link--glow" /><path d={l.d} data-link={l.key} className="link" /></g>
          ))}
        </svg>

        {/* Minimized windows stay mounted (hidden), so a page keeps its place, its sound and its sign-in. */}
        {wins.map((win) => {
          const t = win.page;
          const isFront = win.id === front?.id;
          const grouped = !!win.group;
          const ids = [win.id];
          const tile = tiles?.get(win.id);
          const isAssistant = t.kind === "assistant";
          const isPhone = t.kind === "phone";
          const isFull = fullscreen === win.id;
          const isWeb = t.kind === "web" || t.kind === "video" || t.kind === "videosearch";
          // Pages are flat, real pages in their windows; only in the 360° view are they drawn on the wall around you.
          const bent = !!desktop && surround && isWeb && !flat.has(win.id);
          const bend = win.restore ? 1 : Math.round(Math.min(0.8, Math.max(0.3, win.w / vw)) * 100) / 100;
          const hidden = win.minimized || away.has(win.id);
          const tabbed = !!desktop && isWeb && !isFull;
          const tabs = tabbed ? tabsOf(wins, win) : [];
          return (
            <section key={win.id} aria-hidden={hidden || undefined} className={`win ${hidden ? "is-min" : ""} ${fullscreen === win.id ? "is-fullscreen" : ""} ${win.private ? "is-private" : ""} ${isFront ? "is-front" : ""} ${isPhone ? "is-bent" : ""} ${grouped ? "is-grouped" : ""} ${win.group && shared.has(win.group) ? "is-shared" : ""} ${snapTo === win.id ? "is-snap" : ""} ${win.restore ? "is-max" : ""} ${bent ? "is-bent" : ""} ${tabbed ? "has-tabs" : ""}`}
              data-window={win.id} role="dialog" aria-label={t.title}
              style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z,
                transformOrigin: tile ? "0 0" : win.origin ? `${win.origin.x - win.x}px ${win.origin.y - win.y}px` : undefined,
                transform: tile ? `translate(${tile.dx}px, ${tile.dy}px) scale(${tile.s})` : undefined }}
              onPointerDownCapture={() => { if (overview) return; raise(win.group ? [...membersOf(wins, win.group).filter((m) => m.id !== win.id).map((m) => m.id), win.id] : ids); }}
              onClickCapture={(e) => { if (overview) { e.preventDefault(); e.stopPropagation(); raise(ids); onOverview(false); } }}
              onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setMin(win.group ? membersOf(wins, win.group).map((m) => m.id) : ids, true); } }}>

              {/* the frost: the backdrop blurred only where the glass shows (bar and rim), not behind the page */}
              <span className="win__frost" aria-hidden="true"><i /><i /><i /><i /></span>
              <div className="win__glass">
                {tabbed && (
                  <nav className="win__tabs" aria-label="Tabs"
                    onPointerDown={(e) => { if (!(e.target as HTMLElement).closest("button")) begin(e, "move", win.id, ids); }}
                    onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button")) update((ws) => ws.map((w) => (w.id === win.id ? toggleMaximize(w, vw, vh) : w))); }}>
                    <span className="win__tablist" role="tablist">
                      {tabs.map((x) => (
                        <span key={x.id} className={`win__tab ${x.id === win.id ? "is-on" : ""}`}>
                          <button role="tab" aria-selected={x.id === win.id} title={x.page.title} onClick={() => update((ws) => showTab(ws, x.id))}>
                            <Favicon tab={x.page} /><span className="win__tabname">{x.page.title}</span>
                          </button>
                          <button className="win__tabx" aria-label={`Close ${x.page.title}`} title="Close tab" onClick={() => update((ws) => closeTab(ws, x.id))}>
                            <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 7l10 10M17 7 7 17" /></svg>
                          </button>
                        </span>
                      ))}
                    </span>
                    <button className="win__newtab" aria-label="New tab" title="New tab" onClick={() => onNewTab(win)}>
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                    </button>
                  </nav>
                )}
                <header className="win__bar"
                  onPointerDown={(e) => { if (!(e.target as HTMLElement).closest("button, a, input, label")) begin(e, "move", win.id, ids); }}
                  onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button, a, input, label")) update((ws) => ws.map((w) => (w.id === win.id ? toggleMaximize(w, vw, vh) : w))); }}>
                  <span className="win__grab" role="button" tabIndex={0} aria-label="Move window. Drag, or use the arrow keys. Drop beside another window to group them."
                    title="Drag to move · drop beside another window to group · double-click to maximize"
                    onKeyDown={(e) => {
                      const step = e.shiftKey ? 120 : 40;
                      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
                      if (d) { e.preventDefault(); nudge(win, d[0], d[1]); }
                    }}>
                    {!tabbed && <Favicon tab={t} />}
                    {/* a web page's address says where it is; its title only when that adds something */}
                    {isAssistant || isPhone ? <span className="win__title">{t.title}</span>
                    : !desktop && (t.kind !== "web" || t.title !== t.domain) && <span className="win__title">{t.kind === "web" ? t.title : t.kind === "video" ? "YouTube" : `YouTube · ${t.src}`}</span>}
                  </span>
                  {isAssistant || isPhone ? <span className="win__spacer" />
                  : desktop ? <LiveControls win={win} live={live[win.id]} onAsk={onAsk} focusSeq={addressFocus?.id === win.id ? addressFocus.seq : 0} />
                  : t.kind === "web" ? (
                    <span className="win__addr" title={t.href}>
                      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                      <span>{t.domain}</span>
                    </span>
                  ) : <span className="win__spacer" />}
                  <span className="win__tools">
                    {!desktop && t.kind === "web" && <Orn label="Reload" onClick={() => setReloads((r) => ({ ...r, [win.id]: (r[win.id] ?? 0) + 1 }))}>
                      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4" /></svg>
                    </Orn>}
                    {!isAssistant && !win.private && <Orn label={pinned(win) ? "Kept in the dock" : "Keep in the dock"} onClick={() => onPin(win)}>
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill={pinned(win) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M9 4h6l-1 6 3 3H7l3-3-1-6ZM12 13v7" /></svg>
                    </Orn>}
                    {!isPhone && <Orn label={grouped ? "Add a page to this group" : "Add a page beside, as a group"} onClick={() => onAddPage(win)}>
                      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                    </Orn>}
                    <Orn label={win.restore ? "Restore size" : "Maximize"} onClick={() => update((ws) => ws.map((w) => (w.id === win.id ? toggleMaximize(w, vw, vh) : w)))}>
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{win.restore ? <path d="M9 4v5H4M15 20v-5h5M15 4v5h5M9 20v-5H4" /> : <path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5" />}</svg>
                    </Orn>
                    {isAssistant || isPhone ? null : desktop ? <Orn label="Open in your other browser" onClick={() => void desktop!.invoke("app:openExternal", pages.get(win.id)?.url() ?? t.href)}>
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
                    </Orn> : <a className="orn" href={t.href} target="_blank" rel="noopener noreferrer" aria-label="Pop out to a browser tab" title="Pop out to a browser tab">
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
                    </a>}
                    <Orn label="Minimize" onClick={() => setMin(ids, true)}>
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 12h12" /></svg>
                    </Orn>
                    <button className="orn orn--close" aria-label="Close window" title={tabs.length > 1 ? "Close the window and its tabs" : "Close"} onClick={() => update((ws) => ws.filter((w) => w.id !== win.id && !(win.stack && w.stack === win.stack)))}>
                      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M7 7l10 10M17 7 7 17" /></svg>
                    </button>
                  </span>
                </header>
                <div className="win__body">
                  {isAssistant ? <Assistant tab={t} model={ai.model} vision={ai.vision} onConnect={onConnectAI} onAttach={(f) => onAttach(win, f)} />
                  : isPhone ? <PhoneScreen win={win} bend={bend}
                      onShape={(aspect, name) => update((ws) => ws.map((w) => (w.id === win.id ? { ...w, ...(w.restore ? {} : phoneShape(aspect, vw, vh)), page: name ? { ...w.page, title: name } : w.page } : w)))} />
                  : bent ? <CurvedPage win={win} bend={bend} finding={findIn === win.id} onFindClose={onFindClose} onState={(st) => setLive((l) => ({ ...l, [win.id]: st }))}
                      onNavigate={(p) => update((ws) => ws.map((w) => (w.id === win.id ? { ...w, page: { ...w.page, ...p } } : w)))}
                      onFocus={() => raise(win.group ? [...membersOf(wins, win.group).filter((m) => m.id !== win.id).map((m) => m.id), win.id] : ids)}
                      onFullscreen={(on) => { if (surround) return; setFullscreen(on ? win.id : null); void desktop!.invoke("app:fullscreen", on); }}
                      onFail={() => setFlat((f) => new Set(f).add(win.id))} />
                  : desktop ? <LivePage win={win} finding={findIn === win.id} onFindClose={onFindClose}
                      onState={(st) => setLive((l) => ({ ...l, [win.id]: st }))}
                      onNavigate={(p) => update((ws) => ws.map((w) => (w.id === win.id ? { ...w, page: { ...w.page, ...p } } : w)))}
                      onFocus={() => raise(win.group ? [...membersOf(wins, win.group).filter((m) => m.id !== win.id).map((m) => m.id), win.id] : ids)}
                      onFullscreen={(on) => { setFullscreen(on ? win.id : null); void desktop!.invoke("app:fullscreen", on); }} />
                  : t.kind === "video" ? <VideoFrame tab={t} />
                    : t.kind === "videosearch" ? <VideoSearch tab={t} onPick={(v) => update((ws) => ws.map((w) => (w.id === win.id ? { ...w, page: { ...v, id: t.id } } : w)))} />
                    : <WebFrame key={reloads[win.id] ?? 0} tab={t} onRead={onRead} />}
                </div>
              </div>
              {EDGES.map((edge) => <span key={edge} className={`win__edge win__edge--${edge}`} aria-hidden="true" onPointerDown={(e) => begin(e, "size", win.id, ids, edge)} />)}
            </section>
          );
        })}

        {groups.map((g) => {
          const m = membersOf(visible, g);
          const b = boundsOf(m);
          const ids = membersOf(wins, g).map((w) => w.id);
          const anchor = m.reduce((a, w) => (w.x > a.x ? w : a), m[0]);
          const isShared = shared.has(g);
          const others = Math.max(0, (sharePeers[g] ?? 1) - 1);
          return (
            <div key={g} data-group={g} className={`group-orn ${isShared ? "is-shared" : ""}`} role="group" aria-label={`Group: ${groupName(m)}${isShared ? ", shared" : ""}`} style={{ left: b.x + b.w / 2, top: Math.min(b.y + b.h + 48, vh - 168), zIndex: Math.max(...m.map((w) => w.z)) }}>
              <span className="group-orn__grab" role="button" tabIndex={0} aria-label="Move the whole group" title="Drag to move the whole group" onPointerDown={(e) => begin(e, "group", m[0].id, ids)}>
                <span className="group-orn__dot" aria-hidden="true" />{groupName(m)}<span className="group-orn__n">{m.length}</span>
              </span>
              {isShared && <button className="group-orn__shared" onClick={() => onShare(g)} title="Shared: see the link and who is here">Shared{others ? ` · ${others} here` : ""}</button>}
              <Orn label="Arrange side by side" onClick={() => update((ws) => arrangeGroup(ws, g, vw, vh))}>⇆</Orn>
              <Orn label="Add a page to this group" onClick={() => onAddPage(anchor)}>＋</Orn>
              <Orn label="Minimize group" onClick={() => setMin(ids, true)}>–</Orn>
              {!isShared && <Orn label="Share group" onClick={() => onShare(g)}>
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="6" cy="12" r="2.4" /><circle cx="17.5" cy="6" r="2.4" /><circle cx="17.5" cy="18" r="2.4" /><path d="m8.2 10.9 7.1-3.7M8.2 13.1l7.1 3.7" /></svg>
              </Orn>}
              {!isShared && <Orn label="Ungroup" onClick={() => update((ws) => ws.map((w) => (w.group === g ? { ...w, group: undefined } : w)))}>⤫</Orn>}
            </div>
          );
        })}
      </div>
      {surround && <Surround wins={wins} dock={dock} newTab={newTab} crew={roomCrew} onCrew={onRoomCrew} onFocus={(id) => raise([id])} onOpen={onOpenUrl} onDock={onDock} onHome={onRoomHome} onFloating={onFloating}
        onClose={(id) => update((ws) => closeTab(ws, id))}
        controls={(w) => <LiveControls win={w} live={live[w.id]} onAsk={onAsk} focusSeq={addressFocus?.id === w.id ? addressFocus.seq : 0} />} />}
    </div>
  );
}

/** Threads of light between neighbours in each group, edge to edge. */
function linksOf(visible: Win[]) {
  const groups = [...new Set(visible.map((w) => w.group).filter(Boolean))] as string[];
  return groups.flatMap((g) => {
    const m = membersOf(visible, g).sort((a, b) => a.x - b.x);
    return m.slice(1).map((b, i) => {
      const a = m[i];
      const p = { x: a.x + a.w, y: a.y + a.h / 2 };
      const q = { x: b.x, y: b.y + b.h / 2 };
      if (q.x < p.x) { p.x = a.x + a.w / 2; p.y = a.y + a.h; q.x = b.x + b.w / 2; q.y = b.y + b.h; }
      const mx = (p.x + q.x) / 2;
      return { key: `${a.id}-${b.id}`, d: `M${p.x} ${p.y} C${mx} ${p.y - 30}, ${mx} ${q.y + 30}, ${q.x} ${q.y}` };
    });
  });
}

/** The site's own icon, from the site itself; its initial when it has none. */
/** A phone's window: as tall as fits above the dock, as wide as the phone's shape, with room for its buttons. */
function phoneShape(aspect: number, vw: number, vh: number) {
  const h = Math.round(Math.min(860, vh - 230));
  const w = Math.round(Math.min(vw * 0.9, (h - 54) * aspect + 92));
  return { w, h, y: 96 };
}

function Favicon({ tab }: { tab: Tab }) {
  const [failed, setFailed] = useState(false);
  if (tab.icon && !failed) return <img className="win__mark win__mark--icon" src={tab.icon} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  if (tab.kind === "assistant") return <span className="win__mark win__mark--assistant" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9Z" fill="currentColor" /></svg></span>;
  if (tab.kind !== "web") return <span className="win__mark win__mark--video" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M9 7l8 5-8 5Z" fill="currentColor" /></svg></span>;
  if (failed) return <span className="win__mark" aria-hidden="true">{tab.domain.charAt(0).toUpperCase()}</span>;
  return <img className="win__mark win__mark--icon" src={`https://${tab.domain}/favicon.ico`} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function Orn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button className="orn" aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads";
const ALLOW = "fullscreen; picture-in-picture; encrypted-media; autoplay; clipboard-write";

function VideoFrame({ tab }: { tab: Tab }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && <p className="win__state">Loading the player…</p>}
      <iframe className="win__frame" src={tab.src} title={tab.title} allow={ALLOW} allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onLoad={() => setLoaded(true)} />
      <p className="win__fine">Played by YouTube's own player (privacy-enhanced mode). YouTube sees what you watch here.</p>
    </>
  );
}

function WebFrame({ tab, onRead }: { tab: Tab; onRead: (url: string) => void }) {
  const [state, setState] = useState<{ status: "checking" | "ok" | "blocked"; reason?: string }>({ status: "checking" });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/frameable?url=${encodeURIComponent(tab.src)}`)
      .then((r) => r.json())
      .then((j: { frameable: boolean; reason?: string }) => { if (alive) setState(j.frameable ? { status: "ok" } : { status: "blocked", reason: j.reason }); })
      .catch(() => { if (alive) setState({ status: "blocked", reason: "Could not reach the site" }); });
    return () => { alive = false; };
  }, [tab.src]);
  if (state.status === "checking") return <p className="win__state">Asking {tab.domain} whether it can be shown here…</p>;
  if (state.status === "blocked") {
    return (
      <div className="win__state win__state--blocked">
        <p className="win__big">{tab.domain} asks not to be shown inside other apps.</p>
        <p className="fine">{state.reason}. It will open in your own browser instead, or Warpnaut can read its leading paragraphs in the space.</p>
        <div className="win__actions">
          <a className="btn btn--primary" href={tab.href} target="_blank" rel="noopener noreferrer">Open in a new tab</a>
          <button className="btn" onClick={() => onRead(tab.href)}>Read here</button>
        </div>
      </div>
    );
  }
  return (
    <>
      {!loaded && <p className="win__state">Loading {tab.domain}…</p>}
      <iframe className="win__frame" src={tab.src} title={tab.title} sandbox={SANDBOX} allow={ALLOW} referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} />
    </>
  );
}

interface Video { id: string; title: string; channel: string; publishedAt: string; thumbnail?: string }

/** "play …": results from YouTube's search API when a key is set; otherwise an honest hand-off to YouTube itself. */
function VideoSearch({ tab, onPick }: { tab: Tab; onPick: (v: Omit<Tab, "id">) => void }) {
  const [state, setState] = useState<{ status: "loading" | "ok" | "unconfigured" | "error"; items: Video[]; error?: string }>({ status: "loading", items: [] });
  useEffect(() => {
    let alive = true;
    fetch(`/api/videos?q=${encodeURIComponent(tab.src)}`)
      .then(async (r) => ({ ok: r.ok, body: (await r.json()) as { configured?: boolean; items?: Video[]; error?: string } }))
      .then(({ ok, body }) => { if (alive) setState(!ok ? { status: "error", items: [], error: body.error } : body.configured ? { status: "ok", items: body.items ?? [] } : { status: "unconfigured", items: [] }); })
      .catch(() => { if (alive) setState({ status: "error", items: [], error: "Could not reach the search service" }); });
    return () => { alive = false; };
  }, [tab.src]);
  if (state.status === "loading") return <p className="win__state">Searching videos for “{tab.src}”…</p>;
  if (state.status !== "ok" || !state.items.length) {
    return (
      <div className="win__state win__state--blocked">
        <p className="win__big">{state.status === "unconfigured" ? "Video search needs a free YouTube API key." : state.status === "error" ? state.error : `No videos found for “${tab.src}”.`}</p>
        <p className="fine">{state.status === "unconfigured" ? "Add YOUTUBE_API_KEY to warpnaut/.env (see .env.example). Until then, search on YouTube itself; any video link you paste here still plays in a window." : "Try YouTube itself, or paste a video link here."}</p>
        <div className="win__actions"><a className="btn btn--primary" href={tab.href} target="_blank" rel="noopener noreferrer">Search on YouTube</a></div>
      </div>
    );
  }
  return (
    <div className="videos" role="list" aria-label={`Videos for ${tab.src}`}>
      {state.items.map((v) => (
        <button key={v.id} role="listitem" className="video" onClick={() => onPick(videoTab(v.id, v.title))}>
          {v.thumbnail ? <img src={v.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="video__none" />}
          <span className="video__title">{v.title}</span>
          <span className="video__meta">{v.channel} · {new Date(v.publishedAt).toLocaleDateString(undefined, { year: "numeric", month: "short" })}</span>
        </button>
      ))}
      <p className="win__fine videos__fine">Results from the YouTube Data API. Playing opens YouTube's own player.</p>
    </div>
  );
}
