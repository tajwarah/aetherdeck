// The spatial field: a pannable, zoomable world plus the cursor instrument.
// Movement is purely local (springs + CSS transforms); nothing here talks to the network.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type ReactNode } from "react";
import { SpringVec, useLatest, type Vec } from "../lib/spring.ts";
import { fitCamera, type Bounds } from "../lib/layout.ts";

export interface FieldHandle {
  fit: (b: Bounds, maxScale?: number) => void;
  focusWorld: (x: number, y: number, scale?: number, leaveRoomForSheet?: boolean) => void;
  diveAt: (screenX: number, screenY: number) => void;
  reset: () => void;
  center: () => { x: number; y: number };
  camera: () => Vec;
  restore: (v: Vec) => void;
}

interface Props {
  children: ReactNode;
  /** Fixed scenery behind the world (the planet); it never moves with the camera. */
  backdrop?: ReactNode;
  reduced: boolean;
  /** Click/tap on empty space (screen coords). */
  onBackground: (x: number, y: number) => void;
  onKeyAsk: () => void;
  onEscape: () => void;
  /** Level of detail changed (0 overview · 1 · 2 close). */
  onLod?: (lod: string) => void;
  cursorHint: string;
}

const MIN_S = 0.12;
const MAX_S = 4;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const Field = forwardRef<FieldHandle, Props>(function Field({ children, backdrop, reduced, onBackground, onKeyAsk, onEscape, onLod, cursorHint }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const lensLabelRef = useRef<HTMLSpanElement>(null);
  const pointer = useRef({ x: -100, y: -100, inside: false });
  const drag = useRef<{ id: number; x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const pinch = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPinch = useRef<number | null>(null);
  const defaultHint = useLatest(cursorHint);
  const lodRef = useLatest(onLod);

  const applyCamera = useCallback((v: Vec) => {
    const w = worldRef.current;
    if (!w) return;
    w.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.s})`;
    // Labels hold a readable on-screen size while positions spread or gather (map-style semantic zoom).
    // --ls: headings and labels; --lc: cards, which are allowed to shrink sooner so they never collide.
    w.style.setProperty("--ls", String(clamp(1 / v.s, 0.62, 1.9)));
    w.style.setProperty("--lc", String(clamp(1 / v.s, 0.7, 1.3)));
    w.style.setProperty("--s", String(v.s));
    const lod = v.s < 0.55 ? "0" : v.s < 1.2 ? "1" : "2";
    if (w.dataset.lod !== lod) { w.dataset.lod = lod; lodRef.current?.(lod); }
  }, [lodRef]);

  const cam = useRef<SpringVec | null>(null);
  const lens = useRef<SpringVec | null>(null);
  if (!cam.current) cam.current = new SpringVec({ x: 0, y: 0, s: 1 }, 7.5, applyCamera);
  if (!lens.current) {
    lens.current = new SpringVec({ x: -100, y: -100, s: 1 }, 38, (v) => {
      if (lensRef.current) lensRef.current.style.transform = `translate3d(${v.x}px, ${v.y}px, 0)`;
    });
  }

  useEffect(() => {
    cam.current!.reduced = reduced;
    lens.current!.reduced = reduced;
  }, [reduced]);

  // The orientation sphere is ~560px wide; small screens see it whole.
  const homeScale = () => Math.min(1, (rootRef.current?.clientWidth ?? 1024) / 600);

  // Center the world origin on first paint.
  useEffect(() => {
    const el = rootRef.current!;
    cam.current!.set({ x: el.clientWidth / 2, y: el.clientHeight / 2, s: homeScale() }, true);
    return () => { cam.current?.stop(); lens.current?.stop(); };
  }, []);

  /** Proximity: nearby nodes brighten as the instrument passes; computed only when the pointer moves. */
  const updateProximity = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const { x: px, y: py } = pointer.current;
    let best = Infinity;
    let hint = "";
    root.querySelectorAll<HTMLElement>("[data-node]").forEach((el) => {
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - px, 0, px - r.right);
      const dy = Math.max(r.top - py, 0, py - r.bottom);
      const d = Math.hypot(dx, dy);
      const prox = clamp(1 - d / 140, 0, 1);
      el.style.setProperty("--prox", prox.toFixed(3));
      if (d < best) {
        best = d;
        hint = d === 0 ? el.dataset.hint ?? "" : "";
      }
    });
    lensRef.current?.classList.toggle("lens--over", best === 0);
    if (lensLabelRef.current) lensLabelRef.current.textContent = drag.current?.moved ? "" : best === 0 ? hint : defaultHint.current;
  }, []);

  useImperativeHandle(ref, () => ({
    fit(b, maxScale = 1) {
      const el = rootRef.current!;
      cam.current!.set(fitCamera(b, el.clientWidth, el.clientHeight - 90, maxScale)); // leave room for the dock
    },
    focusWorld(x, y, scale, leaveRoomForSheet = true) {
      const el = rootRef.current!;
      const s = scale ?? Math.max(cam.current!.target.s, 1.15);
      // Bias left so a contextual sheet on the right doesn't cover the focused node.
      const sx = leaveRoomForSheet && el.clientWidth > 900 ? (el.clientWidth - 420) / 2 : el.clientWidth / 2;
      cam.current!.set({ s, x: sx - x * s, y: el.clientHeight / 2 - y * s });
    },
    diveAt(px, py) {
      const t = cam.current!.target;
      const s = clamp(t.s * 1.9, MIN_S, MAX_S);
      cam.current!.set({ s, x: px - (px - t.x) * (s / t.s), y: py - (py - t.y) * (s / t.s) });
    },
    reset() {
      const el = rootRef.current!;
      cam.current!.set({ x: el.clientWidth / 2, y: el.clientHeight / 2, s: homeScale() });
    },
    center() {
      const el = rootRef.current!;
      return { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    },
    camera: () => ({ ...cam.current!.target }),
    restore: (v) => cam.current!.set(v),
  }));

  const zoomAt = (px: number, py: number, factor: number) => {
    const t = cam.current!.target;
    const s = clamp(t.s * factor, MIN_S, MAX_S);
    cam.current!.set({ s, x: px - (px - t.x) * (s / t.s), y: py - (py - t.y) * (s / t.s) });
  };

  useEffect(() => {
    const el = rootRef.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-ui]")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.shiftKey) {
        const t = cam.current!.target;
        cam.current!.set({ x: t.x - e.deltaY, y: t.y }, true);
        return;
      }
      const k = e.ctrlKey ? 0.012 : 0.0016; // pinch gestures report small deltas
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * k));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Escape and "/" work wherever focus is (except while typing), not only when the field itself has focus.
  const escRef = useLatest(onEscape);
  const askRef = useLatest(onKeyAsk);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (rootRef.current?.contains(t)) return; // handled by the field's own onKeyDown
      const typing = !!t?.closest?.("input, textarea, select, [contenteditable], [data-keys]");
      if (e.key === "Escape" && !typing && !t?.closest?.("[role=dialog], .sheet")) escRef.current();
      if (e.key === "/" && !typing) { e.preventDefault(); askRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [escRef, askRef]);

  const isUi = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("[data-ui], input, textarea, select, a");

  const onPointerDown = (e: React.PointerEvent) => {
    if (isUi(e.target) || e.button > 0) return;
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const t = cam.current!.target;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: t.x, cy: t.y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY, inside: true };
    const overUi = isUi(e.target);
    rootRef.current!.classList.toggle("field--native", overUi || e.pointerType === "touch");
    lens.current!.set({ x: e.clientX, y: e.clientY });
    if (pinch.current.has(e.pointerId)) pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch.current.size === 2) {
      const [a, b] = [...pinch.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastPinch.current) {
        const r = rootRef.current!.getBoundingClientRect();
        zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / lastPinch.current);
      }
      lastPinch.current = d;
      if (drag.current) drag.current.moved = true;
      return;
    }
    const d = drag.current;
    if (d && d.id === e.pointerId) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 5) {
        d.moved = true;
        rootRef.current!.setPointerCapture(e.pointerId);
        rootRef.current!.classList.add("field--dragging");
      }
      if (d.moved) cam.current!.set({ x: d.cx + dx, y: d.cy + dy }, true);
    }
    updateProximity();
  };

  const endPointer = (e: React.PointerEvent) => {
    pinch.current.delete(e.pointerId);
    if (pinch.current.size < 2) lastPinch.current = null;
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    rootRef.current!.classList.remove("field--dragging");
    if (!d.moved && e.type === "pointerup") {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-node]") && !isUi(target)) {
        const r = rootRef.current!.getBoundingClientRect();
        onBackground(e.clientX - r.left, e.clientY - r.top);
      }
    }
    // keep `moved` visible to the click that follows, so a drag never also opens a node
    setTimeout(() => { if (drag.current === d) drag.current = null; }, 0);
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current?.moved) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isUi(e.target) && e.key !== "Escape") return;
    const t = cam.current!.target;
    const el = rootRef.current!;
    const step = 90;
    switch (e.key) {
      case "ArrowLeft": cam.current!.set({ x: t.x + step }); break;
      case "ArrowRight": cam.current!.set({ x: t.x - step }); break;
      case "ArrowUp": cam.current!.set({ y: t.y + step }); break;
      case "ArrowDown": cam.current!.set({ y: t.y - step }); break;
      case "+": case "=": zoomAt(el.clientWidth / 2, el.clientHeight / 2, 1.25); break;
      case "-": case "_": zoomAt(el.clientWidth / 2, el.clientHeight / 2, 0.8); break;
      case "/": onKeyAsk(); break;
      case "Escape": onEscape(); break;
      default: return;
    }
    e.preventDefault();
  };

  return (
    <div
      ref={rootRef}
      className="field"
      tabIndex={0}
      role="application"
      aria-roledescription="explorable information space"
      aria-label="Information space. Click empty space or press slash to ask. Arrow keys pan, plus and minus zoom, Tab moves between items, Escape goes back."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onPointerLeave={() => { pointer.current.inside = false; lensRef.current?.classList.add("lens--away"); }}
      onPointerEnter={() => lensRef.current?.classList.remove("lens--away")}
      onClickCapture={onClickCapture}
      onKeyDown={onKeyDown}
    >
      {backdrop}
      <div ref={worldRef} className="world" data-lod="1">
        {children}
      </div>
      <div ref={lensRef} className="lens lens--away" aria-hidden="true">
        <span className="lens__ring" />
        <span className="lens__dot" />
        <span ref={lensLabelRef} className="lens__label" />
      </div>
    </div>
  );
});
