// Pure rules behind the Panes page (chromium/panes.html): what may be shown in a frame, the one narrow header-removal
// rule a pane may ask for, the sites that go straight to a real window, and where that window is placed. No chrome.* calls
// here, so every decision can be unit-tested (tests/unit/panes.test.ts).

export const MAX_PANES = 4;

/** Session rule ids 5000..5999 belong to panes (the cookie test uses 4242). One rule per pane: 5000 + pane id. */
export const RULE_BASE = 5000;
export const RULE_SPAN = 1000;

/**
 * Domains that never get a header-removal rule, subdomains included. Google's mail and sign-in pages refuse framing on
 * purpose to stop clickjacking and phishing; the owner's test showed removal does not even work there, and we do not try.
 * Plain youtube.com pages are NOT here (the cookie test showed they load signed in), but their sign-in host is.
 */
export const NEVER_STRIP = ["google.com", "gmail.com", "googlemail.com", "accounts.youtube.com"];

/** Sites that go straight to a real window without trying a frame (Google mail and account pages). */
export const TILE_FIRST = ["mail.google.com", "accounts.google.com", "myaccount.google.com", "gmail.com", "googlemail.com", "accounts.youtube.com"];

export interface PaneState {
  id: number;
  /** "" for an empty pane. */
  url: string;
  /** The user pressed "Allow framing" for this site: the pane's rule is on while the page is open. */
  strip: boolean;
}

export interface Rect { left: number; top: number; width: number; height: number }

export const hostMatches = (host: string, domain: string) => host === domain || host.endsWith("." + domain);

/** "pinterest.com" → "https://pinterest.com/". Only http(s), no embedded passwords, null for anything else. */
export function normalizeUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : /^[^\s/]+\.[^\s/]+|^localhost\b/i.test(text) ? "https://" + text : "";
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password || !u.hostname) return null;
    return u.href;
  } catch { return null; }
}

export const hostOf = (url: string): string => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };

/** True when no rule may ever be built for this host. */
export const neverStrip = (host: string) => NEVER_STRIP.some((d) => hostMatches(host.toLowerCase(), d));

/** True when this host skips the frame and opens as a window: the built-in list plus the sites the user marked. */
export function tileFirst(host: string, extra: readonly string[] = []): boolean {
  const h = host.toLowerCase();
  return [...TILE_FIRST, ...extra.map((x) => x.toLowerCase())].some((d) => hostMatches(h, d));
}

export const ruleIdFor = (paneId: number) => RULE_BASE + paneId;
export const isPaneRuleId = (id: number) => id >= RULE_BASE && id < RULE_BASE + RULE_SPAN;

/** The host permission to ask the browser for: exactly this host (not its subdomains), either scheme. */
export const permissionPattern = (host: string) => `*://${host.toLowerCase()}/*`;

export interface PaneRule {
  id: number;
  priority: number;
  condition: { requestDomains: string[]; excludedRequestDomains?: string[]; resourceTypes: ["sub_frame"]; tabIds: number[] };
  action: { type: "modifyHeaders"; responseHeaders: { header: string; operation: "remove" }[] };
}

/**
 * The only rule a pane can have: remove the two framing blocks (X-Frame-Options, Content-Security-Policy) from the
 * responses of frames, in the Panes tab, for the pane's own site. Returns null for a host that must never get one.
 * Sign-in hosts under the site (accounts.youtube.com) are excluded even when the site itself is allowed.
 */
export function buildRule(paneId: number, host: string, tabId: number): PaneRule | null {
  const h = host.toLowerCase();
  if (!h || neverStrip(h) || !Number.isInteger(tabId) || tabId < 0 || !Number.isInteger(paneId) || paneId < 0 || paneId >= RULE_SPAN) return null;
  const excluded = NEVER_STRIP.filter((d) => hostMatches(d, h));
  return {
    id: ruleIdFor(paneId),
    priority: 1,
    condition: { requestDomains: [h], ...(excluded.length ? { excludedRequestDomains: excluded } : {}), resourceTypes: ["sub_frame"], tabIds: [tabId] },
    action: { type: "modifyHeaders", responseHeaders: [{ header: "x-frame-options", operation: "remove" }, { header: "content-security-policy", operation: "remove" }] },
  };
}

/** Columns for n panes: a row for up to three, two by two for four. */
export const gridCols = (n: number) => (n <= 3 ? Math.max(1, n) : 2);

export const nextPaneId = (panes: readonly PaneState[]) => { let id = 1; while (panes.some((p) => p.id === id)) id++; return id; };

export function addPane(panes: readonly PaneState[], url = ""): PaneState[] {
  if (panes.length >= MAX_PANES) return [...panes];
  return [...panes, { id: nextPaneId(panes), url, strip: false }];
}
export const removePane = (panes: readonly PaneState[], id: number): PaneState[] => panes.filter((p) => p.id !== id);

export interface WindowGeometry { screenX: number; screenY: number; outerWidth: number; outerHeight: number; innerWidth: number; innerHeight: number }

/**
 * Where a real window goes so it sits over a pane's slot: the slot is measured inside the page, so add the page's
 * position on the screen and the browser's own toolbar above it. Approximate: a popup has a title bar of its own.
 */
export function tileBounds(slot: Rect, win: WindowGeometry): Rect {
  const side = Math.max(0, (win.outerWidth - win.innerWidth) / 2);
  const top = Math.max(0, win.outerHeight - win.innerHeight - side);
  return {
    left: Math.round(win.screenX + side + slot.left),
    top: Math.round(win.screenY + top + slot.top),
    width: Math.max(240, Math.round(slot.width)),
    height: Math.max(180, Math.round(slot.height)),
  };
}
