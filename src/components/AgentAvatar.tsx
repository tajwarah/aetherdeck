// An agent as a small astronaut. The face, arms and the thing in its hands follow what it's doing (moodOf in
// lib/agents.ts); each order wears its own kit, and the hue is the person's choice. Plain SVG moved by CSS.
import type { Mood } from "../lib/agents.ts";

const MOUTH: Partial<Record<Mood, string>> = {
  hello: "M50 53q10 10 20 0", salute: "M52 54h16", think: "M55 55q5-3 10 0", search: "M54 54q6 3 12 0", read: "M56 54h8", harvest: "M52 53q8 7 16 0",
  mail: "M54 54q6 3 12 0", watch: "M57 52a3 3 0 1 0 6 0a3 3 0 1 0-6 0", build: "M53 55h14", act: "M54 54q6 3 12 0", wait: "M56 52a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
  done: "M48 51q12 15 24 0z", failed: "M52 57q8-7 16 0", stopped: "M54 54h12",
};
const BROW: Partial<Record<Mood, [string, string]>> = {
  think: ["M44 36l10 3", "M66 34l10-1"], build: ["M44 37l10 3", "M76 37l-10 3"], failed: ["M46 40l9-4", "M74 40l-9-4"], wait: ["M44 34q6-3 11 0", "M65 34q6-3 11 0"], done: ["M44 33q6-4 11 0", "M65 33q6-4 11 0"],
};

/** What each order wears on its helmet and back. */
function Kit({ order }: { order?: string }) {
  if (order === "scarab") return <g className="av__kit"><rect x="16" y="82" width="14" height="30" rx="7" /><rect x="90" y="82" width="14" height="30" rx="7" /></g>;
  if (order === "ibis") return <g className="av__kit"><path d="M26 46a34 34 0 0 1 68 0" fill="none" strokeWidth="5" /><rect x="20" y="42" width="11" height="20" rx="5" /><rect x="89" y="42" width="11" height="20" rx="5" /></g>;
  if (order === "serpent") return <g className="av__kit"><circle cx="86" cy="22" r="9" /><path d="M86 22l-14 10" fill="none" strokeWidth="4" /></g>;
  if (order === "artisan") return <g className="av__kit"><rect x="36" y="8" width="48" height="12" rx="6" /><circle cx="60" cy="14" r="4" className="av__led" /></g>;
  if (order === "jackal") return <g className="av__kit"><path d="M34 26 24 6l22 9zM86 26 96 6 74 15z" /></g>;
  return <g className="av__kit"><path d="M60 12V0" fill="none" strokeWidth="4" /><circle cx="60" cy="1" r="4" className="av__led" /></g>;
}

/** The thing in its hands, for the work it's doing. */
function Prop({ mood }: { mood: Mood }) {
  switch (mood) {
    case "search": return <g className="av__prop av__prop--scope"><circle cx="100" cy="74" r="13" fill="none" strokeWidth="5" /><path d="M91 84 80 96" strokeWidth="6" fill="none" /></g>;
    case "read": return <g className="av__prop"><rect x="38" y="84" width="44" height="30" rx="4" className="av__screen" /><path d="M44 92h32M44 99h26M44 106h30" fill="none" strokeWidth="2" className="av__lines" /></g>;
    case "harvest": return <g className="av__prop"><path d="M36 96h48l-6 26H42z" className="av__screen" /><rect className="av__cube av__cube--1" x="44" y="72" width="9" height="9" /><rect className="av__cube av__cube--2" x="58" y="64" width="9" height="9" /><rect className="av__cube av__cube--3" x="70" y="76" width="9" height="9" /></g>;
    case "mail": return <g className="av__prop av__prop--mail"><rect x="38" y="88" width="44" height="30" rx="3" className="av__screen" /><path d="M38 90l22 16 22-16" fill="none" strokeWidth="2.5" /></g>;
    case "watch": return <g className="av__prop"><rect x="30" y="82" width="60" height="36" rx="5" className="av__screen" /><path d="M54 91v18l15-9z" className="av__play" /></g>;
    case "build": return <g className="av__prop"><g className="av__hammer"><path d="M102 56 84 90" strokeWidth="5" fill="none" /><rect x="92" y="46" width="24" height="12" rx="3" transform="rotate(28 104 52)" /></g><rect x="30" y="112" width="20" height="10" /><rect x="52" y="112" width="20" height="10" /><rect x="41" y="100" width="20" height="10" className="av__led" /></g>;
    case "act": return <g className="av__prop"><circle className="av__ping" cx="104" cy="70" r="7" fill="none" strokeWidth="3" /></g>;
    case "wait": return <g className="av__prop av__prop--wait"><path d="M101 12v22M101 42v.5" fill="none" strokeWidth="7" strokeLinecap="round" /></g>;
    case "think": return <g className="av__prop av__prop--dots"><circle cx="92" cy="20" r="3.5" /><circle cx="102" cy="12" r="4.5" /><circle cx="113" cy="4" r="5.5" /></g>;
    case "done": return <g className="av__prop av__prop--stars"><path d="M16 26l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" /><path d="M104 14l2.5 6 6 1-4 4 1 6-5.500-3-5.500 3 1-6-4-4 6-1z" /></g>;
    case "failed": return <g className="av__prop"><path className="av__sweat" d="M92 34c4 5 5 7 5 9a5 5 0 0 1-10 0c0-2 1-4 5-9z" /></g>;
    default: return null;
  }
}

