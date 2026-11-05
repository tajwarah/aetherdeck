// Every page on a curved screen: the curve engine. The page renders offscreen in the desktop app and its frames are
// wrapped on a cylinder in this canvas (electron/curve-gl.ts); here the person's pointer, wheel and keys are
// mapped back through the curve (shared/curve.ts) to the point of the page they are over, and delivered to it.
import { useEffect, useRef, useState } from "react";
import { curveFor, toPage } from "../../shared/curve.ts";
import { desktop, pages } from "../lib/desktop.ts";
import { FindBar, liveSrc, type LiveState } from "./LivePage.tsx";
import type { Tab, Win } from "../lib/windows.ts";

interface Props {
  win: Win;
  onState: (s: LiveState) => void;
  onNavigate: (page: Partial<Tab>) => void;
  onFocus: () => void;
  onFullscreen: (on: boolean) => void;
  /** This page can't be curved here; the window shows it flat instead. */
  onFail: () => void;
  /** How far the page bends, from 0 to 1. */
  bend: number;
  finding: boolean;
  onFindClose: () => void;
}

const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const KEYS: Record<string, string> = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", " ": "Space", Enter: "Enter", Backspace: "Backspace", Delete: "Delete", Tab: "Tab", Escape: "Escape", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown" };
const EDIT: Record<string, string> = { c: "copy", x: "cut", v: "paste", a: "selectAll", z: "undo" };
export const mods = (e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }) =>
  [e.shiftKey && "shift", e.ctrlKey && "control", e.altKey && "alt", e.metaKey && "meta"].filter(Boolean) as string[];
export const BUTTON = ["left", "middle", "right"] as const;

/** A key press for a page, wherever it's shown: on its own canvas, or in the Surround room. */
export function pageKey(id: string, type: "keyDown" | "keyUp", e: React.KeyboardEvent) {
  e.stopPropagation(); // keys belong to the page, as they do in a flat window
  if (type === "keyDown" && e.metaKey && EDIT[e.key.toLowerCase()]) {
    e.preventDefault();
    void desktop?.invoke("curve:nav", id, e.key.toLowerCase() === "z" && e.shiftKey ? "redo" : EDIT[e.key.toLowerCase()]);
    return;
  }
  if (e.metaKey && type === "keyDown") return; // other ⌘ shortcuts stay with AetherDeck's menu
  e.preventDefault();
  const send = (event: Record<string, unknown>) => void desktop?.invoke("curve:input", id, event);
  const keyCode = KEYS[e.key] ?? (e.key.length === 1 ? e.key : e.key);
  send({ type, keyCode, modifiers: mods(e) });
  if (type === "keyDown" && e.key.length === 1 && !e.ctrlKey) send({ type: "char", keyCode: e.key, modifiers: mods(e) });
  if (type === "keyDown" && e.key === "Enter") send({ type: "char", keyCode: "\r", modifiers: mods(e) });
}

