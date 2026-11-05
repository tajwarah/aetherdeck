// Search as a mind map: the question in the middle, answered there first in a few sentences, each numbered to the
// sites it rests on (the same numbers sit on those sites, threaded to the answer); branches (sub-questions, or kinds of site) to either side,
// and every site the search found as a card on its branch. Cards can be dragged anywhere. Drag one onto another,
// or pull a thread from a card's edge to another card, to connect them: connected sites form a group that moves
// together and opens together as a group of windows. Nothing here leaves this screen; the arrangement lasts as
// long as the search does.
import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { InformationNode, SearchResult } from "../../shared/types.ts";
import type { Pt } from "../lib/layout.ts";
import { Spot, SourceMark, EVIDENCE_LABEL, formatDate, type ViewProps } from "./primitives.tsx";

type Link = [string, string];

/** Connected sites: each group is every card reachable through the threads the person drew. Exported for tests. */
export function groupsOf(links: Link[]): string[][] {
  const next = new Map<string, Set<string>>();
  for (const [a, b] of links) {
    next.set(a, (next.get(a) ?? new Set()).add(b));
    next.set(b, (next.get(b) ?? new Set()).add(a));
  }
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const group: string[] = [];
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      group.push(id);
      stack.push(...(next.get(id) ?? []));
    }
    out.push(group);
  }
  return out;
}

