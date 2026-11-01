// The agents' console: say one thing (or type it) and a crew works the browser for you, in view. Scout searches
// and maps, Navigator opens and arranges windows, Reader reads pages and answers, Scribe writes. Every step is
// shown as it runs; they open, arrange, read and write, and leave signing in, buying and sending to you.
import { useEffect, useRef, useState } from "react";
import { planAgents, transcribeAudio, type AgentName, type AgentStep } from "../lib/api.ts";
import { record, type Recording } from "../lib/voice.ts";
import { Markdown } from "./Assistant.tsx";

export const CREW: Record<AgentName, { label: string; does: string; hue: number }> = {
  scout: { label: "Scout", does: "searches and maps", hue: 38 },
  navigator: { label: "Navigator", does: "opens and arranges", hue: 200 },
  reader: { label: "Reader", does: "reads and answers", hue: 150 },
  scribe: { label: "Scribe", does: "writes", hue: 290 },
};

type Phase = "idle" | "listening" | "hearing" | "planning" | "working" | "done" | "error";
interface Run { step: AgentStep; status: "waiting" | "running" | "done" | "failed"; output?: string }

interface Props {
  /** Start listening as soon as it opens (the voice shortcut). */
  listen: boolean;
  voice: string | null;
  model: string | null;
  context: () => { windows: { title: string; url: string; front: boolean }[]; map?: string };
  act: (step: AgentStep) => Promise<string | void>;
  onConnect: () => void;
  onClose: () => void;
}

const describe = (s: AgentStep) => {
  switch (s.do) {
    case "search": return `Mapping “${s.query}”`;
    case "open": return `Opening ${s.url?.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}`;
    case "openMany": return `Opening ${s.urls?.length ?? 0} pages side by side`;
    case "arrange": return "Arranging the windows side by side";
    case "focus": return `Bringing “${s.match}” to the front`;
    case "close": return `Closing “${s.match}”`;
    case "minimizeAll": return "Clearing the windows to the dock";
    case "fullscreen": return `Full screen: “${s.match}”`;
    case "read": return `Reading ${s.match ? `“${s.match}”` : "the front page"}: ${s.question ?? ""}`;
    case "write": return `Writing: ${s.text?.slice(0, 80)}`;
    default: return s.text ?? "";
  }
};

export function AgentConsole({ listen, voice, model, context, act, onConnect, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [draft, setDraft] = useState("");
  const [say, setSay] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const rec = useRef<Recording | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => { rec.current?.cancel(); abort.current?.abort(); }, []);
  useEffect(() => { if (listen) void start(); else input.current?.focus(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  useEffect(() => {
    if (phase !== "listening") return;
    const t = setInterval(() => setLevel(rec.current?.level() ?? 0), 70);
    return () => clearInterval(t);
  }, [phase]);

  async function start() {
    if (!voice) { setError("Voice needs an OpenAI, Groq or Gemini key (Settings). You can type instead, or dictate with Wispr Flow."); return; }
    setError("");
    try {
      rec.current = await record(() => void finish());
      setPhase("listening");
    } catch {
      setError("The microphone isn't available. Allow it for Warpnaut in your system settings, or type instead.");
    }
  }

  async function finish() {
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    setPhase("hearing");
    try {
      const audio = await r.stop();
      if (!audio) { setPhase("idle"); setError("Nothing was heard. Try again, a little closer."); return; }
      const { text } = await transcribeAudio(audio);
      if (!text) { setPhase("idle"); setError("Nothing was heard. Try again, a little closer."); return; }
      setHeard(text);
      await go(text);
    } catch (err) {
      setPhase("error");
      setError((err as Error).message);
    }
  }

  async function go(request: string) {
    if (!model) { onConnect(); return; }
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError("");
    setSay("");
    setRuns([]);
    setPhase("planning");
    try {
      const plan = await planAgents(request, context(), ctrl.signal);
      setSay(plan.say);
      const list: Run[] = plan.steps.map((step) => ({ step, status: "waiting" }));
      setRuns(list);
      setPhase("working");
      for (let i = 0; i < list.length; i++) {
        if (ctrl.signal.aborted) return;
        setRuns((rs) => rs.map((r, j) => (j === i ? { ...r, status: "running" } : r)));
        try {
          const output = await act(list[i].step);
          setRuns((rs) => rs.map((r, j) => (j === i ? { ...r, status: "done", output: output || undefined } : r)));
        } catch (err) {
          setRuns((rs) => rs.map((r, j) => (j === i ? { ...r, status: "failed", output: (err as Error).message } : r)));
        }
      }
      setPhase("done");
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setPhase("error");
      setError((err as Error).message);
    }
  }

  const active = new Set(runs.filter((r) => r.status === "running").map((r) => r.step.agent));
  const status = { idle: "Say one thing, and the crew does the rest", listening: "Listening…", hearing: `Hearing you${voice ? ` (${voice})` : ""}…`, planning: `Planning${model ? ` with ${model}` : ""}…`, working: say || "Working…", done: say || "Done", error: "Something went wrong" }[phase];

  return (
    <div className="agents" role="dialog" aria-label="Agents" data-ui>
      <div className="agents__head">
        <button className={`agents__orb ${phase === "listening" ? "is-on" : ""}`} style={{ ["--lvl" as string]: level }} onClick={() => (phase === "listening" ? void finish() : void start())}
          aria-label={phase === "listening" ? "Stop and send" : "Speak"} title={phase === "listening" ? "Stop and send" : "Speak (⌘⇧Space from anywhere)"}>
          <span className="agents__orb-core" />
        </button>
        <div className="agents__status">
          <p className="agents__title">{status}</p>
          {heard && <p className="agents__heard">“{heard}”</p>}
        </div>
        <button className="icon-btn agents__close" onClick={onClose} aria-label="Close the agents">×</button>
      </div>
      <form className="agents__ask" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { setHeard(draft.trim()); void go(draft.trim()); setDraft(""); } }}>
        <input ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Or type: “compare the three best laptops and open their reviews side by side”" aria-label="Tell the agents" />
      </form>
      <div className="agents__crew" aria-label="The crew">
        {(Object.keys(CREW) as AgentName[]).map((a) => (
          <span key={a} className={`agents__agent ${active.has(a) ? "is-on" : ""}`} style={{ ["--hue" as string]: CREW[a].hue }}>
            <span className="mm__dot" aria-hidden="true" />{CREW[a].label}<small>{CREW[a].does}</small>
          </span>
        ))}
      </div>
      {!model && <p className="agents__note">Agents need an AI model. <button className="link" onClick={onConnect}>Connect one</button></p>}
      {error && <p className="agents__error" role="alert">{error}</p>}
      {runs.length > 0 && (
        <ol className="agents__steps" aria-live="polite">
          {runs.map((r, i) => (
            <li key={i} className={`agents__step is-${r.status}`} style={{ ["--hue" as string]: CREW[r.step.agent]?.hue ?? 38 }}>
              <span className="agents__who">{CREW[r.step.agent]?.label ?? r.step.agent}</span>
              <span className="agents__what">{describe(r.step)}</span>
              {r.output && <div className="agents__out"><Markdown text={r.output} /></div>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