export function AgentAvatar({ hue, order, mood, size = 120, label }: { hue: number; order?: string; mood: Mood; size?: number; label?: string }) {
  const brow = BROW[mood];
  const asleep = mood === "stopped";
  return (
    <svg className={`av av--${mood}`} style={{ ["--hue" as string]: hue, width: size }} viewBox="-6 -8 132 148" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <ellipse className="av__shadow" cx="60" cy="134" rx="30" ry="5" />
      <g className="av__all">
        <rect className="av__pack" x="26" y="76" width="68" height="44" rx="12" />
        <g className="av__leg av__leg--l"><rect x="42" y="112" width="15" height="22" rx="7" /></g>
        <g className="av__leg av__leg--r"><rect x="63" y="112" width="15" height="22" rx="7" /></g>
        <rect className="av__torso" x="34" y="70" width="52" height="50" rx="16" />
        <rect className="av__chest" x="49" y="84" width="22" height="14" rx="4" />
        <circle className="av__led" cx="55" cy="91" r="2.5" /><circle className="av__led av__led--2" cx="65" cy="91" r="2.5" />
        <g className="av__arm av__arm--l"><path d="M38 80Q20 88 24 106" fill="none" strokeWidth="11" strokeLinecap="round" /><circle cx="24" cy="108" r="7" /></g>
        <g className="av__arm av__arm--r"><path d="M82 80Q100 88 96 106" fill="none" strokeWidth="11" strokeLinecap="round" /><circle cx="96" cy="108" r="7" /></g>
        <g className="av__head">
          <Kit order={order} />
          <circle className="av__helmet" cx="60" cy="44" r="36" />
          <rect className="av__visor" x="32" y="24" width="56" height="42" rx="20" />
          <g className="av__face">
            {asleep
              ? <path d="M43 44q6 4 11 0M66 44q6 4 11 0" fill="none" strokeWidth="3" strokeLinecap="round" />
              : <><g className="av__eye"><circle cx="49" cy="43" r="5" /><circle className="av__glint" cx="51" cy="41" r="1.600" /></g><g className="av__eye"><circle cx="71" cy="43" r="5" /><circle className="av__glint" cx="73" cy="41" r="1.600" /></g></>}
            {brow && <path d={brow.join("")} fill="none" strokeWidth="3" strokeLinecap="round" />}
            <path className="av__mouth" d={MOUTH[mood] ?? "M53 53q7 5 14 0"} strokeWidth="3" strokeLinecap="round" />
          </g>
          <path className="av__shine" d="M38 34q5-9 16-11" fill="none" strokeWidth="4" strokeLinecap="round" />
        </g>
        <Prop mood={mood} />
      </g>
    </svg>
  );
}
