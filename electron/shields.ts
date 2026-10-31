// Shields: the protection every page runs behind. Ads, trackers and known malware addresses are blocked with
// Ghostery's open-source engine (MPL-2.0) and the community lists it reads; pages move to https; tracking tags
// come off links; sites are told not to sell or share data (Global Privacy Control); WebRTC can't leak a local
// address. Lists are kept on this computer and refreshed weekly, so protection starts instantly and works offline.
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ElectronBlocker, fromElectronDetails } from "@ghostery/adblocker-electron";
import type { Session, WebContents } from "electron";
import { httpsFor, siteOf, withoutTrackers } from "../shared/shields.ts";

const WEEK = 7 * 24 * 3600 * 1000;
const MALWARE = "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt";
/** Sign-in pages are left exactly as they are. */
const NEVER = /(^|\.)(accounts\.google\.com|appleid\.apple\.com|login\.microsoftonline\.com)$/;

export interface ShieldStatus { on: boolean; ready: boolean; blocked: number; allowed: string[] }

export function shields(deps: { dir: string; enabled: () => boolean; allowed: () => string[]; setAllowed: (sites: string[]) => void; report: (p: { wc: number; blocked: number }) => void }) {
  let blocker: ElectronBlocker | null = null;
  let total = 0;
  const perPage = new Map<number, number>();
  const noHttps = new Set<string>(); // sites where the https attempt failed
  const upgraded = new Set<string>(); // addresses moved to https, waiting to see if they load

  async function load() {
    const file = join(deps.dir, "shields.bin");
    const fresh = await stat(file).then((s) => Date.now() - s.mtimeMs < WEEK).catch(() => false);
    if (fresh) {
      try { blocker = ElectronBlocker.deserialize(new Uint8Array(await readFile(file))); return; } catch { /* rebuilt below */ }
    }
    try {
      const [ads, malware] = await Promise.all([
        ElectronBlocker.fromPrebuiltAdsAndTracking(fetch),
        ElectronBlocker.fromLists(fetch, [MALWARE], { loadCosmeticFilters: false }).catch(() => null),
      ]);
      blocker = malware ? ElectronBlocker.merge([ads, malware]) : ads;
      await writeFile(file, blocker.serialize());
    } catch {
      // Offline: last week's lists are still better than none.
      try { blocker = ElectronBlocker.deserialize(new Uint8Array(await readFile(file))); } catch { /* tried again next start */ }
    }
  }

  const isOff = (url: string) => !deps.enabled() || deps.allowed().includes(siteOf(url));

  function attach(s: Session) {
    s.webRequest.onBeforeRequest((details, callback) => {
      const page = details.resourceType === "mainFrame";
      if (page) { perPage.set(details.webContentsId ?? -1, 0); }
      const from = page ? details.url : details.frame?.url || details.webContents?.getURL() || details.url;
      if (!/^https?:/.test(details.url) || NEVER.test(new URL(details.url).hostname) || isOff(from)) return callback({});
      if (page) {
        const https = httpsFor(details.url, noHttps);
        if (https) { upgraded.add(https); return callback({ redirectURL: https }); }
        const clean = withoutTrackers(details.url);
        if (clean !== details.url && details.method === "GET") return callback({ redirectURL: clean });
      }
      if (blocker) {
        const { match } = blocker.match(fromElectronDetails(details));
        if (match) {
          total++;
          const wc = details.webContentsId ?? -1;
          const n = (perPage.get(wc) ?? 0) + 1;
          perPage.set(wc, n);
          deps.report({ wc, blocked: n });
          return callback({ cancel: true });
        }
      }
      callback({});
    });
    s.webRequest.onErrorOccurred((details) => {
      // https didn't work here: the next try uses the address the person asked for.
      if (!upgraded.delete(details.url) || details.resourceType !== "mainFrame" || details.error === "net::ERR_ABORTED") return;
      noHttps.add(new URL(details.url).hostname);
    });
    s.webRequest.onCompleted((details) => { upgraded.delete(details.url); });
    s.webRequest.onBeforeSendHeaders((details, callback) => {
      if (!deps.enabled()) return callback({});
      callback({ requestHeaders: { ...details.requestHeaders, "Sec-GPC": "1" } });
    });
  }

  return {
    load,
    attach,
    guard: (wc: WebContents) => wc.setWebRTCIPHandlingPolicy("default_public_interface_only"),
    status: (): ShieldStatus => ({ on: deps.enabled(), ready: !!blocker, blocked: total, allowed: deps.allowed() }),
    toggleSite(url: string) {
      const site = siteOf(url);
      const now = deps.allowed();
      deps.setAllowed(now.includes(site) ? now.filter((s) => s !== site) : [...now, site]);
      return !now.includes(site);
    },
  };
}
