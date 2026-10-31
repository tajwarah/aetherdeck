// Source inspection: from any synthesized point to the original material, with provenance in full.
import type { EnvironmentModel, Evidence, SearchResult } from "../../shared/types.ts";
import { EVIDENCE_LABEL, KIND_LABEL, formatDate, SourceMark } from "../views/primitives.tsx";
import { LayerRail, layersFor } from "./LayerRail.tsx";

/** One honest line on why this source is here: how it matched, in the source's own terms. */
function whyThis(model: EnvironmentModel, source: SearchResult) {
  const cuisineOnly = source.limitations?.find((l) => l.startsWith("Matched by"));
  if (cuisineOnly) return cuisineOnly;
  if (source.place) return `Listed near ${model.intent.locationContext.label?.split(",")[0] ?? "your location"}${source.place.distanceKm !== undefined ? `, ${source.place.distanceKm.toFixed(1)} km away` : ""}`;
  const cites = model.evidence.filter((e) => e.sourceIds.includes(source.id)).length;
  if (cites) return `Cited by ${cites} ${cites === 1 ? "finding" : "findings"} on “${model.intent.constraints.topic}”`;
  return `Found for “${model.intent.constraints.topic}” via ${providerName(source.sourceProvider)}`;
}

interface Props {
  model: EnvironmentModel;
  source: SearchResult;
  focusEvidence?: Evidence;
  kept: boolean;
  onClose: () => void;
  onKeep: () => void;
  onDeeper: (q: string) => void;
  onPrepare: (kind: "contact_provider" | "prepare_reservation") => void;
  onOpen: (url: string, title?: string) => void;
}

export function Inspector({ model, source, focusEvidence, kept, onClose, onKeep, onDeeper, onPrepare, onOpen }: Props) {
  const supports = model.evidence.filter((e) => e.sourceIds.includes(source.id));
  const p = source.place;
  const freshness = source.freshnessStatus === "sample" ? "Sample data — not retrieved" : source.freshnessStatus === "cached" ? "From this session's cache" : "Retrieved live";
  const service = model.intent.intentType === "local_service";
  // Related images: other retrieved sources that published one, each attributed (panel 05's strip).
  const strip = model.sources.filter((s) => s.id !== source.id && s.thumbnail).slice(0, 4);
  return (
    <aside className="sheet" data-ui role="complementary" aria-label="Source details" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      {source.thumbnail && <img className="sheet__photo" src={source.thumbnail} alt="" referrerPolicy="no-referrer" />}
      <header className="sheet__head">
        <SourceMark source={source} />
        <div>
          <p className="sheet__kicker">{KIND_LABEL[source.contentType]} · {source.publisher ?? source.domain}</p>
          <h2 className="sheet__title">{source.title}</h2>
          <p className="sheet__why">{whyThis(model, source)}</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close source details" autoFocus>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </header>

      {strip.length > 0 && (
        <ul className="strip" aria-label="Images from related sources">
          {strip.map((s) => (
            <li key={s.id}><a href={s.canonicalUrl} target="_blank" rel="noopener noreferrer" title={`${s.title} — ${s.publisher ?? s.domain}`}><img src={s.thumbnail} alt={s.title} loading="lazy" referrerPolicy="no-referrer" /></a></li>
          ))}
        </ul>
      )}

      {p && (
        <section>
          <h3 className="sheet__h">Layers</h3>
          <LayerRail layers={layersFor(source, () => onPrepare(service ? "contact_provider" : "prepare_reservation"))} />
        </section>
      )}

      {focusEvidence && (
        <section className="sheet__focus">
          <p className={`badge badge--${focusEvidence.evidenceType}`}>{EVIDENCE_LABEL[focusEvidence.evidenceType]}</p>
          <p className="sheet__claim">{focusEvidence.claim}</p>
          {focusEvidence.supportingExcerpt && focusEvidence.evidenceType !== "direct_excerpt" && <blockquote>“{focusEvidence.supportingExcerpt}”</blockquote>}
          <p className="sheet__fine">{focusEvidence.confidenceOrLimitations}</p>
        </section>
      )}

      <dl className="facts">
        <dt>Address</dt><dd><a href={source.canonicalUrl} target="_blank" rel="noopener noreferrer" className="facts__url">{source.canonicalUrl.replace(/^https?:\/\//, "")}</a></dd>
        {source.authors?.length ? (<><dt>Authors</dt><dd>{source.authors.join(", ")}</dd></>) : null}
        <dt>Published</dt><dd>{source.publicationDate ? formatDate(source.publicationDate) : "No date given by the source"}</dd>
        <dt>Retrieved</dt><dd>{formatDate(source.retrievedAt, true)} · {freshness}</dd>
        <dt>Found via</dt><dd>{providerName(source.sourceProvider)}</dd>
        {p && (<>
          {p.distanceKm !== undefined && (<><dt>Distance</dt><dd>{p.distanceKm.toFixed(2)} km straight line</dd></>)}
          <dt>Address</dt><dd>{p.address || "not listed"}</dd>
          <dt>Hours</dt><dd>{p.openingHours || "not listed"}</dd>
          <dt>Phone</dt><dd>{p.phone || "not listed"}</dd>
          <dt>Website</dt><dd>{p.website ? <a href={p.website} target="_blank" rel="noopener noreferrer">{p.website.replace(/^https?:\/\//, "")}</a> : "not listed"}</dd>
        </>)}
      </dl>

      {!p && <p className="sheet__snippet">{source.snippet}</p>}

      {supports.length > 0 && (
        <section>
          <h3 className="sheet__h">Supports {supports.length === 1 ? "this point" : `these ${supports.length} points`}</h3>
          <ul className="supports">
            {supports.map((e) => (
              <li key={e.id}><span className="badge">{EVIDENCE_LABEL[e.evidenceType]}</span> {e.claim}</li>
            ))}
          </ul>
        </section>
      )}

      {source.limitations?.length ? (
        <section>
          <h3 className="sheet__h">Keep in mind</h3>
          <ul className="limits">{source.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        </section>
      ) : null}

      <footer className="sheet__actions">
        {source.freshnessStatus !== "sample" && <button className="btn btn--primary" onClick={() => onOpen(source.canonicalUrl, source.title)}>Open original</button>}
        {p && source.freshnessStatus !== "sample" && <button className="btn" onClick={() => onPrepare(service ? "contact_provider" : "prepare_reservation")}>{service ? "Prepare a request" : "Prepare booking request"}</button>}
        {!p && <button className="btn" onClick={() => onDeeper(source.title)}>Go deeper</button>}
        <button className="btn btn--quiet" onClick={onKeep} aria-pressed={kept}>{kept ? "Kept" : "Keep"}</button>
      </footer>
    </aside>
  );
}

function providerName(id: string) {
  return ({ wikipedia: "Wikipedia API", openalex: "OpenAlex scholarly index", arxiv: "arXiv API", gdelt: "GDELT news index", currents: "Wikipedia Current events", osm: "OpenStreetMap (Overpass)", photon: "OpenStreetMap (Photon search)", brave: "Brave Search", demo: "Built-in sample data", direct: "Direct page fetch" } as Record<string, string>)[id] ?? id;
}
