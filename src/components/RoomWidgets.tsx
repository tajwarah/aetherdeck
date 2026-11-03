// Widgets in the 360° room: small panes of glass hung on the wall beside the tabs (a clock, a note, the computer's
// memory, the crew). They turn with the room: every time the room is drawn they are placed again, straight in the
// DOM, by the same geometry as the pages (shared/surround.ts). Drag one anywhere but its text to hang it elsewhere.
import { useEffect, useRef, useState } from "react";
import { onWall, toWall, type Panel, type View } from "../../shared/surround.ts";
import { desktop } from "../lib/desktop.ts";
import { ramMood, type RamStats } from "../lib/ram.ts";

export type WidgetId = "clock" | "note" | "memory" | "crew";
export const WIDGETS: { id: WidgetId; label: string }[] = [
  { id: "clock", label: "Clock" },
  { id: "note", label: "Note" },
  { id: "memory", label: "Memory" },
  { id: "crew", label: "Agents" },
];
export interface CrewMember { id: string; name: string; hue: number; status: "working" | "waiting" | "idle"; doing?: string }

interface Place { yaw: number; height: number }
interface Saved { shown: WidgetId[]; at: Partial<Record<WidgetId, Place>> }
const KEY = "warpnaut.roomWidgets";
const PX_PER_UNIT = 750; // a widget's CSS size is drawn for this many pixels to one unit of wall, straight ahead

export function savedWidgets(): Saved {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? "") as Saved; if (Array.isArray(s.shown)) return { shown: s.shown, at: s.at ?? {} }; } catch { /* first time */ }
  return { shown: ["clock", "note", "memory", "crew"], at: {} };
}
const keep = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* this visit only */ } };

/** Where each widget hangs until it's moved: a column either side of the tabs. */
function home(id: WidgetId, panels: Panel[]): Place {
  const first = panels[0];
  const last = panels[panels.length - 1];
  const left = first ? first.yaw - first.width / 2 - 0.24 : -0.62;
  const right = last ? last.yaw + last.width / 2 + 0.24 : 0.62;
  return { clock: { yaw: left, height: 0.16 }, note: { yaw: left, height: -0.15 }, memory: { yaw: right, height: 0.16 }, crew: { yaw: right, height: -0.15 } }[id];
}

interface Props {
  canvas: React.RefObject<HTMLCanvasElement | null>;
  panels: Panel[];
  saved: Saved;
  onSaved: (s: Saved) => void;
  crew: CrewMember[];
  onCrew: () => void;
}

