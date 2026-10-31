import type { ReactNode } from "react";
import type { EnvironmentModel, InformationNode, SearchResult } from "../../shared/types.ts";
import type { Layout, Pt } from "../lib/layout.ts";

export interface ViewProps {
  model: EnvironmentModel;
  layout: Layout;
  selectedId: string | null;
  /** `at`: where the node is now, when the person has moved it. */
  onSelect: (node: InformationNode, at?: Pt) => void;
  onPrepare: (source: SearchResult, kind: "contact_provider" | "prepare_reservation") => void;
  /** Open a page in a floating window in front of the space. */
  onOpen?: (url: string, title?: string) => void;
  /** Open several pages at once, side by side as one group of windows. */
  onOpenGroup?: (pages: { url: string; title: string }[]) => void;
}

/** Places content at a world position; the inner wrapper keeps labels readable at any zoom. */
export function Spot({ at, children, className = "", delay = 0, card = false }: { at?: Pt; children: ReactNode; className?: string; delay?: number; card?: boolean }) {
  if (!at) return null;
  return (
    <div className={`spot ${card ? "spot--card" : ""} ${className}`} style={{ transform: `translate3d(${at.x}px, ${at.y}px, 0)` }}>
      <div className="spot__inner" style={{ animationDelay: `${delay}ms` }}>{children}</div>
    </div>
  );
}

export const KIND_LABEL: Record<string, string> = {
  encyclopedia: "Reference",
  paper: "Paper",
  web: "Web",
  news: "Report",
  place: "Place",
  image: "Image",
  video: "Video",
};

export const EVIDENCE_LABEL: Record<string, string> = {
  direct_excerpt: "Excerpt",
  ai_summary: "AI summary",
  inference: "Inference",
  conflict: "Disagreement",
  gap: "Gap",
};

export function formatDate(iso?: string, withTime = false) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) });
}

export function SourceMark({ source }: { source: SearchResult }) {
  const letter = (source.publisher ?? source.domain ?? "?").replace(/^the /i, "").charAt(0).toUpperCase();
  return <span className={`mark mark--${source.contentType}`} aria-hidden="true">{letter}</span>;
}

/** Hairline threads between world points; strokes stay 1px regardless of zoom. */
export function Threads({ lines }: { lines: { a: Pt; b: Pt; active?: boolean; kind?: string; key: string }[] }) {
  return (
    <svg className="threads" aria-hidden="true">
      {lines.map((l) => (
        <line key={l.key} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} className={`thread ${l.active ? "thread--active" : ""} ${l.kind ? `thread--${l.kind}` : ""}`} />
      ))}
    </svg>
  );
}

/** A source card. With a published thumbnail it becomes a photo card (panels 03, 05, 10); otherwise a mark and text. */
export function SourceChip({ node, source, selected, onSelect, delay }: { node: InformationNode; source: SearchResult; selected: boolean; onSelect: () => void; delay?: number }) {
  const photo = !!source.thumbnail;
  return (
    <button className={`chip ${photo ? "chip--photo" : ""} ${selected ? "is-selected" : ""} ${source.freshnessStatus === "sample" ? "is-sample" : ""}`} data-node data-hint="Inspect source" onClick={onSelect} style={{ animationDelay: `${delay ?? 0}ms` }}
      aria-label={`${KIND_LABEL[source.contentType]}: ${source.title}, ${source.publisher ?? source.domain}${source.publicationDate ? `, ${formatDate(source.publicationDate)}` : ""}`}>
      {photo ? <img className="chip__photo" src={source.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <SourceMark source={source} />}
      <span className="chip__body">
        <span className="chip__title">{node.title}</span>
        <span className="chip__meta">
          {source.publisher ?? source.domain}
          {source.publicationDate ? ` · ${formatDate(source.publicationDate)}` : ""}
          {source.freshnessStatus === "sample" ? " · sample" : ""}
        </span>
        <span className="chip__snippet lod-2">{source.snippet}</span>
      </span>
    </button>
  );
}
