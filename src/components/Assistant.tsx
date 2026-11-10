// Cosmonaut, the AI companion, in a window: a file the person dropped, or the page they were reading, and questions about it
// answered by the AI model they connected. The file is read on this computer; its text goes to the model only
// with a question, and the window says so. Without a model the window still shows what the file contains.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { askAssistant, type AssistMaterial, type AssistTurn } from "../lib/api.ts";
import { base64Of, formatSize, type FileMaterial } from "../lib/files.ts";
import { desktop } from "../lib/desktop.ts";
import { Cosmo } from "./Cosmo.tsx";
import type { Tab } from "../lib/windows.ts";

export interface PageMaterial { kind: "page"; name: string; url: string; text: string }
export type Material = FileMaterial | PageMaterial;

/** What each assistant window holds, by the window's page id. Kept in memory only: never saved or synced. */
export const materials = new Map<string, Material | { kind: "loading"; name: string } | { kind: "error"; name: string; message: string }>();

const PROMPTS: Record<string, string[]> = {
  file: ["Summarize this document and highlight the key points.", "What are the key numbers and dates?", "Suggest next steps."],
  page: ["Summarize this page.", "What are the main claims, and what supports them?", "What should I read next?"],
  none: ["Explain something to me.", "Help me plan a trip.", "Draft a short email."],
};

interface Props {
  tab: Tab;
  /** The connected model's name, or null when none is connected. */
  model: string | null;
  vision: boolean;
  onConnect: () => void;
  onAttach: (file: File) => void;
}

