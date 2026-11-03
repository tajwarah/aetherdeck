// Chrome extensions, Warpnaut's way. The puzzle on a window's bar opens the shelf: your extensions as a grid of glass
// tiles. A tile opens that extension's popup in a floating glass card beside the bar; its options open the same way,
// larger. The manager is a deck like the Agent Station's: what's installed, what each can see, and three ways to add
// one (the Chrome Web Store, a folder, another browser on this computer). Each addition is looked over before it's on.
import { useEffect, useRef, useState } from "react";
import { desktop } from "../lib/desktop.ts";
import { Glyph, GLYPHS, Sidebar, type SideSection } from "./Sidebar.tsx";

interface Ext {
  key: string; id: string | null; name: string; version: string; description: string; icon: string; on: boolean; from: "store" | "folder" | "browser";
  popup?: string; options?: string; permissions: string[]; hosts: string[]; unsupported: string[]; error?: string; token?: string;
}
interface Found { browser: string; id: string; name: string; icon: string; version: string }
type Ask = { action: "shelf"; x: number; y: number; wc?: number } | { action: "manage"; key?: string } | { action: "store"; id: string };

/** Opens the shelf (from a window's bar), the manager, or the manager's look at a Chrome Web Store extension. */
export const openExtensions = (ask: Ask) => document.dispatchEvent(new CustomEvent("warpnaut-extensions", { detail: ask }));
/** The extension a Chrome Web Store page is about, if this is one. */
export const storeIdIn = (url: string) => (/^https:\/\/chromewebstore\.google\.com\/detail\//.test(url) ? url.match(/\/([a-p]{32})(?:[/?#]|$)/)?.[1] ?? null : null);

const PUZZLE = "M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v4h-4v-2a2 2 0 1 0-4 0v2H6v-4h2a2 2 0 1 0 0-4H6V6h4Z";
export const PuzzleGlyph = () => <Glyph d={PUZZLE} size={15} />;

const SAYS: Record<string, string> = {
  storage: "Keep its own settings", tabs: "See the address and title of your tabs", activeTab: "Work on the page you're on, when you use it",
  scripting: "Run its own code in pages", webRequest: "See the requests pages make", clipboardWrite: "Copy to your clipboard", clipboardRead: "Read your clipboard",
  unlimitedStorage: "Keep a lot of data on this computer", webNavigation: "See where your tabs go", management: "See your other extensions", i18n: "Speak your language",
};
const reach = (hosts: string[]) => (hosts.some((h) => h === "<all_urls>" || /^\*:\/\/\*\//.test(h) || /^https?:\/\/\*\//.test(h)) ? "Every site you visit" : hosts.length ? hosts.slice(0, 4).join(", ") + (hosts.length > 4 ? ` and ${hosts.length - 4} more` : "") : "");

const Tile = ({ ext, size = 40 }: { ext: Pick<Ext, "icon" | "name">; size?: number }) => ext.icon
  ? <img className="xt__icon" src={ext.icon} alt="" width={size} height={size} />
  : <span className="xt__icon xt__icon--blank" style={{ width: size, height: size }}>{ext.name.slice(0, 1)}</span>;

export function ExtensionsHub({ onOpenUrl }: { onOpenUrl: (url: string) => void }) {
  const [list, setList] = useState<Ext[]>([]);
  const [found, setFound] = useState<Found[]>([]);
  const [shelf, setShelf] = useState<{ x: number; y: number } | null>(null);
  const [view, setView] = useState<{ ext: Ext; page: string; wide: boolean; x: number; y: number } | null>(null);
  const [deck, setDeck] = useState<{ key?: string; mode: "ext" | "store" | "folder" | "browser"; browser?: string } | null>(null);
  const refresh = () => void desktop?.invoke<{ installed: Ext[]; browsers: Found[] }>("ext:list").then((r) => { setList(r.installed); setFound(r.browsers); }).catch(() => undefined);
  const [storeAsk, setStoreAsk] = useState("");

  useEffect(() => {
    const on = (e: Event) => {
      const ask = (e as CustomEvent<Ask>).detail;
      refresh();
      if (ask.action === "shelf") { setShelf((s) => (s ? null : { x: ask.x, y: ask.y })); if (ask.wc !== undefined && ask.wc >= 0) void desktop?.invoke("ext:setActive", ask.wc); }
      if (ask.action === "manage") { setShelf(null); setDeck({ key: ask.key, mode: ask.key ? "ext" : "store" }); }
      if (ask.action === "store") { setShelf(null); setStoreAsk(ask.id); setDeck({ mode: "store" }); }
    };
    document.addEventListener("warpnaut-extensions", on);
    return () => document.removeEventListener("warpnaut-extensions", on);
  }, []);
  useEffect(() => {
    if (!shelf && !view) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); if (view) setView(null); else setShelf(null); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [shelf, view]);

  // A popup is as big as its page, the way Chrome sizes one: measured as it draws, within Chrome's own limits.
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  const popupRef = useRef<HTMLElement & { executeJavaScript(code: string): Promise<unknown> } | null>(null);
  useEffect(() => {
    setFit(null);
    const v = popupRef.current;
    if (!v || !view || view.wide) return;
    let n = 0;
    let timer = 0 as unknown as ReturnType<typeof setInterval>;
    const measure = () => void v.executeJavaScript("(() => { const b = document.body; if (!b) return [0, 0]; const s = getComputedStyle(b), r = b.getBoundingClientRect(); return [Math.ceil(r.width + parseFloat(s.marginLeft) + parseFloat(s.marginRight)), Math.ceil(Math.max(r.height, b.scrollHeight) + parseFloat(s.marginTop) + parseFloat(s.marginBottom))]; })()").then((r) => {
      const [w, h] = r as [number, number];
      if (w > 0 && h > 0) setFit({ w: Math.min(780, Math.max(220, w)), h: Math.min(600, Math.max(120, h)) });
    }).catch(() => undefined);
    const start = () => { measure(); timer = setInterval(() => { measure(); if (++n > 8) clearInterval(timer); }, 300); };
    v.addEventListener("dom-ready", start);
    return () => { v.removeEventListener("dom-ready", start); clearInterval(timer); };
  }, [view?.ext.key, view?.page]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!desktop) return null;
  const ready = list.filter((x) => x.on && x.id);
  const open = (ext: Ext, page: string, wide = false, at = shelf ?? { x: window.innerWidth - 420, y: 120 }) => { setShelf(null); setView({ ext, page, wide, x: at.x, y: at.y }); };

  return (
    <>
      {shelf && (
        <>
          <div className="xt__scrim" onPointerDown={() => setShelf(null)} />
          <div className="xt-shelf" role="dialog" aria-label="Extensions" style={{ left: Math.max(12, Math.min(window.innerWidth - 332, shelf.x - 160)), top: Math.min(window.innerHeight - 200, shelf.y + 8) }}>
            <header><span>Extensions</span><button className="xt__link" onClick={() => { setShelf(null); setDeck({ mode: ready.length ? "ext" : "store", key: ready[0]?.key }); }}>Manage</button></header>
            {ready.length ? (
              <div className="xt-shelf__grid">
                {ready.map((x) => (
                  <button key={x.key} className="xt-shelf__tile" title={x.description || x.name}
                    onClick={() => (x.popup ? open(x, x.popup) : x.options ? open(x, x.options, true) : setDeck({ mode: "ext", key: x.key }))}>
                    <Tile ext={x} /><span>{x.name}</span>{!x.popup && !x.options && <small>Runs on pages</small>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="xt-shelf__empty">
                <p>No extensions yet. Add one from the Chrome Web Store, a folder, or another browser on this computer.</p>
                <button className="btn btn--primary" onClick={() => { setShelf(null); setDeck({ mode: "store" }); }}>Add an extension</button>
              </div>
            )}
          </div>
        </>
      )}
      {view && view.ext.id && (
        <div className={`xt-view ${view.wide ? "is-wide" : ""}`} role="dialog" aria-label={view.ext.name}
          style={{ ...(fit && !view.wide ? { width: fit.w + 12, height: fit.h + 50 } : {}), left: Math.max(12, Math.min(window.innerWidth - (view.wide ? 772 : (fit?.w ?? 380) + 12), view.x - (view.wide ? 380 : 190))), top: Math.max(12, Math.min(window.innerHeight - (view.wide ? 640 : (fit?.h ?? 540) + 60), view.y + 8)) }}>
          <header className="xt-view__bar">
            <Tile ext={view.ext} size={22} />
            <b>{view.ext.name}</b>
            {view.ext.options && view.page !== view.ext.options && <button className="xt__link" onClick={() => setView({ ...view, page: view.ext.options!, wide: true })}>Options</button>}
            <button className="xt__x" aria-label={`Close ${view.ext.name}`} onClick={() => setView(null)}>×</button>
          </header>
          <webview key={view.page} ref={popupRef} className="xt-view__page" src={`chrome-extension://${view.ext.id}/${view.page}`} partition="persist:web" />
        </div>
      )}
      {deck && <Manager deck={deck} setDeck={setDeck} list={list} setList={setList} found={found} storeAsk={storeAsk} onClose={() => setDeck(null)}
        onOpen={(x, page, wide) => open(x, page, wide, { x: window.innerWidth / 2, y: 120 })} onOpenUrl={onOpenUrl} />}
    </>
  );
}

function Manager({ deck, setDeck, list, setList, found, storeAsk, onClose, onOpen, onOpenUrl }: {
  deck: { key?: string; mode: "ext" | "store" | "folder" | "browser"; browser?: string }; setDeck: (d: typeof deck | null) => void;
  list: Ext[]; setList: (l: Ext[]) => void; found: Found[]; storeAsk: string; onClose: () => void; onOpen: (x: Ext, page: string, wide: boolean) => void; onOpenUrl: (url: string) => void;
}) {
  const [folded, setFolded] = useState(false);
  const [wide, setWide] = useState(false);
  const [find, setFind] = useState("");
  const [link, setLink] = useState(storeAsk);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Ext | null>(null);
  useEffect(() => { if (storeAsk) { setLink(storeAsk); void look("ext:fromStore", storeAsk); } }, [storeAsk]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);

  async function look(channel: string, arg?: string) {
    setError(""); setPreview(null); setBusy(channel === "ext:fromStore" ? "Getting it from the Chrome Web Store…" : "Reading the extension…");
    try { const p = await desktop!.invoke<Ext | null>(channel, arg); if (p) setPreview(p); } catch (e) { setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); }
    setBusy("");
  }
  async function act(channel: string, ...args: unknown[]) {
    setError("");
    try { const l = await desktop!.invoke<Ext[]>(channel, ...args); setList(l); return l; } catch (e) { setError(String((e as Error).message ?? e)); return null; }
  }
  const add = async () => {
    if (!preview?.token) return;
    const l = await act("ext:add", preview.token);
    setPreview(null);
    const added = l?.[l.length - 1];
    if (added) setDeck({ mode: "ext", key: added.key });
  };
  const cancel = () => { if (preview?.token) void desktop!.invoke("ext:cancel", preview.token); setPreview(null); };

  const match = (t: string) => !find.trim() || t.toLowerCase().includes(find.trim().toLowerCase());
  const browsers = [...new Set(found.map((f) => f.browser))];
  const sections: SideSection[] = [
    { label: "Installed", items: list.filter((x) => match(x.name)).map((x) => ({ id: x.key, label: x.name, on: deck.mode === "ext" && deck.key === x.key, icon: <Tile ext={x} size={22} />,
      badge: x.error ? "!" : x.on ? undefined : "Off", hint: x.description, onClick: () => { cancel(); setDeck({ mode: "ext", key: x.key }); } })) },
    { label: "Add", items: [
      { id: "store", label: "Chrome Web Store", icon: <Glyph d={GLYPHS.star} />, on: deck.mode === "store", onClick: () => { cancel(); setDeck({ mode: "store" }); } },
      { id: "folder", label: "From a folder", icon: <Glyph d={GLYPHS.layers} />, on: deck.mode === "folder", onClick: () => { cancel(); setDeck({ mode: "folder" }); } },
      ...browsers.map((b) => ({ id: `b-${b}`, label: `From ${b}`, icon: <Glyph d={GLYPHS.app} />, badge: found.filter((f) => f.browser === b).length, on: deck.mode === "browser" && deck.browser === b, onClick: () => { cancel(); setDeck({ mode: "browser", browser: b }); } })),
    ] },
    { label: "General", items: [{ id: "close", label: "Close", icon: <Glyph d={GLYPHS.out} />, act: true, onClick: onClose }] },
  ];
  const picked = deck.mode === "ext" ? list.find((x) => x.key === deck.key) : undefined;

  return (
    <aside className={`deck xt-deck ${wide ? "is-wide" : ""}`} role="dialog" aria-label="Extensions" data-ui>
      <Sidebar title="Extensions" alerts={list.filter((x) => x.error).length} collapsed={folded} onCollapse={setFolded} onClose={onClose} onWide={() => setWide((w) => !w)}
        who={{ icon: <PuzzleGlyph />, name: "Chrome extensions", detail: list.length ? `${list.filter((x) => x.on).length} on of ${list.length}` : "None added yet" }}
        search={{ value: find, placeholder: "Search extensions", onChange: setFind }} sections={sections} />
      <div className="deck__main xt-main">
        {error && <p className="agents__error" role="alert">{error}</p>}
        {busy && <p className="xt__busy" role="status">{busy}</p>}
        {preview ? (
          <Detail ext={preview} preview onAdd={() => void add()} onCancel={cancel} />
        ) : deck.mode === "ext" && picked ? (
          <Detail ext={picked} onToggle={(on) => void act("ext:toggle", picked.key, on)} onRemove={() => { if (confirm(`Remove ${picked.name}? Its settings go with it.`)) void act("ext:remove", picked.key).then(() => setDeck({ mode: "store" })); }}
            onOpen={(page, w) => onOpen(picked, page, w)} />
        ) : deck.mode === "store" ? (
          <section className="xt-card">
            <h2>From the Chrome Web Store</h2>
            <p>Paste an extension's link from the Chrome Web Store, or its id. Or open the store in a tab: on an extension's page, the address bar shows <b>Add to Warpnaut</b>.</p>
            <form className="xt-row" onSubmit={(e) => { e.preventDefault(); void look("ext:fromStore", link); }}>
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://chromewebstore.google.com/detail/…" aria-label="Chrome Web Store link or id" data-keys />
              <button className="deck__btn deck__btn--go" disabled={!link.trim() || !!busy}>Look it up</button>
            </form>
            <button className="deck__btn" onClick={() => { onClose(); onOpenUrl("https://chromewebstore.google.com/category/extensions"); }}>Open the Chrome Web Store</button>
            <p className="fine">Warpnaut runs most extensions that work on pages: readers, translators, password managers, dark modes. Ones built on Chrome's own menus, notifications or ad-blocking rules may only partly work; each one says so before you add it. Extensions don't run in private windows.</p>
          </section>
        ) : deck.mode === "folder" ? (
          <section className="xt-card">
            <h2>From a folder</h2>
            <p>An unpacked extension: a folder with a <code>manifest.json</code>, such as one you're building. Warpnaut keeps its own copy.</p>
            <button className="deck__btn deck__btn--go" disabled={!!busy} onClick={() => void look("ext:fromFolder")}>Choose a folder…</button>
          </section>
        ) : deck.mode === "browser" ? (
          <section className="xt-card">
            <h2>From {deck.browser}</h2>
            <p>Extensions already installed in {deck.browser} on this computer. Warpnaut copies the one you choose; {deck.browser} keeps its own.</p>
            <div className="xt-found">
              {found.filter((f) => f.browser === deck.browser).map((f) => {
                const have = list.some((x) => x.key === f.id);
                return (
                  <button key={f.id} className="xt-found__item" disabled={have || !!busy} onClick={() => void look("ext:fromBrowser", f.id)}>
                    <Tile ext={f} size={34} /><span><b>{f.name}</b><small>{have ? "Already added" : `Version ${f.version}`}</small></span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : <section className="xt-card"><p>Choose an extension, or add one.</p></section>}
      </div>
    </aside>
  );
}

function Detail({ ext, preview, onAdd, onCancel, onToggle, onRemove, onOpen }: {
  ext: Ext; preview?: boolean; onAdd?: () => void; onCancel?: () => void; onToggle?: (on: boolean) => void; onRemove?: () => void; onOpen?: (page: string, wide: boolean) => void;
}) {
  const where = reach(ext.hosts);
  return (
    <section className="xt-card xt-detail">
      <header className="xt-detail__head">
        <Tile ext={ext} size={64} />
        <div>
          <h2>{ext.name}</h2>
          <p>Version {ext.version} · {ext.from === "store" ? "Chrome Web Store" : ext.from === "folder" ? "From a folder" : "From another browser"}</p>
        </div>
        {!preview && onToggle && (
          <button className={`xt-switch ${ext.on ? "is-on" : ""}`} role="switch" aria-checked={ext.on} aria-label={ext.on ? "Turn off" : "Turn on"} onClick={() => onToggle(!ext.on)}><i /></button>
        )}
      </header>
      {ext.description && <p className="xt-detail__about">{ext.description}</p>}
      {ext.error && <p className="agents__error">It didn't load: {ext.error}</p>}
      <div className="xt-perms">
        <h3>{preview ? "If you add it, it can" : "It can"}</h3>
        <ul>
          {where && <li><b>Read and change</b> {where}</li>}
          {ext.permissions.filter((p) => !ext.unsupported.includes(p)).map((p) => <li key={p}>{SAYS[p] ?? p}</li>)}
          {!where && !ext.permissions.length && <li>Nothing beyond its own pages</li>}
        </ul>
        {ext.unsupported.length > 0 && <p className="xt-warn">May only partly work here: it uses {ext.unsupported.join(", ")}, which Warpnaut doesn't have.</p>}
      </div>
      <div className="xt-row">
        {preview ? (
          <>
            <button className="deck__btn deck__btn--go" onClick={onAdd}>Add to Warpnaut</button>
            <button className="deck__btn" onClick={onCancel}>Cancel</button>
          </>
        ) : (
          <>
            {ext.popup && ext.on && ext.id && <button className="deck__btn deck__btn--go" onClick={() => onOpen?.(ext.popup!, false)}>Open</button>}
            {ext.options && ext.on && ext.id && <button className="deck__btn" onClick={() => onOpen?.(ext.options!, true)}>Options</button>}
            <button className="deck__btn deck__btn--danger" onClick={onRemove}>Remove</button>
          </>
        )}
      </div>
    </section>
  );
}