export function RoomWidgets({ canvas, panels, saved, onSaved, crew, onCrew }: Props) {
  const els = useRef(new Map<WidgetId, HTMLElement>());
  const placeOf = (id: WidgetId) => saved.at[id] ?? home(id, panels);
  const places = useRef<(id: WidgetId) => Place>(placeOf);
  places.current = placeOf;

  // Hang every widget where the room says it is, each time the room is drawn.
  useEffect(() => {
    const place = () => {
      const c = canvas.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const v: View = { yaw: Number(c.dataset.yaw) || 0, fov: Number(c.dataset.fov) || 1, aspect: r.width / r.height };
      const unit = (r.height / 2) / PX_PER_UNIT * (1 / Math.tan(1.08 / 2));
      for (const [id, el] of els.current) {
        const p = places.current(id);
        const at = onWall(v, p.yaw, p.height);
        if (!at) { el.style.visibility = "hidden"; continue; }
        el.style.visibility = "";
        const x = r.left + ((at.x + 1) / 2) * r.width;
        const y = r.top + ((1 - at.y) / 2) * r.height;
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${at.across * unit}, ${at.up * unit})`;
      }
    };
    place();
    document.addEventListener("warpnaut-scene", place);
    window.addEventListener("resize", place);
    return () => { document.removeEventListener("warpnaut-scene", place); window.removeEventListener("resize", place); };
  }, [canvas, saved, panels]);

  // Moving one: the point of the wall under the pointer carries the widget with it.
  const drag = useRef<{ id: WidgetId; dyaw: number; dh: number } | null>(null);
  const wallAt = (e: React.PointerEvent) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const v: View = { yaw: Number(c.dataset.yaw) || 0, fov: Number(c.dataset.fov) || 1, aspect: r.width / r.height };
    return toWall(v, ((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
  };
  const grab = (id: WidgetId, e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, textarea, input, a")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const w = wallAt(e);
    const p = placeOf(id);
    drag.current = { id, dyaw: p.yaw - w.yaw, dh: p.height - w.height };
  };
  const pull = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const w = wallAt(e);
    onSaved({ ...saved, at: { ...saved.at, [d.id]: { yaw: w.yaw + d.dyaw, height: Math.max(-0.45, Math.min(0.45, w.height + d.dh)) } } });
  };
  const drop = () => { if (drag.current) keep(saved); drag.current = null; };
  const hide = (id: WidgetId) => { const s = { ...saved, shown: saved.shown.filter((x) => x !== id) }; onSaved(s); keep(s); };

  const frame = (id: WidgetId, title: string, body: React.ReactNode) => (
    <section key={id} className={`rw rw--${id}`} ref={(el) => { if (el) els.current.set(id, el); else els.current.delete(id); }} aria-label={title}
      onPointerDown={(e) => grab(id, e)} onPointerMove={pull} onPointerUp={drop} onPointerCancel={drop} title="Drag to hang it somewhere else">
      <header className="rw__head">
        <span>{title}</span>
        <button className="rw__x" aria-label={`Hide the ${title.toLowerCase()} widget`} title="Hide" onClick={() => hide(id)}>×</button>
      </header>
      {body}
    </section>
  );

  return (
    <div className="rw-layer">
      {saved.shown.includes("clock") && frame("clock", "Clock", <Clock />)}
      {saved.shown.includes("note") && frame("note", "Note", <Note />)}
      {saved.shown.includes("memory") && frame("memory", "Memory", <Memory />)}
      {saved.shown.includes("crew") && frame("crew", "Agents", <Crew crew={crew} onOpen={onCrew} />)}
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 5000); return () => clearInterval(t); }, []);
  return (
    <div className="rw__clock">
      <b>{now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</b>
      <span>{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span>
    </div>
  );
}

const NOTE = "warpnaut.roomNote";
function Note() {
  const [text, setText] = useState(() => { try { return localStorage.getItem(NOTE) ?? ""; } catch { return ""; } });
  return (
    <textarea className="rw__note" value={text} placeholder="A note to yourself. It stays on this computer." aria-label="Note" data-keys
      onChange={(e) => { setText(e.target.value); try { localStorage.setItem(NOTE, e.target.value); } catch { /* this visit only */ } }}
      onKeyDown={(e) => e.stopPropagation()} />
  );
}

function Memory() {
  const [s, setS] = useState<RamStats | null>(null);
  useEffect(() => {
    const read = () => void desktop?.invoke<RamStats>("engine:stats").then(setS).catch(() => undefined);
    read();
    const t = setInterval(read, 4000);
    return () => clearInterval(t);
  }, []);
  if (!s) return <p className="rw__quiet">Measuring…</p>;
  const limit = (s.system ?? 16384) * 0.5;
  const mood = ramMood(s.total, s.system ?? 16384);
  return (
    <div className="rw__memory">
      <b>{(s.total / 1024).toFixed(1)} GB</b>
      <span className="rw__bar"><i style={{ width: `${Math.min(100, (s.total / limit) * 100)}%` }} className={`is-${mood.state}`} /></span>
      <span>{mood.line}</span>
    </div>
  );
}

function Crew({ crew, onOpen }: { crew: CrewMember[]; onOpen: () => void }) {
  if (!crew.length) return <button className="rw__quiet rw__link" onClick={onOpen}>No agents yet. Summon one</button>;
  const order = { waiting: 0, working: 1, idle: 2 };
  return (
    <ul className="rw__crew">
      {[...crew].sort((a, b) => order[a.status] - order[b.status]).slice(0, 4).map((a) => (
        <li key={a.id}>
          <button onClick={onOpen} style={{ ["--hue" as string]: a.hue }}>
            <i className={`rw__dot is-${a.status}`} />
            <b>{a.name}</b>
            <span>{a.status === "waiting" ? "Needs you" : a.status === "working" ? (a.doing ?? "Working") : "Ready"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
