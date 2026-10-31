// Local discovery and comparison: a quiet distance map around the approved location,
// with listings laid out side by side. Only what the listing states is shown; gaps say "not listed".
import { Spot, Threads, type ViewProps } from "./primitives.tsx";
import type { InformationNode, SearchResult } from "../../shared/types.ts";
import { COMPARE_COLUMNS } from "../lib/layout.ts";

const ATTRS: { label: string; get: (s: SearchResult) => string | undefined }[] = [
  { label: "Distance", get: (s) => (s.place?.distanceKm !== undefined ? `${s.place.distanceKm.toFixed(1)} km` : undefined) },
  { label: "Listed as", get: (s) => s.place?.cuisine ?? s.place?.category },
  { label: "Hours listed", get: (s) => s.place?.openingHours },
  { label: "Phone", get: (s) => (s.place?.phone ? "listed" : undefined) },
  { label: "Website", get: (s) => (s.place?.website ? s.place.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "") : undefined) },
  { label: "Address", get: (s) => s.place?.address },
  { label: "Match", get: (s) => (s.limitations?.find((l) => l.startsWith("Matched by")) ? "by cuisine only" : "by name or listing") },
];

function CompareTable({ rows, selectedId, onSelect, onPrepare, service }: { rows: { node: InformationNode; source: SearchResult; n: number }[]; selectedId: string | null; onSelect: (n: InformationNode) => void; onPrepare: ViewProps["onPrepare"]; service: boolean }) {
  return (
    <div className="compare" role="table" aria-label="Comparison of nearby listings" style={{ ["--cols" as string]: rows.length }}>
      <div className="compare__row compare__row--head" role="row">
        <span className="compare__label" role="columnheader">{rows.length} nearest matches</span>
        {rows.map(({ node, source, n }) => (
          <button key={node.id} role="columnheader" className={`compare__name ${selectedId === node.id ? "is-selected" : ""}`} data-node data-hint="Inspect listing" onClick={() => onSelect(node)}>
            <span className="place__num">{n}</span>{source.title}
          </button>
        ))}
      </div>
      {ATTRS.map((a) => (
        <div className="compare__row" role="row" key={a.label}>
          <span className="compare__label" role="rowheader">{a.label}</span>
          {rows.map(({ node, source }) => {
            const v = a.get(source);
            return <span key={node.id} role="cell" className={`compare__cell ${v ? "" : "is-missing"} ${a.label === "Match" && v === "by cuisine only" ? "is-caveat" : ""}`}>{v ?? "not listed"}</span>;
          })}
        </div>
      ))}
      <div className="compare__row compare__row--actions" role="row" data-ui>
        <span className="compare__label" role="rowheader">Next step</span>
        {rows.map(({ node, source }) => (
          <span key={node.id} role="cell" className="compare__cell">
            {source.freshnessStatus === "sample" ? <em>sample only</em> : (
              <button className="btn btn--small btn--primary" onClick={() => onPrepare(source, service ? "contact_provider" : "prepare_reservation")}>{service ? "Prepare request" : "Booking request"}</button>
            )}
          </span>
        ))}
      </div>
      <p className="compare__note">Only what each listing states. No ratings, prices or live availability exist in this open data, so none are shown.</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className={`row ${value ? "" : "row--missing"}`}>
      <span className="row__label">{label}</span>
      <span className="row__value">{value || "not listed"}</span>
    </div>
  );
}

