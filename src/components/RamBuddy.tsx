// Ram the ram: the browser's memory as a small space sheep. Its wool grows with what the app is using, and it starts to
// sweat when the app gets close to the limit the agent engine works to. Click it for the breakdown.
import { useEffect, useState } from "react";
import { desktop } from "../lib/desktop.ts";
import { ramMood, type RamStats } from "../lib/ram.ts";

const WOOL = [[20, 32, 11], [32, 24, 12], [46, 24, 12], [56, 32, 11], [28, 40, 12], [42, 42, 13], [54, 41, 11]];

export function RamBuddy() {
  const [s, setS] = useState<RamStats | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    const read = () => { if (!document.hidden) void desktop!.invoke<RamStats>("engine:stats").then(setS).catch(() => undefined); };
    read();
    const t = setInterval(read, 4000);
    return () => clearInterval(t);
  }, []);
  if (!s?.system) return null;
  const m = ramMood(s.total, s.system);
  const gb = (s.total / 1024).toFixed(1);
  return (
    <div className="ram">
      <button className={`ram__btn is-${m.state}`} style={{ ["--puff" as string]: m.puff }} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Memory: ${gb} GB. ${m.line}`} title={m.line}>
        <svg viewBox="0 0 80 64" aria-hidden="true">
          <g className="ram__body">
            <path className="ram__legs" d="M28 50v9M38 50v9M46 50v9M54 50v9" fill="none" strokeWidth="3.500" strokeLinecap="round" />
            <g className="ram__wool">{WOOL.map(([x, y, r]) => <circle key={`${x}${y}`} cx={x} cy={y} r={r} />)}</g>
          </g>
          <g className="ram__head">
            <circle className="ram__bubble" cx="63" cy="30" r="14" />
            <path className="ram__horn" d="M58 21c-5-5-11 0-8 4 2 2 5 1 4-1" fill="none" strokeWidth="2.500" strokeLinecap="round" />
            <path className="ram__horn" d="M68 21c5-5 11 0 8 4-2 2-5 1-4-1" fill="none" strokeWidth="2.500" strokeLinecap="round" />
            <ellipse className="ram__face" cx="63" cy="32" rx="7" ry="8.500" />
            <circle cx="60" cy="30" r="1.300" /><circle cx="66" cy="30" r="1.300" />
            {m.state === "bursting" && <path className="ram__sweat" d="M50 14c2 3 3 4 3 5a3 3 0 0 1-6 0c0-1 1-2 3-5z" />}
          </g>
        </svg>
        <span>{gb} GB</span>
      </button>
      {open && (
        <div className="ram__card" role="status">
          <b>{m.line}</b>
          <dl>
            <div><dt>Pages</dt><dd>{s.tabs ?? 0} MB</dd></div>
            <div><dt>Graphics</dt><dd>{s.gpu ?? 0} MB</dd></div>
            <div><dt>Agents</dt><dd>{s.pageMemory} MB</dd></div>
            <div><dt>Browser core</dt><dd>{s.core ?? 0} MB</dd></div>
          </dl>
          <small>{gb} GB of this computer's {(s.system / 1024).toFixed(0)} GB</small>
        </div>
      )}
    </div>
  );
}
