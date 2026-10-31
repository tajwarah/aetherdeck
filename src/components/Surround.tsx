// The 360° browser: tabs side by side on the wall of a room around you, in the window or full screen. The page under
// the pointer takes clicks, scrolling and typing as usual; turning is a sideways swipe, the bar's strip, a drag on
// the empty wall, or Option/Alt with the arrow keys. The drawing is in electron/surround-gl.ts; this says what to draw.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FOV, hitPanel, inView, layoutPanels, onPanel, TAU, turn, type Panel, type View } from "../../shared/surround.ts";
import { desktop } from "../lib/desktop.ts";
import type { DockItem } from "../lib/dock.ts";
import { parseOpenRequest, type Win } from "../lib/windows.ts";
import { BUTTON, mods, pageKey } from "./CurvedPage.tsx";

/** Every tab gets the same full-size page, whatever size its window was, so text reads at its proper size. */
const ROOM_ASPECT = 1.45;
const roomSize = () => { const h = Math.max(620, Math.round(window.innerHeight * 0.82)); return { w: Math.round(h * ROOM_ASPECT), h }; };
const STRIP = 112; // the bar's strip, in pixels: all 360° of the room

export const isPage = (w: Win) => w.page.kind === "web" || w.page.kind === "video" || w.page.kind === "videosearch";

interface Props {
  wins: Win[];
  controls: (win: Win) => React.ReactNode;
  dock: DockItem[];
  onFocus: (id: string) => void;
  onOpen: (url: string) => void;
  onDock: (item: DockItem, at: { x: number; y: number }) => void;
  onClose: (id: string) => void;
  onHome: () => void;
  onFloating: () => void;
  /** Bumped by New Window, to open the new-tab box. */
  newTab: number;
}

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

