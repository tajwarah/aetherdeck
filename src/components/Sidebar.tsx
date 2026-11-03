// The sidebar the Agent Station and the Research board share: a pane of dark glass with the window's three lights,
// a title with its alerts, who or what it belongs to, a search, then sections of items, the chosen one lit. It folds
// to a rail of icons and back.
import type { ReactNode } from "react";

export interface SideItem {
  id: string;
  label: string;
  icon: ReactNode;
  /** A small count or mark at the end of the row. */
  badge?: string | number;
  hint?: string;
  on?: boolean;
  /** A quieter row that does something (a setting, a way out) rather than showing something. */
  act?: boolean;
  onClick: () => void;
}
export interface SideSection { label: string; items: SideItem[] }

interface Props {
  title: string;
  /** How many things are waiting on the person: the bell's badge. */
  alerts?: number;
  onAlerts?: () => void;
  who?: { icon: ReactNode; name: string; detail: string; onClick?: () => void };
  search?: { value: string; placeholder: string; onChange: (v: string) => void };
  sections: SideSection[];
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  onClose: () => void;
  onWide?: () => void;
}

export const Glyph = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
export const GLYPHS = {
  home: "M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1Z",
  plus: "M12 5v14M5 12h14",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.8-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.8H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.8-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.8 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.8H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  out: "M10 17l-5-5 5-5M5 12h11M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4",
  app: "M4 5h16v14H4ZM4 9h16",
  layers: "M8 4h12v12H8ZM4 8v12h12",
  star: "M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.2 7 19l1.2-5.6L4 9.6 9.6 9Z",
  trash: "M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  pin: "M9 4h6l-1 6 3 3H7l3-3-1-6ZM12 13v7",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4ZM10 20a2 2 0 0 0 4 0",
};

export function Sidebar({ title, alerts = 0, onAlerts, who, search, sections, collapsed, onCollapse, onClose, onWide }: Props) {
  return (
    <nav className={`side ${collapsed ? "is-collapsed" : ""}`} aria-label={title}>
      <div className="side__lights">
        <button className="side__light side__light--close" aria-label={`Close the ${title.toLowerCase()}`} title="Close" onClick={onClose} />
        <button className="side__light side__light--fold" aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"} title={collapsed ? "Expand" : "Collapse"} onClick={() => onCollapse(!collapsed)} />
        <button className="side__light side__light--wide" aria-label="Fill the window" title="Fill the window" onClick={onWide} disabled={!onWide} />
        <button className="side__fold" aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"} onClick={() => onCollapse(!collapsed)}>
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d={collapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} /></svg>
          <span>{collapsed ? "Expand" : "Collapse"}</span>
        </button>
      </div>
      <header className="side__head">
        <h2>{title}</h2>
        <button className="side__bell" aria-label={alerts ? `${alerts} waiting on you` : "Nothing waiting on you"} title={alerts ? `${alerts} waiting on you` : "Nothing waiting"} onClick={onAlerts}>
          <Glyph d={GLYPHS.bell} />
          {alerts > 0 && <span className="side__count">{alerts}</span>}
        </button>
      </header>
      {who && (
        <button className="side__who" onClick={who.onClick} disabled={!who.onClick} title={who.name}>
          <span className="side__whoicon">{who.icon}</span>
          <span className="side__whotext"><b>{who.name}</b><small>{who.detail}</small></span>
          {who.onClick && <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>}
        </button>
      )}
      {search && (
        <label className="side__search">
          <Glyph d={GLYPHS.search} size={15} />
          <input value={search.value} onChange={(e) => search.onChange(e.target.value)} placeholder={search.placeholder} aria-label={search.placeholder} data-keys />
        </label>
      )}
      <div className="side__scroll">
        {sections.filter((s) => s.items.length).map((s) => (
          <section key={s.label} className="side__section">
            <h3>{s.label}</h3>
            <ul>
              {s.items.map((it) => (
                <li key={it.id}>
                  <button className={`side__item ${it.on ? "is-on" : ""} ${it.act ? "is-act" : ""}`} aria-current={it.on || undefined} title={collapsed ? it.label : it.hint} onClick={it.onClick}>
                    <span className="side__icon">{it.icon}</span>
                    <span className="side__label">{it.label}</span>
                    {it.badge !== undefined && it.badge !== 0 && it.badge !== "" && <span className="side__badge">{it.badge}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}
