// Places on the web. The most used sit in the dock; the grid button there opens all of them.
// Each one opens in a floating window. Only sites that allow being shown inside other apps are here;
// YouTube's own pages refuse, so its icon starts a video search instead.
import type { ReactNode } from "react";

export interface Place { id: string; label: string; url?: string; compose?: string; glyph: ReactNode }

const svg = (d: ReactNode) => <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;

export const PLACES: Place[] = [
  { id: "search", label: "Search", compose: "", glyph: svg(<><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></>) },
  { id: "wikipedia", label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Main_Page", glyph: <span className="place-icon__w">W</span> },
  { id: "random", label: "Surprise me", url: "https://en.wikipedia.org/wiki/Special:Random", glyph: svg(<><path d="M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3" /><path d="m18 5 2 2-2 2M18 15l2 2-2 2" /></>) },
  { id: "map", label: "World map", url: "https://www.openstreetmap.org/export/embed.html?bbox=-170%2C-60%2C190%2C75&layer=mapnik", glyph: svg(<><path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10Z" /><circle cx="12" cy="11" r="2.2" /></>) },
  { id: "earth", label: "Live winds", url: "https://earth.nullschool.net/", glyph: svg(<><circle cx="12" cy="12" r="8" /><path d="M5 10c3 1 5-1 7 0s3 3 7 2M6 15c2-1 4 1 6 0s4-2 6-1" /></>) },
  { id: "radio", label: "Radio Garden", url: "https://radio.garden/", glyph: svg(<><circle cx="12" cy="12" r="2" /><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8" /></>) },
  { id: "youtube", label: "YouTube", compose: "play ", glyph: svg(<><rect x="3" y="6" width="18" height="12" rx="4" /><path d="m10.5 9.5 4 2.5-4 2.5Z" fill="currentColor" /></>) },
  { id: "archive", label: "Archive", url: "https://archive.org/", glyph: svg(<><path d="M4 8h16M5 8v10h14V8M3 5h18v3H3zM10 12h4" /></>) },
  { id: "commons", label: "Images", url: "https://commons.wikimedia.org/wiki/Main_Page", glyph: svg(<><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4 4 3 3-2 4 3" /></>) },
  { id: "books", label: "Books", url: "https://www.gutenberg.org/", glyph: svg(<><path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5v-14Z" /><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" /></>) },
];

/** All places: a glass panel that rises from the dock's grid button. */
export function PlacesGrid({ onPick, onClose }: { onPick: (p: Place, at: { x: number; y: number }) => void; onClose: () => void }) {
  return (
    <nav className="places" aria-label="All places" data-ui onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      {PLACES.map((p, i) => (
        <button key={p.id} className="places__item" autoFocus={i === 0} style={{ animationDelay: `${i * 18}ms` }}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onPick(p, { x: r.left + r.width / 2, y: r.top + r.height / 2 }); }}>
          <span className="places__disc">{p.glyph}</span>
          <span className="places__label">{p.label}</span>
        </button>
      ))}
    </nav>
  );
}