export function Surround({ wins, controls, dock, onFocus, onOpen, onDock, onClose, onHome, onFloating, newTab }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wedge = useRef<HTMLSpanElement>(null);
  const shown = wins.filter((w) => !w.minimized && isPage(w));
  const key = shown.map((w) => w.id).join();
  const panels = useMemo(() => layoutPanels(shown.map((w) => ({ id: w.id, aspect: ROOM_ASPECT }))), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [focus, setFocus] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [size, setSize] = useState(roomSize);
  const sizeNow = useRef(size);
  sizeNow.current = size;
  const panelsNow = useRef<Panel[]>(panels);
  panelsNow.current = panels;
  const focusNow = useRef(focus);
  focusNow.current = focus;
  const motion = useRef({ yaw: 0, fov: FOV.start, target: null as number | null, spin: 0, raf: 0, snap: false, timer: 0 as unknown as ReturnType<typeof setTimeout> });
  const gesture = useRef<{ kind: "turn"; x: number; yaw: number; lastX: number; lastT: number } | { kind: "page"; panel: Panel } | null>(null);

  const view = (): View => { const r = canvas.current!.getBoundingClientRect(); return { yaw: motion.current.yaw, fov: motion.current.fov, aspect: r.width / r.height }; };
  const paint = () => {
    const c = canvas.current;
    if (!c) return;
    c.dataset.yaw = String(motion.current.yaw);
    c.dataset.fov = String(motion.current.fov);
    if (wedge.current) wedge.current.style.left = `${(turn(motion.current.yaw) / TAU + 0.5) * STRIP}px`;
    document.dispatchEvent(new Event("horus-scene"));
    pace();
  };
  /** The tab in use paints at full speed, the others in sight at a third, and those behind you barely at all. */
  const rates = useRef(new Map<string, number>());
  const pace = () => {
    const v = view();
    for (const p of panelsNow.current) {
      const fps = !inView(v, p) ? 4 : p.id === focusNow.current ? 60 : 20;
      if (rates.current.get(p.id) !== fps) { rates.current.set(p.id, fps); void desktop?.invoke("curve:rate", p.id, fps); }
    }
  };
  const run = () => {
    const m = motion.current;
    if (m.raf) return;
    let last = performance.now();
    const step = (now: number) => {
      m.raf = 0;
      // By the clock, not by the frame: the same glide at 60 Hz, at 120, and through a dropped frame.
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (m.target !== null) {
        const d = turn(m.target - m.yaw);
        m.yaw += d * (1 - Math.exp(-dt * 11));
        if (Math.abs(d) < 0.0015) { m.yaw = m.target; m.target = null; }
      } else if (Math.abs(m.spin) > 0.0004) {
        m.yaw = turn(m.yaw + m.spin * dt * 60);
        m.spin *= Math.exp(-dt * 4.4); // a swipe coasts to a stop
      } else {
        m.spin = 0;
        if (m.snap) { m.snap = false; if (snap()) return; }
        const ahead = panelsNow.current.find((p) => Math.abs(turn(m.yaw - p.yaw)) < p.width / 2);
        if (ahead && ahead.id !== focusNow.current) setFocus(ahead.id); // the page ahead of you is the one in use
        return;
      }
      paint();
      m.raf = requestAnimationFrame(step);
    };
    m.raf = requestAnimationFrame(step);
  };
  const lookAt = (yaw: number) => { motion.current.spin = 0; motion.current.target = yaw; run(); };
  /** Settles on the tab you've turned most of the way to. Out on the empty wall, you stay where you are. */
  const snap = () => {
    const m = motion.current;
    const near = panelsNow.current.find((p) => Math.abs(turn(m.yaw - p.yaw)) < p.width * 0.62);
    if (!near || Math.abs(turn(m.yaw - near.yaw)) < 0.002) return false;
    m.raf = 0;
    lookAt(near.yaw);
    return true;
  };

  // The room opens with every page painted fresh into it, and closes the same way, back to their windows.
  useEffect(() => {
    document.documentElement.toggleAttribute("data-surround", true);
    paint();
    canvas.current?.focus();
    const onSize = () => setSize(roomSize());
    window.addEventListener("resize", onSize);
    return () => {
      window.removeEventListener("resize", onSize);
      cancelAnimationFrame(motion.current.raf);
      motion.current.raf = 0;
      document.documentElement.toggleAttribute("data-surround", false);
      queueMicrotask(() => {
        if (document.documentElement.hasAttribute("data-surround")) return; // opened again straight away
        document.dispatchEvent(new Event("horus-scene"));
        void desktop?.invoke("curve:room", null);
        for (const w of wins) {
          void desktop?.invoke("curve:rate", w.id, 60);
          const c = document.querySelector<HTMLCanvasElement>(`canvas[data-curve="${CSS.escape(w.id)}"]`);
          if (c) void desktop?.invoke("curve:resize", w.id, c.clientWidth, c.clientHeight);
          if (!w.minimized) void desktop?.invoke("curve:paint", w.id, true);
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Each tab lays out at the room's page size, and paints itself into the room.
  useEffect(() => { void desktop?.invoke("curve:room", size); }, [size]);
  useEffect(() => {
    for (const w of shown) void desktop?.invoke("curve:paint", w.id, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { if (adding) canvas.current?.blur(); }, [adding]);
  const newTabSeen = useRef(newTab);
  useEffect(() => { if (newTab !== newTabSeen.current) { newTabSeen.current = newTab; setAdding(true); } }, [newTab]);

  useEffect(() => {
    const c = canvas.current!;
    c.dataset.panels = JSON.stringify(panels);
    c.dataset.focus = focus ?? "";
    document.dispatchEvent(new Event("horus-scene"));
    pace();
    if (!panels.some((p) => p.id === focus) && panels.length) { const near = [...panels].sort((a, b) => Math.abs(turn(a.yaw - motion.current.yaw)) - Math.abs(turn(b.yaw - motion.current.yaw)))[0]; setFocus(near.id); lookAt(near.yaw); }
  }, [panels, focus]);

  // Whatever comes to the front, a new tab or a page an agent brought forward, the room turns to face it.
  const front = shown.reduce<Win | null>((a, w) => (!a || w.z > a.z ? w : a), null)?.id;
  useEffect(() => {
    const p = panels.find((x) => x.id === front);
    if (p && p.id !== focusNow.current) { setFocus(p.id); lookAt(p.yaw); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [front, panels]);

  const ndc = (e: { clientX: number; clientY: number }) => { const r = canvas.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: 1 - ((e.clientY - r.top) / r.height) * 2 }; };
  const pagePoint = (_panel: Panel, u: number, v: number) => ({ x: Math.round(u * sizeNow.current.w), y: Math.round(v * sizeNow.current.h) });
  const send = (id: string, event: Record<string, unknown>) => void desktop?.invoke("curve:input", id, event);
  const pendingMove = useRef<{ id: string; event: Record<string, unknown> } | null>(null);

  const down = (e: React.PointerEvent) => {
    canvas.current!.focus();
    canvas.current!.setPointerCapture(e.pointerId);
    motion.current.spin = 0;
    motion.current.target = null;
    const p = ndc(e);
    const hit = hitPanel(view(), panelsNow.current, p.x, p.y);
    if (!hit) { gesture.current = { kind: "turn", x: e.clientX, yaw: motion.current.yaw, lastX: e.clientX, lastT: e.timeStamp }; return; }
    gesture.current = { kind: "page", panel: hit.panel };
    setFocus(hit.panel.id);
    onFocus(hit.panel.id);
    send(hit.panel.id, { type: "mouseDown", ...pagePoint(hit.panel, hit.u, hit.v), button: BUTTON[e.button] ?? "left", clickCount: Math.max(1, e.detail), modifiers: mods(e) });
  };
  const move = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g?.kind === "turn") {
      const perPixel = motion.current.fov / canvas.current!.clientHeight;
      motion.current.yaw = turn(g.yaw - (e.clientX - g.x) * perPixel);
      motion.current.spin = -((e.clientX - g.lastX) * perPixel) / Math.max(1, (e.timeStamp - g.lastT) / 16);
      g.lastX = e.clientX;
      g.lastT = e.timeStamp;
      paint();
      return;
    }
    const p = ndc(e);
    const v = view();
    const at = g?.kind === "page" ? { panel: g.panel, ...onPanel(v, g.panel, p.x, p.y) } : hitPanel(v, panelsNow.current, p.x, p.y);
    if (!at) return;
    const event = { type: "mouseMove", ...pagePoint(at.panel, at.u, at.v), button: BUTTON[e.button] ?? "left", clickCount: 0, modifiers: [...mods(e), ...(e.buttons & 1 ? ["leftButtonDown"] : [])] };
    if (!pendingMove.current) requestAnimationFrame(() => { const m = pendingMove.current; pendingMove.current = null; if (m) send(m.id, m.event); });
    pendingMove.current = { id: at.panel.id, event };
  };
  const up = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === "turn") { motion.current.snap = true; return run(); }
    if (g?.kind !== "page") return;
    const p = onPanel(view(), g.panel, ndc(e).x, ndc(e).y);
    send(g.panel.id, { type: "mouseUp", ...pagePoint(g.panel, p.u, p.v), button: BUTTON[e.button] ?? "left", clickCount: Math.max(1, e.detail), modifiers: mods(e) });
  };

  // A pinch zooms the room, a sideways swipe turns you, and an up-and-down one scrolls the page under the pointer.
  useEffect(() => {
    const c = canvas.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const m = motion.current;
      if (e.ctrlKey) { m.fov = Math.min(FOV.max, Math.max(FOV.min, m.fov * (1 + e.deltaY * 0.01))); paint(); return; }
      const p = ndc(e);
      const hit = hitPanel(view(), panelsNow.current, p.x, p.y);
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey || !hit) {
        m.target = null;
        m.spin = 0;
        m.yaw = turn(m.yaw + (e.shiftKey ? e.deltaY : e.deltaX || e.deltaY) * 0.0016);
        paint();
        clearTimeout(m.timer);
        m.timer = setTimeout(() => { if (!snap()) run(); }, 170);
        return;
      }
      send(hit.panel.id, { type: "mouseWheel", ...pagePoint(hit.panel, hit.u, hit.v), deltaX: 0, deltaY: -e.deltaY, canScroll: true, hasPreciseScrollingDeltas: e.deltaMode === 0, modifiers: [] });
    };
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const keys = (type: "keyDown" | "keyUp", e: React.KeyboardEvent) => {
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      if (type === "keyDown") {
        const list = panelsNow.current;
        const i = list.findIndex((p) => p.id === focusNow.current);
        const next = list[(i + (e.key === "ArrowRight" ? 1 : list.length - 1)) % Math.max(1, list.length)];
        if (next) { setFocus(next.id); onFocus(next.id); lookAt(next.yaw); }
      }
      return;
    }
    if (e.ctrlKey && e.key === "Tab") {
      e.preventDefault();
      if (type === "keyDown") {
        const list = panelsNow.current;
        const i = list.findIndex((p) => p.id === focusNow.current);
        const next = list[(i + (e.shiftKey ? list.length - 1 : 1)) % Math.max(1, list.length)];
        if (next) { setFocus(next.id); onFocus(next.id); lookAt(next.yaw); }
      }
      return;
    }
    const id = focusNow.current;
    if (id) pageKey(id, type, e);
  };

  const go = (q: string) => {
    const s = q.trim();
    if (!s) return;
    const t = parseOpenRequest(s);
    onOpen(t ? t.href : `https://www.google.com/search?q=${encodeURIComponent(s)}`);
    setDraft("");
    setAdding(false);
  };

  const focused = shown.find((w) => w.id === focus);
  const go2 = (p: Panel) => { setFocus(p.id); onFocus(p.id); lookAt(p.yaw); canvas.current?.focus(); };

  // The strip: all 360° of the room in a line. Drag it to turn; click a mark to go to that tab.
  const stripFrom = useRef<{ x: number; yaw: number } | null>(null);
  const stripDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    stripFrom.current = { x: e.clientX, yaw: motion.current.yaw };
    motion.current.target = null;
    motion.current.spin = 0;
  };
  const stripMove = (e: React.PointerEvent) => {
    const from = stripFrom.current;
    if (!from) return;
    motion.current.yaw = turn(from.yaw + ((e.clientX - from.x) / STRIP) * TAU);
    paint();
  };
  const stripUp = () => { stripFrom.current = null; motion.current.snap = true; run(); canvas.current?.focus(); };

  // On the page itself, above everything: the windows' own layer stacks below the search field.
  return createPortal(
    <div className="surround" data-ui>
      <canvas ref={canvas} className="surround__room" data-surround data-keys tabIndex={0} aria-label={`Surround room with ${panels.length} page${panels.length === 1 ? "" : "s"} around you. Option and the arrow keys turn to the next page.`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { gesture.current = null; }}
        onContextMenu={(e) => e.preventDefault()} onKeyDown={(e) => keys("keyDown", e)} onKeyUp={(e) => keys("keyUp", e)} />
      {!panels.length && <p className="surround__empty">Press + on the bar to open a tab.</p>}
      {adding && (
        <div className="surround__add">
          <form onSubmit={(e) => { e.preventDefault(); go(draft); }}>
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Open a site or search" aria-label="Open a site or search" data-keys
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { setAdding(false); canvas.current?.focus(); } }} />
          </form>
          <div className="surround__favs">
            {dock.map((d) => <button key={d.id} className="surround__fav" onClick={(e) => { setAdding(false); onDock(d, { x: e.clientX, y: e.clientY }); }}>{d.label}</button>)}
          </div>
        </div>
      )}
      <div className="surround__hud" role="toolbar" aria-label="Tabs and turning">
        <span className="surround__strip" role="slider" aria-label="Turn the room" aria-valuemin={-180} aria-valuemax={180} aria-valuenow={0} title="Drag to turn"
          onPointerDown={stripDown} onPointerMove={stripMove} onPointerUp={stripUp} onPointerCancel={stripUp}>
          <span className="surround__wedge" ref={wedge} style={{ width: STRIP * 0.24 }} />
          {panels.map((p) => <button key={p.id} className={`surround__mark ${p.id === focus ? "is-on" : ""}`} aria-label="Go to this tab" style={{ left: (turn(p.yaw) / TAU + 0.5) * STRIP }} onPointerDown={(e) => e.stopPropagation()} onClick={() => go2(p)} />)}
        </span>
        {focused ? <span className="surround__bar">{controls(focused)}</span> : <span className="surround__bar" />}
        <span className="surround__tabs" role="tablist" aria-label="Tabs">
          {panels.map((p) => {
            const w = shown.find((x) => x.id === p.id);
            if (!w) return null;
            return (
              <span key={p.id} className={`surround__tab ${p.id === focus ? "is-on" : ""}`}>
                <button role="tab" aria-selected={p.id === focus} title={w.page.title} onClick={() => go2(p)}>
                  {w.page.icon ? <img src={w.page.icon} alt="" width={14} height={14} referrerPolicy="no-referrer" /> : <span className="surround__tabdot" aria-hidden="true" />}
                  <span className="surround__tabname">{w.page.title}</span>
                </button>
                <button className="surround__tabx" aria-label={`Close ${w.page.title}`} title="Close tab" onClick={() => onClose(p.id)}>×</button>
              </span>
            );
          })}
        </span>
        <button className="orn" aria-label="New tab" title="New tab" aria-expanded={adding} onClick={() => setAdding((a) => !a)}><Icon d="M12 5v14M5 12h14" /></button>
        <button className="orn" aria-label="Full screen" title="Full screen" onClick={() => void desktop?.invoke("app:toggleFullscreen")}><Icon d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></button>
        <button className="orn" aria-label="Floating windows" title="Switch to floating windows" onClick={onFloating}><Icon d="M4 5h10v8H4ZM10 13v6h10v-8h-6" /></button>
        <button className="orn" aria-label="Home" title="Home" onClick={onHome}><Icon d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" /></button>
      </div>
    </div>,
    document.body,
  );
}

