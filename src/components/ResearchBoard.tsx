// The research board: searches as cards to drag, connect and group, with summaries across a group from the person's
// own model. Pages are read in the invisible pool when the desktop app is there; on the web, the snippets are used.
import { useEffect, useMemo, useRef, useState } from "react";
import { askAssistant } from "../lib/api.ts";
import { desktop } from "../lib/desktop.ts";
import { checkCitations, EMPTY_BOARD, GROUP_ACTIONS, groupMaterial, groupQuestion, hull, makeGroup, members, numberedSources, reachable, removeResearch, setGroup, toggleLink, type Board, type GroupResult, type Research } from "../lib/research.ts";
import { Markdown } from "./Assistant.tsx";
import { Glyph, GLYPHS, Sidebar, type SideSection } from "./Sidebar.tsx";

const PAGES_READ = 8;
const PAGE_TEXT = 6000;

interface Props {
  board: Board;
  aiReady: boolean;
  onChange: (change: (b: Board) => Board) => void;
  onAsk: (question: string) => void;
  onOpenPages: (pages: { url: string; title: string }[]) => void;
  onConnectModel: () => void;
  onClose: () => void;
}

export function ResearchBoard({ board, aiReady, onChange, onAsk, onOpenPages, onConnectModel, onClose }: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const [groupId, setGroupId] = useState<string | null>(board.groups[0]?.id ?? null);
  const [joining, setJoining] = useState<string | null>(null);
  const [naming, setNaming] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [custom, setCustom] = useState("");
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState(false);
  const [wide, setWide] = useState(false);
  const stop = useRef<AbortController | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const group = board.groups.find((g) => g.id === groupId);
  const shown = useMemo(() => { const q = query.trim().toLowerCase(); return q ? board.items.filter((r) => r.question.toLowerCase().includes(q) || r.sources.some((s) => s.title.toLowerCase().includes(q))) : board.items; }, [board.items, query]);
  const scope = group ? members(board, group.id) : reachable(board, picked);
  const size = useMemo(() => ({ width: Math.max(900, ...board.items.map((r) => r.x + 280)), height: Math.max(600, ...board.items.map((r) => r.y + 160)) }), [board.items]);
  const byId = (rid: string) => board.items.find((r) => r.id === rid);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); if (joining) setJoining(null); else onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); stop.current?.abort(); };
  }, [onClose, joining]);

  function press(r: Research, e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: r.id, dx: e.clientX - r.x, dy: e.clientY - r.y, moved: false };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    d.moved = true;
    onChange((b) => ({ ...b, items: b.items.map((r) => (r.id === d.id ? { ...r, x: Math.max(0, e.clientX - d.dx), y: Math.max(24, e.clientY - d.dy) } : r)) }));
  }
  function release(r: Research, e: React.MouseEvent) {
    const moved = drag.current?.moved;
    drag.current = null;
    if (moved) return;
    if (joining) { if (joining !== r.id) onChange((b) => toggleLink(b, joining, r.id)); setJoining(null); return; }
    setGroupId(r.group ?? null);
    setPicked((p) => (e.shiftKey || e.metaKey ? (p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]) : [r.id]));
  }
  function group_() {
    onChange((b) => {
      const next = makeGroup(b, picked, naming);
      setGroupId(next.groups[next.groups.length - 1]?.id ?? null);
      return next;
    });
    setNaming("");
    setPicked([]);
  }

  async function ask(kind: string, prompt: string) {
    if (!aiReady) return onConnectModel();
    stop.current?.abort();
    const ctrl = (stop.current = new AbortController());
    setError("");
    const sources = numberedSources(scope);
    const pages = new Map<string, string>();
    if (desktop) {
      setBusy("Reading the sources…");
      const results = await Promise.all(sources.slice(0, PAGES_READ).map((s) => desktop!.invoke<{ text: string; humanCheck: boolean }>("engine:read", s.url).then((p) => [s.url, p] as const).catch(() => null)));
      for (const r of results) if (r && !r[1].humanCheck) pages.set(r[0], r[1].text.slice(0, PAGE_TEXT));
    }
    if (ctrl.signal.aborted) return;
    setBusy(`Asking your model, with ${pages.size} pages read…`);
    try {
      const reply = await askAssistant(groupQuestion(prompt), [], { name: group?.name ?? "Research", kind: "text", text: groupMaterial(scope, sources, pages) }, ctrl.signal);
      const checked = checkCitations(reply.answer, sources.length);
      const result: GroupResult = { kind, text: checked.invented ? `${checked.text}\n\n*${checked.invented} citation${checked.invented === 1 ? " pointed" : "s pointed"} to no source and ${checked.invented === 1 ? "was" : "were"} removed.*` : checked.text, model: reply.model, at: Date.now(), sources, pagesRead: pages.size };
      let gid = group?.id;
      onChange((b) => {
        let next = b;
        if (!gid) { next = makeGroup(b, scope.map((r) => r.id), scope[0]?.question.slice(0, 40) ?? "Research"); gid = next.groups[next.groups.length - 1].id; }
        return { ...next, groups: next.groups.map((g) => (g.id === gid ? { ...g, results: [result, ...g.results].slice(0, 12) } : g)) };
      });
      if (gid) setGroupId(gid);
    } catch (err) { if (!ctrl.signal.aborted) setError((err as Error).message); }
    setBusy("");
  }

  const all = !group && !picked.length;
  const dot = (hue: number) => <span className="side__dot" style={{ ["--hue" as string]: hue }} />;
  const sections: SideSection[] = [
    { label: "Menu", items: [
      { id: "all", label: "All research", icon: <Glyph d={GLYPHS.home} />, on: all, badge: board.items.length, onClick: () => { setGroupId(null); setPicked([]); } },
      { id: "linked", label: "Connected", icon: <Glyph d={GLYPHS.link} />, on: !group && picked.length > 0, badge: board.links.length, hint: "Cards you linked, with everything linked to them", onClick: () => { const first = board.links[0]?.[0]; if (first) { setGroupId(null); setPicked([first]); } } },
    ] },
    { label: "Groups", items: board.groups.map((g) => ({ id: g.id, label: g.name, icon: dot(g.hue), on: g.id === groupId, badge: members(board, g.id).length, onClick: () => { setGroupId(g.id); setPicked([]); } })) },
    { label: "Recent", items: [...board.items].sort((a, b) => b.at - a.at).slice(0, 6).map((r) => ({ id: r.id, label: r.question, icon: <Glyph d={GLYPHS.star} />, on: !group && picked.length === 1 && picked[0] === r.id, onClick: () => { setGroupId(null); setPicked([r.id]); } })) },
    { label: "General", items: [
      { id: "keep", label: board.keep ? "Keeping new searches" : "Not keeping searches", icon: <Glyph d={GLYPHS.pin} />, act: true, hint: "Whether each new search lands on this board", onClick: () => onChange((b) => ({ ...b, keep: !b.keep })) },
      ...(board.items.length ? [{ id: "forget", label: "Forget all", icon: <Glyph d={GLYPHS.trash} />, act: true, onClick: () => { if (confirm("Forget everything on this board? This can't be undone.")) { onChange(() => ({ ...EMPTY_BOARD, keep: board.keep })); setPicked([]); setGroupId(null); } } }] : []),
      { id: "close", label: "Close the board", icon: <Glyph d={GLYPHS.out} />, act: true, onClick: onClose },
    ] },
  ];

  return (
    <aside className={`deck board ${wide ? "is-wide" : ""}`} role="dialog" aria-label="Research board" data-ui>
      <Sidebar title="Research board" alerts={busy ? 1 : 0} collapsed={folded} onCollapse={setFolded} onClose={onClose} onWide={() => setWide((w) => !w)}
        who={{ icon: <Glyph d={GLYPHS.layers} size={22} />, name: "Your research", detail: board.items.length ? `${board.items.length} search${board.items.length === 1 ? "" : "es"} · ${board.groups.length} group${board.groups.length === 1 ? "" : "s"}` : "Searches you make appear here" }}
        search={{ value: query, placeholder: "Find in your research", onChange: setQuery }} sections={sections} />
      <div className="deck__main">
      <div className="board__body">
        <div className="board__canvas" onClick={(e) => { if (e.target === e.currentTarget) { setPicked([]); setJoining(null); } }}>
          <div className="board__plane" style={size}>
            {board.groups.map((g) => {
              const items = members(board, g.id);
              return items.length > 0 && <button key={g.id} className={`board__group ${g.id === groupId ? "is-on" : ""}`} style={{ ...hull(items), ["--hue" as string]: g.hue }} onClick={() => { setGroupId(g.id); setPicked([]); }}><span>{g.name}</span></button>;
            })}
            <svg className="board__links" style={size} aria-hidden="true">
              {board.links.map(([a, b]) => { const p = byId(a); const q = byId(b); return p && q && <line key={`${a}${b}`} x1={p.x + 120} y1={p.y + 62} x2={q.x + 120} y2={q.y + 62} />; })}
            </svg>
            {!board.items.length && <p className="board__empty">Ask anything in the browser. Each search lands here as a card you can connect to the others.</p>}
            {shown.map((r) => {
              const g = board.groups.find((x) => x.id === r.group);
              return (
                <article key={r.id} className={`rcard ${picked.includes(r.id) ? "is-on" : ""} ${joining === r.id ? "is-joining" : ""}`} style={{ left: r.x, top: r.y, ["--hue" as string]: g?.hue ?? 212 }}
                  onPointerDown={(e) => press(r, e)} onPointerMove={move} onClick={(e) => release(r, e)}>
                  <h3>{r.question}</h3>
                  <p>{r.sources.length} sources · {new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                  <div className="rcard__tools">
                    <button onClick={() => setJoining(joining === r.id ? null : r.id)} aria-label={`Connect ${r.question}`} title="Connect to another card">Connect</button>
                    <button onClick={() => onOpenPages(r.sources.map((x) => ({ url: x.url, title: x.title })))} aria-label={`Open the sites of ${r.question} as tabs`} title="Open every site as its own tab">Tabs</button>
                    <button onClick={() => onAsk(r.question)} title="Open this search again">Reopen</button>
                    <button onClick={() => onChange((b) => removeResearch(b, r.id))} aria-label={`Remove ${r.question}`} title="Remove">×</button>
                  </div>
                </article>
              );
            })}
          </div>
          {joining && <p className="board__tip" role="status">Click the card to connect it to. Press Esc to cancel.</p>}
        </div>
        <section className="board__side">
          {picked.length > 1 && !group && (
            <form className="board__make" onSubmit={(e) => { e.preventDefault(); group_(); }}>
              <input value={naming} onChange={(e) => setNaming(e.target.value)} placeholder={`Name a group of ${picked.length}`} aria-label="Group name" data-keys />
              <button className="deck__btn deck__btn--go">Group</button>
            </form>
          )}
          {!scope.length && <p className="deck__hint">Shift-click cards to group them, or press Connect to link two. Then ask your model about all of them at once.</p>}
          {scope.length > 0 && (
            <>
              <h3>{group?.name ?? (scope.length === 1 ? scope[0].question : `${scope.length} connected researches`)}</h3>
              <p className="board__scope">{scope.length} research{scope.length === 1 ? "" : "es"}, {numberedSources(scope).length} sources</p>
              <div className="board__acts">
                {GROUP_ACTIONS.map((a) => <button key={a.id} className="deck__btn" disabled={!!busy} onClick={() => void ask(a.label, a.ask)}>{a.label}</button>)}
                <button className="deck__btn" onClick={() => onOpenPages(numberedSources(scope).map((s) => ({ url: s.url, title: s.title })))}>Open all as tabs</button>
                {group && <button className="deck__btn" onClick={() => { onChange((b) => setGroup(b, scope.map((r) => r.id))); setGroupId(null); }}>Ungroup</button>}
              </div>
              <form className="board__ask" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) { void ask("Question", custom.trim()); setCustom(""); } }}>
                <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Ask about all of these" aria-label="Ask about all of these" data-keys />
              </form>
              {!aiReady && <p className="fine">Connect your own AI model to summarize. The board itself works without one.</p>}
              {busy && <p className="board__busy" role="status">{busy}<button className="deck__btn" onClick={() => { stop.current?.abort(); setBusy(""); }}>Stop</button></p>}
              {error && <p className="agents__error" role="alert">{error}</p>}
              {group?.results.map((x) => (
                <details key={x.at} className="board__result" open={x === group.results[0]}>
                  <summary>{x.kind}<small>{x.model} · {x.pagesRead} pages read</small></summary>
                  <Markdown text={x.text} />
                  <ol className="board__sources">{x.sources.map((s) => <li key={s.url}><a href={s.url} onClick={(e) => { e.preventDefault(); onOpenPages([{ url: s.url, title: s.title }]); }}>{s.title}</a> <span>{s.domain}</span></li>)}</ol>
                </details>
              ))}
            </>
          )}
        </section>
      </div>
      </div>
    </aside>
  );
}
