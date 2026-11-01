// The bridge: the crew stand on deck and act out their work. Avatars are SVG and react to each step; behind them one 2D
// canvas plays that step's effect (a radar for searching, a scan for reading, data spiralling in for harvesting, and so
// on), at thirty frames a second at most, and it stops altogether when nobody is working.
import { useEffect, useRef } from "react";
import { doingText, FX, MOOD_LINE, moodOf, rankOf, seat, type Agent, type Fx, type Run } from "../lib/agents.ts";
import { AgentAvatar } from "./AgentAvatar.tsx";

type Draw = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const tint = (hue: number, a: number, l = 66) => `hsl(${hue} 85% ${l}% / ${a})`;

const EFFECTS: Record<Fx, (c: Draw, x: number, y: number, r: number, t: number, hue: number) => void> = {
  think(c, x, y, r, t, hue) {
    for (let i = 0; i < 3; i++) {
      const a = t * 2.4 + (i * TAU) / 3;
      c.fillStyle = tint(hue, 0.9);
      c.beginPath(); c.arc(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85, 2.2, 0, TAU); c.fill();
    }
  },
  radar(c, x, y, r, t, hue) {
    c.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.55 + i / 3) % 1;
      c.strokeStyle = tint(hue, 0.8 * (1 - p));
      c.beginPath(); c.arc(x, y, r * (0.4 + p * 1.9), 0, TAU); c.stroke();
    }
  },
  scan(c, x, y, r, t, hue) {
    const a = t * 2.2;
    const g = c.createConicGradient(a, x, y);
    g.addColorStop(0, tint(hue, 0.65)); g.addColorStop(0.2, tint(hue, 0)); g.addColorStop(1, tint(hue, 0));
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r * 1.8, 0, TAU); c.fill();
    c.strokeStyle = tint(hue, 0.9); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * r * 1.8, y + Math.sin(a) * r * 1.8); c.stroke();
  },
  harvest(c, x, y, r, t, hue) {
    for (let i = 0; i < 18; i++) {
      const p = (t * 0.6 + i / 18) % 1;
      const a = i * 2.4 + p * 2.2;
      const d = r * 2.3 * (1 - p);
      c.fillStyle = tint(hue, Math.min(1, p * 1.6));
      c.fillRect(x + Math.cos(a) * d - 1.5, y + Math.sin(a) * d - 1.5, 3, 3);
    }
  },
  mail(c, x, y, r, t, hue) {
    c.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) {
      const p = (t * 0.45 + i / 5) % 1;
      const a = -2.4 + i * 1.3;
      const d = r * 2.4 * (1 - p);
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d;
      c.strokeStyle = tint(hue, Math.sin(p * Math.PI));
      c.strokeRect(px - 6, py - 4, 12, 8);
      c.beginPath(); c.moveTo(px - 6, py - 4); c.lineTo(px, py + 1); c.lineTo(px + 6, py - 4); c.stroke();
    }
  },
  video(c, x, y, r, t, hue) {
    c.lineWidth = 2.2; c.lineCap = "round";
    c.strokeStyle = tint(hue, 0.9);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      const h = r * (0.25 + 0.75 * Math.abs(Math.sin(t * 3 + i * 0.9) * Math.sin(t * 1.3 + i * 0.37)));
      c.beginPath();
      c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      c.lineTo(x + Math.cos(a) * (r + h), y + Math.sin(a) * (r + h));
      c.stroke();
    }
  },
  build(c, x, y, r, t, hue) {
    const s = r * 0.72;
    const lit = Math.floor(t * 5) % 11;
    c.lineWidth = 1;
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      const n = row * 3 + col;
      const bx = x + (col - 1.5) * s;
      const by = y + (1.5 - row - 1) * s;
      c.strokeStyle = tint(hue, 0.4);
      c.strokeRect(bx, by, s - 2, s - 2);
      if (n < lit) { c.fillStyle = tint(hue, 0.3 + 0.5 * ((n + 1) / 9)); c.fillRect(bx + 1, by + 1, s - 4, s - 4); }
    }
  },
  act(c, x, y, r, t, hue) {
    const p = (t * 1.1) % 1;
    c.strokeStyle = tint(hue, 1 - p); c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, r * (0.4 + p * 1.5), 0, TAU); c.stroke();
    for (let i = 0; i < 4; i++) {
      const a = i * (TAU / 4) + Math.PI / 4;
      c.beginPath();
      c.moveTo(x + Math.cos(a) * r * (0.9 + p), y + Math.sin(a) * r * (0.9 + p));
      c.lineTo(x + Math.cos(a) * r * (1.3 + p), y + Math.sin(a) * r * (1.3 + p));
      c.stroke();
    }
  },
};

interface Props { agents: Agent[]; runs: Record<string, Run>; picked: string | null; reduced: boolean; onPick: (id: string) => void }

