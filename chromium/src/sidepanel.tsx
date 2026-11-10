// The Sidekick's side panel: Cosmonaut (the same Assistant component as the desktop app) answering about the page in
// the browser tab beside it. The page is read here, on this computer; its text goes to the AI model only with a question.
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Assistant, materials } from "../../src/components/Assistant.tsx";
import { installExtensionFetch, sidekickSettings } from "../../src/lib/extensionBridge.ts";
import type { Tab } from "../../src/lib/windows.ts";
import "../../src/styles.css";
import "./sidepanel.css";

installExtensionFetch(); // "/api/…" goes to the AetherDeck server, with the token, from here on

interface ChromeTab { id?: number }
interface Chrome {
  tabs: { query(q: object): Promise<ChromeTab[]>; onActivated: Ev<() => void>; onUpdated: Ev<(id: number, change: { status?: string }) => void>; create(p: { url: string }): Promise<unknown> };
  scripting: { executeScript(o: { target: { tabId: number }; func: () => unknown }): Promise<{ result?: unknown }[]> };
  permissions: { request(p: { origins: string[] }): Promise<boolean>; contains(p: { origins: string[] }): Promise<boolean> };
  runtime: { openOptionsPage(): Promise<void> };
}
interface Ev<F> { addListener(fn: F): void; removeListener(fn: F): void }
const chrome = (globalThis as unknown as { chrome: Chrome }).chrome;

const KEY = "sidekick";
const TAB: Tab = { id: KEY, kind: "assistant", src: KEY, href: "", title: "Cosmonaut", domain: "" };
const ALL_PAGES = ["http://*/*", "https://*/*"];

/** Runs inside the page: its visible text and address. */
function pageText() {
  return { url: location.href, title: document.title || location.hostname, text: String(document.body ? document.body.innerText : "").slice(0, 400_000) };
}

type Link = { state: "checking" } | { state: "offline"; server: string } | { state: "token" } | { state: "ok"; model: string | null; vision: boolean };

async function checkServer(): Promise<Link> {
  const { server } = await sidekickSettings();
  try {
    const res = await fetch("/api/health");
    if (res.status === 403) return { state: "token" };
    if (!res.ok) return { state: "offline", server };
    const h = await res.json() as { model?: { label: string } | null; vision?: boolean };
    return { state: "ok", model: h.model?.label ?? null, vision: Boolean(h.vision) };
  } catch {
    return { state: "offline", server };
  }
}

function Sidekick() {
  const [link, setLink] = useState<Link>({ state: "checking" });
  const [pageKey, setPageKey] = useState("");
  const [canReadAll, setCanReadAll] = useState(true);

  const read = useCallback(async () => {
    materials.set(KEY, { kind: "loading", name: "Reading this page" });
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id === undefined) throw new Error("No page to read.");
      const [out] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageText });
      const p = out?.result as { url: string; title: string; text: string } | undefined;
      if (!p) throw new Error("The page gave no text.");
      materials.set(KEY, { kind: "page", name: p.title, url: p.url, text: p.text });
      setPageKey(p.url);
    } catch {
      materials.set(KEY, { kind: "error", name: "This page can't be read", message: "Browser pages, the extension store and PDFs in the browser's viewer are off limits. On other pages, allow reading below." });
      setPageKey("none:" + Date.now());
    }
    setCanReadAll(await chrome.permissions.contains({ origins: ALL_PAGES }));
  }, []);

  useEffect(() => {
    void checkServer().then(setLink);
    void read();
    // Switching tabs or loading a new page reads the new page (only while this panel is open).
    const again = () => void read();
    const updated = (_id: number, change: { status?: string }) => { if (change.status === "complete") again(); };
    chrome.tabs.onActivated.addListener(again);
    chrome.tabs.onUpdated.addListener(updated);
    return () => { chrome.tabs.onActivated.removeListener(again); chrome.tabs.onUpdated.removeListener(updated); };
  }, [read]);

  async function allowAll() {
    if (await chrome.permissions.request({ origins: ALL_PAGES })) { setCanReadAll(true); void read(); }
  }

  if (link.state === "checking") return <p className="sk__note">Connecting to AetherDeck…</p>;
  if (link.state === "offline") return (
    <div className="sk__note">
      <p><strong>AetherDeck isn't running.</strong> Nothing could be reached at {link.server}.</p>
      <p>In the AetherDeck folder run <code>npm run build &amp;&amp; npm start</code>, then reopen this panel.</p>
      <button className="btn btn--small" onClick={() => void chrome.runtime.openOptionsPage()}>Server settings</button>
    </div>
  );
  if (link.state === "token") return (
    <div className="sk__note">
      <p><strong>The server didn't accept this extension.</strong> Paste the extension token it keeps in <code>extension-token</code> (in its data folder) into the options.</p>
      <button className="btn btn--small btn--primary" onClick={() => void chrome.runtime.openOptionsPage()}>Open options</button>
    </div>
  );
  return (
    <>
      <Assistant key={pageKey} tab={TAB} model={link.model} vision={link.vision} onConnect={() => void chrome.runtime.openOptionsPage()} onAttach={() => undefined} />
      <div className="sk__foot">
        {!canReadAll && <button className="btn btn--small" onClick={() => void allowAll()}>Allow reading pages as I browse</button>}
        <button className="btn btn--small" onClick={() => void read()}>Read this page again</button>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Sidekick /></StrictMode>);
