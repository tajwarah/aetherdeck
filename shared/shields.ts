// The parts of Shields that decide what happens to an address, with no browser around them.

/** Tracking tags sites and ad networks add to links. Removing them changes nothing about the page. */
const TRACKERS = /^(utm_[a-z_]+|gclid|gclsrc|dclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|igshid|igsh|twclid|ttclid|yclid|_hsenc|_hsmi|vero_id|oly_anon_id|oly_enc_id|mkt_tok)$/i;

export function withoutTrackers(url: string): string {
  try {
    const u = new URL(url);
    let changed = false;
    for (const k of [...u.searchParams.keys()]) if (TRACKERS.test(k)) { u.searchParams.delete(k); changed = true; }
    return changed ? u.toString() : url;
  } catch { return url; }
}

const LOCAL = /^(localhost|.*\.localhost|.*\.local|.*\.test|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[.*\])$/i;

/** The https address to try for a plain http page; null for local addresses and sites known not to offer it. */
export function httpsFor(url: string, noHttps: ReadonlySet<string>): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" || LOCAL.test(u.hostname) || noHttps.has(u.hostname)) return null;
    u.protocol = "https:";
    return u.toString();
  } catch { return null; }
}

export const siteOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