export function PlacesView({ model, layout, selectedId, onSelect, onPrepare }: ViewProps) {
  const { pos, map } = layout;
  const places = model.nodes.filter((n) => n.nodeType === "place");
  const sourceById = new Map(model.sources.map((s) => [s.id, s]));
  const comparison = model.visualization === "comparison";
  const service = model.intent.intentType === "local_service";
  const loc = model.intent.locationContext;

  if (!map || loc.lat === undefined) return null; // nothing to draw until a location is chosen
  const c = map.center;
  return (
    <>
      <Threads
        lines={places.flatMap((n) =>
          !comparison && selectedId === n.id && pos[`dot:${n.id}`] && pos[n.id] ? [{ key: n.id, a: pos[`dot:${n.id}`], b: pos[n.id], kind: "cite", active: true }] : [],
        )}
      />
      <svg className="mapfield" aria-hidden="true">
        {map.rings.map((r) => (
          <g key={r}>
            <circle cx={c.x} cy={c.y} r={r * map.unitsPerKm} className="ring" />
            {/* labels sit on the lower-right diagonal so they never stack */}
            <text x={c.x + r * map.unitsPerKm * 0.71 + 4} y={c.y + r * map.unitsPerKm * 0.71 + 12} className="ring__label">{r} km</text>
          </g>
        ))}
        <line x1={c.x} y1={c.y - map.radius - 30} x2={c.x} y2={c.y - map.radius - 8} className="north" />
        <text x={c.x} y={c.y - map.radius - 38} className="ring__label ring__label--n">N</text>
      </svg>
      <Spot at={c} className="z-top">
        <div className="origin" role="img" aria-label={`Search point: ${loc.label ?? "your location"}`}>
          <span className="origin__dot" />
          <span className="origin__label">{loc.source === "device" ? "You (approx.)" : loc.label?.split(",")[0] ?? "Search point"}</span>
        </div>
      </Spot>
      <Spot at={{ x: c.x, y: c.y + map.radius + 46 }}>
        <span className="attribution">Straight-line km · © OpenStreetMap contributors</span>
      </Spot>
      {places.map((n, i) => (
        <Spot key={`dot-${n.id}`} at={pos[`dot:${n.id}`]}>
          <button className={`pin ${selectedId === n.id ? "is-selected" : ""}`} data-node data-hint={n.title} onClick={() => onSelect(n)} aria-label={`${i + 1}. ${n.title} on map`}>
            <span>{i + 1}</span>
          </button>
        </Spot>
      ))}
      {comparison && places.length > 0 && (
        <Spot at={pos.table} card>
          <CompareTable
            rows={places.slice(0, COMPARE_COLUMNS).flatMap((node, i) => { const source = sourceById.get(node.sourceIds[0]); return source ? [{ node, source, n: i + 1 }] : []; })}
            selectedId={selectedId}
            onSelect={onSelect}
            onPrepare={onPrepare}
            service={service}
          />
        </Spot>
      )}
      {!comparison && places.slice(0, 8).map((n, i) => {
        const s = sourceById.get(n.sourceIds[0]) as SearchResult | undefined;
        if (!s?.place) return null;
        const p = s.place;
        const sample = s.freshnessStatus === "sample";
        const caveat = s.limitations?.find((l) => l.startsWith("Matched by"));
        return (
          <Spot key={n.id} at={pos[n.id]} delay={i * 45} card>
            <article className={`place ${selectedId === n.id ? "is-selected" : ""} ${sample ? "is-sample" : ""}`}>
              <button className="place__head" data-node data-hint="Inspect listing" onClick={() => onSelect(n)}>
                <span className="place__num">{i + 1}</span>
                <span className="place__name">{s.title}</span>
              </button>
              <div className="place__rows">
                <Row label="Distance" value={p.distanceKm !== undefined ? `${p.distanceKm.toFixed(1)} km` : undefined} />
                <Row label="Listed as" value={p.cuisine ?? p.category} />
              </div>
              {caveat && <p className="place__caveat">{caveat}</p>}
              {sample && <p className="place__caveat">Placeholder — not a real business.</p>}
              {!sample && (
                <div className="place__actions" data-ui>
                  <button className="btn btn--small btn--primary" onClick={() => onPrepare(s, service ? "contact_provider" : "prepare_reservation")}>
                    {service ? "Prepare a request" : "Prepare booking request"}
                  </button>
                  <a className="btn btn--small" href={`https://www.openstreetmap.org/directions?to=${p.lat}%2C${p.lon}`} target="_blank" rel="noopener noreferrer">Directions</a>
                </div>
              )}
            </article>
          </Spot>
        );
      })}
    </>
  );
}