export function AgentStage({ agents, runs, picked, reduced, onPick }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const live = useRef({ agents, runs });
  live.current = { agents, runs };
  const kick = useRef<() => void>(() => undefined);

  useEffect(() => {
    const el = canvas.current!;
    const c = el.getContext("2d")!;
    const size = { w: 0, h: 0 };
    const bursts = new Map<string, number>();
    const was = new Map<string, string>();
    let raf = 0;
    let last = 0;
    const resize = new ResizeObserver(() => {
      const dpr = Math.min(devicePixelRatio, 1.5);
      size.w = el.clientWidth; size.h = el.clientHeight;
      el.width = size.w * dpr; el.height = size.h * dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(performance.now(), true);
    });

    function draw(now: number, once = false) {
      raf = 0;
      const { agents, runs } = live.current;
      const working = agents.filter((a) => runs[a.id]?.status === "working").length;
      for (const a of agents) {
        const s = runs[a.id]?.status ?? "idle";
        if (was.get(a.id) === "working" && s === "done") bursts.set(a.id, now);
        was.set(a.id, s);
      }
      for (const [id, at] of bursts) if (now - at > 1600) bursts.delete(id);
      const moving = !reduced && (working > 0 || bursts.size > 0);
      if (moving && !once) raf = requestAnimationFrame(draw);
      if (moving && !once && now - last < 32) return; // about thirty frames a second
      last = now;
      const t = reduced ? 1 : now / 1000;
      const { w, h } = size;
      if (!w) return;
      c.clearRect(0, 0, w, h);
      agents.forEach((a, i) => {
        const place = seat(i, agents.length);
        const x = place.x * w;
        const y = place.y * h;
        const r = 58 * place.scale;
        const run = runs[a.id];
        if (run?.status === "working") {
          const step = run.steps[run.steps.length - 1];
          const fx = run.ask ? "act" : step?.status === "running" ? FX[step.tool] ?? "think" : "think";
          EFFECTS[fx](c, x, y, r, t, run.ask ? 212 : a.hue);
        }
        const burst = bursts.get(a.id);
        if (burst) {
          const p = (now - burst) / 1600;
          c.strokeStyle = tint(a.hue, 1 - p); c.lineWidth = 2;
          for (let k = 0; k < 16; k++) {
            const b = (k / 16) * TAU;
            c.beginPath();
            c.moveTo(x + Math.cos(b) * (r + p * 34), y + Math.sin(b) * (r + p * 34));
            c.lineTo(x + Math.cos(b) * (r + 10 + p * 62), y + Math.sin(b) * (r + 10 + p * 62));
            c.stroke();
          }
        }
      });
    }
    kick.current = () => { if (!raf) raf = requestAnimationFrame(draw); };
    resize.observe(el);
    return () => { resize.disconnect(); cancelAnimationFrame(raf); kick.current = () => undefined; };
  }, [reduced]);

  useEffect(() => kick.current(), [agents, runs]);

  // Everyone's eyes follow the pointer a little.
  useEffect(() => {
    const el = stage.current!;
    if (reduced) return;
    let frame = 0;
    const look = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--lx", `${((e.clientX - r.left) / r.width - 0.5) * 5}px`);
        el.style.setProperty("--ly", `${((e.clientY - r.top) / r.height - 0.5) * 4}px`);
      });
    };
    el.addEventListener("pointermove", look);
    return () => { el.removeEventListener("pointermove", look); cancelAnimationFrame(frame); };
  }, [reduced]);

  return (
    <div className="bridge" ref={stage}>
      <div className="bridge__view" aria-hidden="true"><i className="bridge__planet" /></div>
      <div className="bridge__floor" aria-hidden="true" />
      <canvas ref={canvas} className="deck__canvas" aria-hidden="true" />
      {!agents.length && <div className="crewman is-ghost" style={{ left: "50%", top: "72%" }}><AgentAvatar hue={212} mood="idle" /><p>Your crew stands here</p></div>}
      {agents.map((a, i) => {
        const place = seat(i, agents.length);
        const run = runs[a.id];
        const mood = moodOf(a, run);
        const step = run?.steps[run.steps.length - 1];
        const line = run?.ask ? MOOD_LINE.wait : step?.status === "running" ? doingText(step) : mood === "hello" && picked !== a.id ? undefined : MOOD_LINE[mood];
        return (
          <button key={a.id} className={`crewman ${picked === a.id ? "is-picked" : ""}`} style={{ left: `${place.x * 100}%`, top: `${place.y * 100}%`, zIndex: place.back ? 1 : 2, ["--hue" as string]: a.hue, ["--s" as string]: place.scale, animationDelay: `${i * 0.31}s` }}
            onClick={() => onPick(a.id)} aria-label={`${a.name}, ${rankOf(a.xp)}${line ? `: ${line}` : ""}`} aria-pressed={picked === a.id}>
            {line && <span className="crewman__say" key={line}>{line}</span>}
            <AgentAvatar hue={a.hue} order={a.order} mood={mood} />
            <span className="crewman__tag"><b>{a.name}</b><small>{rankOf(a.xp)}</small></span>
          </button>
        );
      })}
    </div>
  );
}
