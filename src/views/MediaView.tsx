// Images and video: the media itself, always attributed to the page it comes from.
import { Spot, formatDate, type ViewProps } from "./primitives.tsx";

export function MediaView({ model, layout, selectedId, onSelect }: ViewProps) {
  const sourceById = new Map(model.sources.map((s) => [s.id, s]));
  return (
    <>
      <Spot at={layout.pos.root} className="z-top">
        <div className="question"><span className="question__eyebrow">Media</span><h1 className="question__title">{model.intent.query}</h1></div>
      </Spot>
      {model.nodes.filter((n) => n.id !== "root").map((n, i) => {
        const s = sourceById.get(n.sourceIds[0]);
        if (!s) return null;
        return (
          <Spot key={n.id} at={layout.pos[n.id]} delay={i * 40} card>
            <button className={`media ${selectedId === n.id ? "is-selected" : ""}`} data-node data-hint="Inspect" onClick={() => onSelect(n)} aria-label={`${s.title} from ${s.publisher ?? s.domain}`}>
              {s.thumbnail ? <img src={s.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="media__none">No preview</span>}
              <span className="media__caption">{s.title}<span className="chip__meta">{s.publisher ?? s.domain}{s.publicationDate ? ` · ${formatDate(s.publicationDate)}` : ""}</span></span>
            </button>
          </Spot>
        );
      })}
    </>
  );
}