/** A soft curve between two points, leaving horizontally like a mind map's branches. */
const curve = (a: Pt, b: Pt) => {
  const mx = (a.x + b.x) / 2;
  return `M${a.x} ${a.y} C${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
};

/** The world position under a screen point: the world is translated and scaled by the camera. */
function worldAt(el: Element, x: number, y: number): Pt {
  const world = el.closest(".world") as HTMLElement | null;
  if (!world) return { x, y };
  const r = world.getBoundingClientRect();
  const s = Number(world.style.getPropertyValue("--s")) || 1;
  return { x: (x - r.left) / s, y: (y - r.top) / s };
}

type Gesture =
  | { kind: "card"; ids: string[]; from: Pt; start: Map<string, Pt>; moved: boolean; pointer: number }
  | { kind: "thread"; id: string; to: Pt; pointer: number };

export function MindMapView({ model, layout, selectedId, onSelect, onOpen, onOpenGroup }: ViewProps) {
  const branches = layout.branches ?? [];
  const sourceById = new Map(model.sources.map((s) => [s.id, s]));
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  const [moved, setMoved] = useState<Record<string, Pt>>({});
  const [links, setLinks] = useState<Link[]>([]);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [picked, setPicked] = useState<string | null>(null); // keyboard: the first card of a connection
  const [lit, setLit] = useState<string[] | null>(null); // the sources of the answer's sentence under the pointer
  const answer = model.answer;
  // Each cited source's number, in the order the answer first cites it.
  const citeNo = new Map<string, number>();
  for (const x of answer?.sentences ?? []) for (const id of x.sourceIds) if (!citeNo.has(id)) citeNo.set(id, citeNo.size + 1);
  const g = useRef<Gesture | null>(null);
  const frame = useRef(0);

  const at = (id: string): Pt | undefined => moved[id] ?? layout.pos[id];
  const groups = groupsOf(links).filter((m) => m.length > 1);
  const groupOf = (id: string) => groups.find((m) => m.includes(id));
  const hueOf = new Map<string, number>();
  for (const b of branches) for (const id of b.leaves) hueOf.set(id, b.hue);

  const connect = (a: string, b: string) => {
    if (a === b) return;
    setLinks((ls) => (ls.some(([x, y]) => (x === a && y === b) || (x === b && y === a)) ? ls : [...ls, [a, b]]));
  };
  const ungroup = (ids: string[]) => setLinks((ls) => ls.filter(([a, b]) => !ids.includes(a) && !ids.includes(b)));

  /** The site card under a screen point, other than the ones being moved. */
  const cardAt = (x: number, y: number, except: string[]) => {
    for (const el of document.elementsFromPoint(x, y)) {
      const id = (el as HTMLElement).closest?.<HTMLElement>("[data-site]")?.dataset.site;
      if (id && !except.includes(id)) return id;
    }
    return null;
  };

  const begin = (e: RPointerEvent, next: Gesture) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // the field would pan
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    g.current = next;
    setGesture(next);
  };

  const onMove = (e: RPointerEvent) => {
    const cur = g.current;
    if (!cur || cur.pointer !== e.pointerId) return;
    const p = worldAt(e.currentTarget, e.clientX, e.clientY);
    if (cur.kind === "thread") cur.to = p;
    else {
      const dx = p.x - cur.from.x;
      const dy = p.y - cur.from.y;
      if (!cur.moved && Math.hypot(dx, dy) < 4) return;
      cur.moved = true;
      const next: Record<string, Pt> = {};
      for (const [id, s] of cur.start) next[id] = { x: s.x + dx, y: s.y + dy };
      (cur as Gesture & { next?: Record<string, Pt> }).next = next;
    }
    if (!frame.current) frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const now = g.current;
      if (!now) return;
      if (now.kind === "card") { const nx = (now as Gesture & { next?: Record<string, Pt> }).next; if (nx) setMoved((m) => ({ ...m, ...nx })); }
      setGesture({ ...now });
    });
  };

  const onUp = (e: RPointerEvent, click?: () => void) => {
    const cur = g.current;
    if (!cur || cur.pointer !== e.pointerId) return;
    g.current = null;
    setGesture(null);
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (cur.kind === "thread") {
      const target = cardAt(e.clientX, e.clientY, [cur.id]);
      if (target) connect(cur.id, target);
      return;
    }
    const nx = (cur as Gesture & { next?: Record<string, Pt> }).next;
    if (nx) setMoved((m) => ({ ...m, ...nx }));
    if (!cur.moved) return click?.();
    // A single card dropped onto another joins it: they connect, and it settles just beside the one it joined.
    if (cur.ids.length === 1) {
      const target = cardAt(e.clientX, e.clientY, cur.ids);
      const tp = target && at(target);
      if (target && tp) {
        connect(cur.ids[0], target);
        const side = tp.x >= 0 ? 1 : -1; // outward, away from the branches
        // cards are drawn up to 1.3× their size when zoomed out (--lc), so step aside by a whole card
        const world = (e.currentTarget as HTMLElement).closest<HTMLElement>(".world");
        const lc = Number(world?.style.getPropertyValue("--lc")) || 1;
        setMoved((m) => ({ ...m, [cur.ids[0]]: { x: tp.x + side * (268 * lc + 28), y: tp.y } }));
      }
    }
  };

  const startCard = (e: RPointerEvent, ids: string[]) => {
    const start = new Map(ids.map((id) => [id, at(id)!]).filter(([, p]) => p) as [string, Pt][]);
    begin(e, { kind: "card", ids, from: worldAt(e.currentTarget, e.clientX, e.clientY), start, moved: false, pointer: e.pointerId });
  };

  const pagesOf = (ids: string[]) => ids.map((id) => sourceById.get(nodeById.get(id)?.sourceIds[0] ?? "")).filter(Boolean).map((s) => ({ url: s!.canonicalUrl, title: s!.title }));

  // ---- threads: question → branches → leaves, and the person's own connections ----
  const root = layout.pos.root;
  const lines: { key: string; d: string; hue: number; kind: string }[] = [];
  for (const b of branches) {
    const bp = at(b.id);
    if (!bp) continue;
    lines.push({ key: `b-${b.id}`, d: curve(root, bp), hue: b.hue, kind: "trunk" });
    for (const id of b.leaves) { const lp = at(id); if (lp) lines.push({ key: `l-${id}`, d: curve(bp, lp), hue: b.hue, kind: "twig" }); }
  }
  // the answer's threads: from the answer to every site it cites
  for (const id of citeNo.keys()) {
    const lp = at(`src:${id}`);
    if (lp) lines.push({ key: `c-${id}`, d: curve({ x: root.x + Math.sign(lp.x || 1) * 250, y: root.y }, lp), hue: 258, kind: lit?.includes(id) ? "cite is-lit" : "cite" });
  }
  const threadFrom = gesture?.kind === "thread" ? at(gesture.id) : undefined;

  let order = 0;
  return (
    <div className="mm" onPointerMove={onMove}>
      <svg className="threads mm__threads" aria-hidden="true">
        {lines.map((l) => <path key={l.key} d={l.d} className={`mm__line mm__line--${l.kind}`} style={{ stroke: `hsl(${l.hue} 70% 72%)` }} />)}
        {links.map(([a, b]) => {
          const pa = at(a), pb = at(b);
          return pa && pb ? <g key={`${a}~${b}`}><path d={curve(pa, pb)} className="mm__link mm__link--glow" /><path d={curve(pa, pb)} className="mm__link" /></g> : null;
        })}
        {threadFrom && gesture?.kind === "thread" && <path d={curve(threadFrom, gesture.to)} className="mm__link mm__link--drawing" />}
      </svg>

      <Spot at={root} className="z-top">
        {answer ? (
          <section className="answer" data-ui aria-label="The answer">
            <span className="answer__by">{answer.by === "ai" ? `Answer · written by ${answer.model ?? "AI"} from the sites around it` : "Answer · in the sites' own words"}</span>
            <h1 className="answer__q">{model.intent.query}</h1>
            <ol className="answer__body">
              {answer.sentences.map((x, i) => (
                <li key={i} onPointerEnter={() => setLit(x.sourceIds)} onPointerLeave={() => setLit(null)}>
                  {answer.by === "extract" ? `“${x.text}”` : x.text}
                  {x.sourceIds.map((id) => {
                    const node = nodeById.get(`src:${id}`);
                    const src = sourceById.get(id);
                    return (
                      <button key={id} className="answer__cite" title={src ? `${src.title} · ${src.domain}` : undefined} aria-label={`Source ${citeNo.get(id)}${src ? `: ${src.title}` : ""}`}
                        onFocus={() => setLit([id])} onBlur={() => setLit(null)}
                        onClick={() => node && onSelect(node, at(node.id))}>{citeNo.get(id)}</button>
                    );
                  })}
                </li>
              ))}
            </ol>
            <span className="answer__foot">
              {model.complete ? `${model.sources.length} sites around it, ${citeNo.size} cited` : "Still searching: more sites are arriving"}
              {answer.by === "extract" && <> · Connect a model in Settings (or sign in with ChatGPT) for a written answer</>}
            </span>
          </section>
        ) : (
          <div className="question mm__question">
            <span className="question__eyebrow">{model.complete ? `${model.sources.length} sites` : "Searching"}</span>
            <h1 className="question__title">{model.intent.query}</h1>
          </div>
        )}
      </Spot>

      {branches.map((b) => {
        const sub = b.subtopic ? nodeById.get(b.subtopic) : undefined;
        return (
          <Spot key={b.id} at={at(b.id)} delay={60 * order++}>
            <button className={`mm__branch ${selectedId === b.subtopic ? "is-selected" : ""}`} style={{ ["--hue" as string]: b.hue }} data-node data-hint={sub ? "Focus" : "Move the branch"}
              onPointerDown={(e) => startCard(e, [b.id, ...b.leaves])} onPointerUp={(e) => onUp(e, () => sub && onSelect(sub, at(b.id)))}
              onClick={(e) => { if (e.detail === 0 && sub) onSelect(sub, at(b.id)); }}
              aria-label={`${b.label}, ${b.leaves.length} ${b.leaves.length === 1 ? "item" : "items"}. Drag to move the branch.`}>
              <span className="mm__dot" aria-hidden="true" />{b.label}<span className="subq__count">{b.leaves.length}</span>
            </button>
          </Spot>
        );
      })}

      {branches.flatMap((b) => b.leaves).map((id) => {
        const n = nodeById.get(id);
        const p = at(id);
        if (!n || !p) return null;
        const delay = 40 * order++;
        const dragging = gesture?.kind === "card" && gesture.moved && gesture.ids.includes(id);
        if (n.nodeType === "finding" || n.nodeType === "gap") {
          const ev = model.evidence.find((e) => `ev:${e.id}` === n.id);
          return (
            <Spot key={id} at={p} delay={delay} card>
              <button className={`finding mm__finding finding--${ev?.evidenceType ?? "gap"} ${selectedId === id ? "is-selected" : ""} ${dragging ? "is-dragging" : ""}`} style={{ ["--hue" as string]: hueOf.get(id) }} data-node data-hint="Trace to source"
                onPointerDown={(e) => startCard(e, [id])} onPointerUp={(e) => onUp(e, () => onSelect(n, p))} onClick={(e) => { if (e.detail === 0) onSelect(n, p); }}>
                <span className="finding__type">{EVIDENCE_LABEL[ev?.evidenceType ?? "gap"]}</span>
                <span className="finding__claim">{ev?.evidenceType === "direct_excerpt" ? `“${n.title}”` : n.title}</span>
              </button>
            </Spot>
          );
        }
        const s = sourceById.get(n.sourceIds[0]);
        if (!s) return null;
        const group = groupOf(id);
        return (
          <Spot key={id} at={p} delay={delay} card className={dragging ? "z-top" : ""}>
            <SiteCard node={n} source={s} hue={hueOf.get(id) ?? 38} cite={citeNo.get(s.id)} lit={!!lit?.includes(s.id)} selected={selectedId === id} grouped={!!group} picked={picked === id} dragging={dragging}
              onPointerDown={(e) => startCard(e, group && e.altKey ? group : [id])}
              onPointerUp={(e) => onUp(e, () => onSelect(n, p))}
              onKey={() => onSelect(n, p)}
              onOpen={() => onOpen?.(s.canonicalUrl, s.title)}
              onThread={(e) => begin(e, { kind: "thread", id, to: p, pointer: e.pointerId })}
              onThreadUp={onUp}
              onPick={() => { if (!picked) setPicked(id); else { connect(picked, id); setPicked(null); } }} />
          </Spot>
        );
      })}

      {groups.map((m) => {
        const pts = m.map(at).filter(Boolean) as Pt[];
        const top = { x: pts.reduce((t, q) => t + q.x, 0) / pts.length, y: Math.min(...pts.map((q) => q.y)) - 92 };
        return (
          <Spot key={m.join("|")} at={top} className="z-top">
            <div className="mm__group" role="group" aria-label={`Group of ${m.length} sites`}>
              <span className="mm__group-grab" onPointerDown={(e) => startCard(e, m)} onPointerUp={(e) => onUp(e)} title="Drag to move the group" role="button" aria-label="Move the group">
                <span className="mm__dot mm__dot--thread" aria-hidden="true" />{m.length} sites
              </span>
              <button className="mm__group-btn" onClick={() => onOpenGroup?.(pagesOf(m))}>Open together</button>
              <button className="mm__group-btn" onClick={() => ungroup(m)}>Ungroup</button>
            </div>
          </Spot>
        );
      })}
    </div>
  );
}

function SiteCard({ node, source, hue, cite, lit, selected, grouped, picked, dragging, onPointerDown, onPointerUp, onKey, onOpen, onThread, onThreadUp, onPick }: {
  node: InformationNode; source: SearchResult; hue: number; cite?: number; lit: boolean; selected: boolean; grouped: boolean; picked: boolean; dragging: boolean;
  onPointerDown: (e: RPointerEvent) => void; onPointerUp: (e: RPointerEvent) => void; onKey: () => void; onOpen: () => void;
  onThread: (e: RPointerEvent) => void; onThreadUp: (e: RPointerEvent) => void; onPick: () => void;
}) {
  const [icon, setIcon] = useState(true);
  const site = source.publisher && !source.publisher.startsWith("Discussed") ? source.publisher : source.domain;
  return (
    <div className={`mm__site ${lit ? "is-lit" : ""} ${selected ? "is-selected" : ""} ${grouped ? "is-grouped" : ""} ${picked ? "is-picked" : ""} ${dragging ? "is-dragging" : ""}`} style={{ ["--hue" as string]: hue }} data-site={node.id}>
      <button className="mm__site-body" data-node data-hint="Inspect · drag to move" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onDoubleClick={onOpen} onClick={(e) => { if (e.detail === 0) onKey(); }}
        onKeyDown={(e) => { if (e.key === "g" || e.key === "G") { e.preventDefault(); onPick(); } }}
        aria-label={`${source.title}, ${site}${source.publicationDate ? `, ${formatDate(source.publicationDate)}` : ""}. Press G here and on another site to connect them.`}>
        <span className="mm__site-head">
          {icon && !source.domain.includes(" ") ? <img className="mm__icon" src={`https://${source.domain}/favicon.ico`} alt="" referrerPolicy="no-referrer" onError={() => setIcon(false)} /> : <SourceMark source={source} />}
          <span className="mm__site-name">{site}{source.publicationDate ? ` · ${formatDate(source.publicationDate)}` : ""}</span>
          {cite && <span className="mm__cite" title="Cited in the answer">{cite}</span>}
        </span>
        <span className="mm__site-title">{node.title}</span>
        <span className="mm__site-snippet lod-2">{source.snippet}</span>
      </button>
      <button className="mm__open" onClick={onOpen} aria-label={`Open ${site} in a window`} title="Open in a window">
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
      </button>
      <span className="mm__handle" role="button" tabIndex={-1} aria-hidden="true" title="Drag to another site to connect them" onPointerDown={onThread} onPointerUp={onThreadUp} />
    </div>
  );
}
