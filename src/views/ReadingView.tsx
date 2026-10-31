// A single page, read in place, with the original one step away.
import { Spot, formatDate, type ViewProps } from "./primitives.tsx";

export function ReadingView({ model, onSelect, onOpen }: ViewProps) {
  const s = model.sources[0];
  const node = model.nodes.find((n) => n.id !== "root");
  if (!s || !node) return null;
  const paragraphs = model.evidence.filter((e) => e.evidenceType === "direct_excerpt");
  return (
    <Spot at={{ x: 0, y: 0 }}>
      <article className="reading">
        <p className="reading__meta">{s.publisher ?? s.domain}{s.publicationDate ? ` · ${formatDate(s.publicationDate)}` : ""} · read {formatDate(s.retrievedAt, true)}</p>
        <h1 className="reading__title">{s.title}</h1>
        {paragraphs.length ? paragraphs.map((p) => <p key={p.id}>{p.claim}</p>) : <p>{s.snippet}</p>}
        <div className="reading__actions" data-ui>
          {onOpen ? <button className="btn btn--primary" onClick={() => onOpen(s.canonicalUrl, s.title)}>Open the original</button> : <a className="btn btn--primary" href={s.canonicalUrl} target="_blank" rel="noopener noreferrer">Open the original</a>}
          <button className="btn" onClick={() => onSelect(node)}>Source details</button>
        </div>
        <p className="reading__note">Leading paragraphs only — the original page is the authority.</p>
      </article>
    </Spot>
  );
}
