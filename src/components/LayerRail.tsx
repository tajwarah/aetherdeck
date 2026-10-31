// "Go deeper" (panel 06): the layers a place can be seen through. Every layer is drawn, available or not,
// so what open data cannot provide stays visible as an absence instead of quietly disappearing.
import type { SearchResult } from "../../shared/types.ts";

export interface Layer { id: string; label: string; available: boolean; note: string; onOpen?: () => void }

export function layersFor(source: SearchResult, onBook: () => void): Layer[] {
  const p = source.place;
  const sample = source.freshnessStatus === "sample";
  return [
    { id: "place", label: "Place", available: true, note: p?.address ? "address listed" : "from OpenStreetMap" },
    { id: "reviews", label: "Reviews", available: false, note: "not in open data" },
    { id: "menus", label: "Menus", available: false, note: p?.website ? "check the website" : "not in open data" },
    { id: "photos", label: "Photos", available: !!source.thumbnail, note: source.thumbnail ? "from the source" : "none published" },
    { id: "booking", label: "Booking", available: !sample && !!(p?.phone || p?.email || p?.website), note: sample ? "sample listing" : p?.phone || p?.email || p?.website ? "prepare a request" : "no contact listed", onOpen: !sample ? onBook : undefined },
    { id: "live", label: "Live availability", available: false, note: p?.openingHours ? "hours listed, not live" : "not in open data" },
  ];
}

export function LayerRail({ layers }: { layers: Layer[] }) {
  return (
    <ul className="layers" aria-label="Layers">
      {layers.map((l) => (
        <li key={l.id} className={`layer ${l.available ? "is-on" : "is-off"}`}>
          <span className="layer__dot" aria-hidden="true" />
          {l.onOpen ? <button className="layer__label link" onClick={l.onOpen}>{l.label}</button> : <span className="layer__label">{l.label}</span>}
          <span className="layer__note">{l.note}</span>
        </li>
      ))}
    </ul>
  );
}
