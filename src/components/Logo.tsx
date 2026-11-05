// The AetherDeck mark: the brand's own artwork (a ribbon of light folded into an A, peach to lavender), cut from
// its dark ground with the glow kept, public/brand/logo.png. On the home it dissolves into specks of light where
// the pointer touches it, and they gather back.
import { useEffect, useRef } from "react";

const SRC = "/brand/logo.png";
const ASPECT = 284 / 364; // the artwork's height over its width

export function Logo({ size = 26 }: { size?: number }) {
  return <img className="logo" src={SRC} width={size} height={Math.round(size * ASPECT)} alt="" aria-hidden="true" draggable={false} />;
}

interface Speck { hx: number; hy: number; x: number; y: number; vx: number; vy: number; rgba: number }

/** The mark, drawn as specks of light: they scatter from the pointer and settle back where they belong. */
export function LogoDust({ width }: { width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const height = Math.round(width * ASPECT);

  useEffect(() => {
    const el = canvas.current!;
    const g = el.getContext("2d")!;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = (el.width = Math.round(width * dpr));
    const H = (el.height = Math.round(height * dpr));
    const STEP = Math.max(2, Math.round(dpr * 1.5)); // a speck every STEP device pixels, drawn STEP wide
    const REACH = 30 * dpr;
    let specks: Speck[] = [];
    let pointer: { x: number; y: number } | null = null;
    let raf = 0;
    let gone = false;
    const img = new Image();

    const whole = () => { g.clearRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H); };
    const build = () => {
      whole();
      const px = new Uint32Array(g.getImageData(0, 0, W, H).data.buffer);
      specks = [];
      for (let y = 0; y < H; y += STEP) for (let x = 0; x < W; x += STEP) {
        const rgba = px[y * W + x];
        if ((rgba >>> 24) > 10) specks.push({ hx: x, hy: y, x, y, vx: 0, vy: 0, rgba });
      }
    };
    const frame = () => {
      raf = 0;
      if (gone) return;
      let moving = false;
      for (const s of specks) {
        if (pointer) {
          const dx = s.x - pointer.x, dy = s.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < REACH * REACH) {
            const d = Math.sqrt(d2) || 1;
            const push = (1 - d / REACH) ** 2 * 5 * dpr;
            s.vx += (dx / d) * push + (Math.random() - 0.5) * dpr;
            s.vy += (dy / d) * push + (Math.random() - 0.5) * dpr;
          }
        }
        s.vx = (s.vx + (s.hx - s.x) * 0.045) * 0.86;
        s.vy = (s.vy + (s.hy - s.y) * 0.045) * 0.86;
        s.x += s.vx;
        s.y += s.vy;
        if (Math.abs(s.vx) + Math.abs(s.vy) > 0.05 || Math.abs(s.x - s.hx) + Math.abs(s.y - s.hy) > 0.5) moving = true;
      }
      if (!moving && !pointer) return whole(); // gathered: the crisp artwork again
      const out = g.createImageData(W, H);
      const buf = new Uint32Array(out.data.buffer);
      for (const s of specks) {
        const x0 = Math.round(s.x), y0 = Math.round(s.y);
        for (let y = y0; y < y0 + STEP; y++) {
          if (y < 0 || y >= H) continue;
          for (let x = x0; x < x0 + STEP; x++) if (x >= 0 && x < W) buf[y * W + x] = s.rgba;
        }
      }
      g.putImageData(out, 0, 0);
      if (moving) raf = requestAnimationFrame(frame);
    };
    const wake = () => { if (!raf && specks.length) raf = requestAnimationFrame(frame); };
    const at = (e: PointerEvent) => { const r = el.getBoundingClientRect(); return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr }; };
    const move = (e: PointerEvent) => { pointer = at(e); wake(); };
    const leave = () => { pointer = null; wake(); };

    img.onload = () => { if (!gone) build(); };
    img.src = SRC;
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => { gone = true; cancelAnimationFrame(raf); el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); };
  }, [width, height]);

  return <canvas ref={canvas} className="logo-dust" style={{ width, height }} role="img" aria-label="AetherDeck" />;
}