export function Assistant({ tab, model, vision, onConnect, onAttach }: Props) {
  const [, rerender] = useState(0);
  const [thread, setThread] = useState<AssistTurn[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(false);
  const [showText, setShowText] = useState(false);
  const [times, setTimes] = useState<number[]>([]); // when each turn happened, by index
  const pick = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const m = materials.get(tab.src);

  // The file is read in the background; poll until it lands (it is a module map, not React state).
  useEffect(() => {
    if (m?.kind !== "loading") return;
    const t = setInterval(() => rerender((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [m?.kind]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [thread, working]);

  const ready = m && m.kind !== "loading" && m.kind !== "error" ? m : undefined;
  const isPage = ready?.kind === "page";

  async function ask(question: string) {
    if (!question.trim() || working) return;
    if (!model) { onConnect(); return; }
    setError("");
    setDraft("");
    const history = thread;
    setThread((t) => [...t, { role: "user", text: question }]);
    setTimes((t) => [...t.slice(0, history.length), Date.now()]);
    abort.current = new AbortController();
    try {
      let material: AssistMaterial | undefined;
      if (ready) {
        setWorking(isPage ? "Reading the page" : "Reading the document");
        material = ready.kind === "page"
          ? { kind: "page", name: ready.name, url: ready.url, text: ready.text }
          : { kind: ready.kind, name: ready.name, mime: ready.mime, text: ready.text || undefined, data: ready.blob && vision ? await base64Of(ready.blob) : undefined };
      }
      setWorking(`Asking ${model}`);
      const r = await askAssistant(question, history, material, abort.current.signal);
      setSent(true);
      setTimes((t) => [...t, Date.now()]);
      setThread((t) => [...t, { role: "assistant", text: r.answer + (r.truncated ? "\n\n_Only the first part of a very long file was read._" : "") }]);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setThread((t) => t.slice(0, -1));
      setTimes((t) => t.slice(0, -1));
      setDraft(question);
      setError((err as Error).message);
    } finally {
      setWorking(null);
    }
  }

  const prompts = PROMPTS[ready ? (isPage ? "page" : "file") : "none"];
  const imageOnly = ready && ready.kind === "image" && !vision;

  return (
    <div className="assist" onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDrop={(e) => { const f = e.dataTransfer.files[0]; if (f) { e.preventDefault(); e.stopPropagation(); onAttach(f); } }}>
      <div className="assist__doc">
        {ready ? <span className={`assist__icon assist__icon--${ready.kind}`} aria-hidden="true">{iconFor(ready.kind)}</span> : <Cosmo size={42} className="assist__avatar" />}
        <div className="assist__meta">
          <p className="assist__name">{m?.name ?? "Cosmonaut"}</p>
          <p className="assist__detail">
            {m?.kind === "loading" ? "Reading on this computer…"
              : m?.kind === "error" ? m.message
              : ready && ready.kind !== "page" ? `${ready.detail} · ${formatSize(ready.size)}`
              : ready ? ready.url.replace(/^https?:\/\//, "").slice(0, 60)
              : working ? "typing…"
              : model ? "online · drop a file to ask about it"
              : "drop a file to ask about it"}
          </p>
        </div>
        {ready && ready.kind !== "page" && ready.thumb && <img className="assist__thumb" src={ready.thumb} alt={`First page of ${ready.name}`} />}
      </div>

      <div className="assist__thread" aria-live="polite">
        {!thread.length && (
          <div className="assist__start">
            {model && !ready && <div className="wa wa--in"><div className="wa__b"><p>Hi, I'm Cosmonaut 👋 Ask me anything, or drop a file or open a page and I'll read it with you.</p><span className="wa__t">{clock(Date.now())}</span></div></div>}
            {model ? (
              <p className="assist__privacy">
                {ready ? <>This {isPage ? "page" : "file"} {isPage ? "is read" : "stays"} on this computer. {sent ? "Its text was sent" : "Its text is sent"} to <strong>{model}</strong> only with a question you ask.</> : <>Answers come from <strong>{model}</strong>.</>}
              </p>
            ) : (
              <div className="assist__connect">
                <p>Connect an AI model to summarize and ask questions. AetherDeck works without one; {ready && ready.kind !== "page" ? "you can still read the text below." : "nothing is sent anywhere."}</p>
                <button className="btn btn--small btn--primary" onClick={onConnect}>Connect AI</button>
              </div>
            )}
            {imageOnly && <p className="assist__privacy">The connected model can't look at images. Pick one that can in Settings.</p>}
            {model && !imageOnly && (
              <div className="assist__prompts">
                {prompts.map((p) => <button key={p} className="assist__chip" onClick={() => void ask(p)}>{p}</button>)}
              </div>
            )}
            {ready && ready.kind !== "page" && ready.text && (
              <button className="link assist__peek" onClick={() => setShowText((v) => !v)}>{showText ? "Hide the text" : "Show the text AetherDeck read"}</button>
            )}
            {showText && ready && ready.kind !== "page" && <pre className="assist__text">{ready.text.slice(0, 20_000)}{ready.text.length > 20_000 ? "\n…" : ""}</pre>}
          </div>
        )}
        {thread.map((t, i) => (
          <div key={i} className={`wa ${t.role === "user" ? "wa--out" : "wa--in"}`}>
            <div className="wa__b">
              {t.role === "user" ? <p>{t.text}</p> : <div className="assist__a"><Markdown text={t.text} /></div>}
              <span className="wa__t">{clock(times[i] ?? Date.now())}{t.role === "user" && <span className={`wa__tick ${thread[i + 1] || working ? "is-read" : ""}`} aria-hidden="true">✓✓</span>}</span>
            </div>
          </div>
        ))}
        {working && (
          <div className="wa wa--in" role="status" aria-label={working}>
            <div className="wa__b wa__b--typing"><span className="wa__dot" /><span className="wa__dot" /><span className="wa__dot" /></div>
          </div>
        )}
        {error && <p className="assist__error" role="alert">{error}</p>}
        <div ref={end} />
      </div>

      <form className="assist__ask" onSubmit={(e) => { e.preventDefault(); void ask(draft); }}>
        <input ref={pick} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttach(f); e.target.value = ""; }} />
        <button type="button" className="assist__clip" aria-label="Attach a file" onClick={() => pick.current?.click()}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m20 11-8.2 8.2a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7L9.5 17a1.7 1.7 0 0 1-2.4-2.4L14.5 7.2" /></svg>
        </button>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={ready ? `Ask about this ${isPage ? "page" : "file"}` : "Message"} aria-label="Ask Cosmonaut" disabled={!!working} />
        {working ? <button type="button" className="assist__send" onClick={() => abort.current?.abort()} aria-label="Stop">■</button>
          : <button type="submit" className="assist__send" disabled={!draft.trim()} aria-label="Ask"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6l.1 6.5L15 12 3.5 13.9Z" fill="currentColor" /></svg></button>}
      </form>
      {ready && ready.kind !== "page" && ready.path && desktop && (
        <button className="btn btn--small assist__open" onClick={() => void desktop!.invoke("downloads:open", ready.path)}>Open document</button>
      )}
    </div>
  );
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function iconFor(kind?: string) {
  const s = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "page") return <svg {...s}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5Z" /></svg>;
  if (kind === "image") return <svg {...s}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.7" /><path d="m4 17.5 5-4.5 4 3 3-2 4 3.5" /></svg>;
  if (kind === "sheet") return <svg {...s}><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="M4 9h16M4 14.5h16M10 3.5v17" /></svg>;
  if (!kind || kind === "none") return <svg {...s}><path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9Z" /><path d="M18 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8Z" /></svg>;
  return <svg {...s}><path d="M7 3.5h7l4 4v13H7z" /><path d="M14 3.5v4h4" /><text x="8.4" y="17.2" fontSize="5.4" fill="currentColor" stroke="none" fontWeight="700">{kind === "pdf" ? "PDF" : "DOC"}</text></svg>;
}

/** Just enough Markdown for answers: headings, lists, bold, italics and code, rendered as elements (no HTML). */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || num) {
      const ordered = !!num;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? num)![1]);
      continue;
    }
    flush();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) blocks.push(<p key={blocks.length} className="md__h">{inline(h[2])}</p>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_|\*[^*]+\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong>
    : part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code>
    : /^[_*].+[_*]$/.test(part) ? <em key={i}>{part.slice(1, -1)}</em>
    : part);
}