export function CurvedPage({ win, onState, onNavigate, onFocus, onFullscreen, onFail, bend, finding, onFindClose }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<{ code: number; text: string; url: string } | null>(null);
  const [gone, setGone] = useState(false);
  const cb = useRef({ onState, onNavigate, onFocus, onFullscreen, onFail, private: !!win.private });
  cb.current = { onState, onNavigate, onFocus, onFullscreen, onFail, private: !!win.private };
  const wcId = useRef(-1);
  const bendNow = useRef(bend);
  bendNow.current = bend;
  const live = useRef<{ url: string; title: string; back: boolean; fwd: boolean; loading: boolean }>({ url: liveSrc(win.page), title: win.page.title, back: false, fwd: false, loading: true });
  const id = win.id;

  useEffect(() => {
    const el = canvas.current;
    if (!el || !desktop) return;
    const call = (ch: string, ...a: unknown[]) => desktop!.invoke(ch, id, ...a);
    void desktop.invoke<number | false>("curve:open", id, liveSrc(win.page), el.clientWidth, el.clientHeight, devicePixelRatio, win.private ? "aetherdeck-private" : "persist:web").then((wc) => { if (wc === false) cb.current.onFail(); else wcId.current = wc; });
    const resize = new ResizeObserver(() => void call("curve:resize", el.clientWidth, el.clientHeight));
    resize.observe(el);
    const offState = desktop.on("curve:state", (p) => {
      const s = p as { id: string; url: string; title: string; back: boolean; fwd: boolean; loading: boolean; icon?: string; error?: { code: number; text: string; url: string }; gone?: boolean };
      if (s.id !== id) return;
      if (s.gone) { setGone(true); return; }
      setError((e) => s.error ?? (s.loading ? null : e));
      if (s.loading) setGone(false);
      const moved = s.url && s.url !== live.current.url;
      live.current = s;
      cb.current.onState({ loading: s.loading, back: s.back, fwd: s.fwd, url: s.url });
      if (moved) cb.current.onNavigate({ src: s.url, href: s.url, domain: domainOf(s.url), kind: "web" });
      if (s.title && s.title !== win.page.title) cb.current.onNavigate({ title: s.title });
      if (s.icon) cb.current.onNavigate({ icon: s.icon });
      if (moved && !cb.current.private) void desktop!.invoke("history:visit", s.url, s.title);
    });
    const offCursor = desktop.on("curve:cursor", (p) => { const c = p as { id: string; cursor: string }; if (c.id === id && canvas.current) canvas.current.style.cursor = c.cursor; });
    const offFull = desktop.on("curve:fullscreen", (p) => { const f = p as { id: string; on: boolean }; if (f.id === id) cb.current.onFullscreen(f.on); });
    pages.set(id, {
      back: () => void call("curve:nav", "back"),
      forward: () => void call("curve:nav", "forward"),
      reload: () => void call("curve:nav", "reload"),
      stop: () => void call("curve:nav", "stop"),
      load: (url) => void call("curve:nav", "load", url),
      find: (text, next, back) => void call("curve:find", text, !!next, !!back),
      stopFind: () => void call("curve:stopFind"),
      zoom: (step) => void call("curve:nav", "zoom", String(step)),
      print: () => void call("curve:nav", "print"),
      devtools: () => void call("curve:nav", "devtools"),
      url: () => live.current.url,
      title: () => live.current.title,
      wcId: () => wcId.current,
      capture: () => desktop!.invoke<string>("curve:capture", id),
      read: <T,>(script: string) => desktop!.invoke<T>("curve:exec", id, script),
      text: async () => String((await desktop!.invoke("curve:exec", id, "document.body ? document.body.innerText : ''")) ?? "").slice(0, 400_000),
    });
    // The wheel needs a non-passive listener to keep the space from zooming behind the page.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = at(e);
      if (p) void call("curve:input", { type: "mouseWheel", x: p.x, y: p.y, deltaX: -e.deltaX, deltaY: -e.deltaY, canScroll: true, hasPreciseScrollingDeltas: e.deltaMode === 0, modifiers: mods(e) });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      resize.disconnect();
      offState();
      offCursor();
      offFull();
      el.removeEventListener("wheel", wheel);
      pages.delete(id);
      void desktop!.invoke<string | null>("curve:close", id).then((url) => { if (url && /^https?:/.test(url)) cb.current.onNavigate({ src: url, href: url, domain: domainOf(url), kind: "web" }); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { void desktop?.invoke("curve:paint", id, !win.minimized); }, [id, win.minimized]);

  /** The page point (CSS pixels of the page) under a pointer, or null above or below the curved page. */
  function at(e: { clientX: number; clientY: number }) {
    const el = canvas.current!;
    const r = el.getBoundingClientRect();
    const p = toPage(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2, curveFor(bendNow.current));
    return p ? { x: Math.round(p.u * el.clientWidth), y: Math.round(p.v * el.clientHeight) } : null;
  }

  const send = (event: Record<string, unknown>) => void desktop?.invoke("curve:input", id, event);
  const pending = useRef<Record<string, unknown> | null>(null);
  const pointer = (type: "mouseDown" | "mouseUp" | "mouseMove", e: React.PointerEvent) => {
    const p = at(e);
    if (!p) return;
    const event = { type, x: p.x, y: p.y, button: BUTTON[e.button] ?? "left", clickCount: type === "mouseMove" ? 0 : Math.max(1, e.detail), modifiers: [...mods(e), ...(e.buttons & 1 ? ["leftButtonDown"] : [])] };
    if (type !== "mouseMove") return send(event);
    // moves are sent at most once a frame
    if (!pending.current) requestAnimationFrame(() => { if (pending.current) send(pending.current); pending.current = null; });
    pending.current = event;
  };
  const key = (type: "keyDown" | "keyUp", e: React.KeyboardEvent) => pageKey(id, type, e);

  return (
    <>
      <canvas ref={canvas} className="win__curved" data-curve={id} data-bend={bend} data-keys tabIndex={0} aria-label={`${win.page.title}, on a curved screen`}
        onPointerDown={(e) => { e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); cb.current.onFocus(); pointer("mouseDown", e); }}
        onPointerMove={(e) => pointer("mouseMove", e)}
        onPointerUp={(e) => pointer("mouseUp", e)}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => key("keyDown", e)} onKeyUp={(e) => key("keyUp", e)} />
      {finding && <FindBar onClose={onFindClose} />}
      {(error || gone) && (
        <div className="win__state win__state--blocked">
          <p className="win__big">{gone ? "This page stopped working." : "This page didn’t load."}</p>
          {error && !gone && <p className="fine">{domainOf(error.url)}: {error.text || `error ${error.code}`}</p>}
          <div className="win__actions"><button className="btn btn--primary" onClick={() => { setError(null); setGone(false); void desktop?.invoke("curve:reload", id); }}>Try again</button></div>
        </div>
      )}
    </>
  );
}
