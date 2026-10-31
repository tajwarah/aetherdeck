// Wikipedia "Current events" portal — a keyless, editor-curated daily log of news where every item
// links to the original reporting. We read the last few daily pages and keep items about the topic.
import { z } from "zod/v4";
import type { Provider } from "./types.ts";
import type { SearchResult } from "../../shared/types.ts";
import { fetchJson, stableId, domainOf, decodeEntities } from "../http.ts";

const Parse = z.object({ parse: z.object({ text: z.string() }).optional() });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function pageTitleFor(d: Date) {
  return `Portal:Current_events/${d.getUTCFullYear()}_${MONTHS[d.getUTCMonth()]}_${d.getUTCDate()}`;
}

/** Leaf list items (no nested lists) that cite at least one external source. */
export function parseDay(html: string, isoDate: string, topicTerms: string[], retrievedAt: string) {
  const items = [...html.matchAll(/<li>((?:(?!<li[ >]|<\/li>|<ul)[\s\S])*?)<\/li>/g)].map((m) => m[1]);
  const out: { result: SearchResult; text: string }[] = [];
  for (const raw of items) {
    const links = [...raw.matchAll(/<a[^>]+class="external text"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
      .map((m) => ({ href: decodeEntities(m[1]), label: decodeEntities(m[2]).trim() }))
      .filter((l) => /^https?:\/\//.test(l.href) && !/wikipedia\.org|wikimedia\.org/.test(l.href));
    if (!links.length) continue;
    const haystack = decodeEntities(raw.replace(/<a[^>]+title="([^"]*)"[^>]*>/g, " $1 ")).toLowerCase();
    if (topicTerms.length && !topicTerms.every((t) => haystack.includes(t))) continue;
    const text = decodeEntities(raw).replace(/\s*\([^()]*\)\s*$/, "").replace(/\s+/g, " ").trim();
    if (text.length < 30) continue;
    const primary = links[0];
    out.push({
      text,
      result: {
        id: stableId("currents", primary.href + text.slice(0, 40)),
        title: text.length > 150 ? `${text.slice(0, 147).replace(/\s\S*$/, "")}…` : text,
        canonicalUrl: primary.href,
        domain: domainOf(primary.href),
        publisher: primary.label || domainOf(primary.href),
        contentType: "news",
        snippet: text,
        publicationDate: `${isoDate}T12:00:00Z`,
        retrievedAt,
        sourceProvider: "currents",
        freshnessStatus: "live",
        limitations: [
          "One-line summary written by Wikipedia editors; the linked publisher is the original report.",
          "Date is the day the event was logged, not the exact publication time.",
          ...(links.length > 1 ? [`Also reported by: ${links.slice(1, 4).map((l) => l.label || domainOf(l.href)).join(", ")}.`] : []),
        ],
      },
    });
  }
  return out;
}

/** References list: cite_note id → first external link and the work's name. */
function referenceMap(html: string) {
  const refs = new Map<string, { href: string; label: string; work?: string }>();
  for (const m of html.matchAll(/<li id="(cite_note-[^"]+)">([\s\S]*?)<\/li>/g)) {
    const link = m[2].match(/<a[^>]+class="external text"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const work = m[2].match(/<i>([\s\S]*?)<\/i>/)?.[1];
    refs.set(m[1], { href: decodeEntities(link[1]), label: decodeEntities(link[2]).replace(/^"|"$/g, "").trim(), work: work ? decodeEntities(work).trim() : undefined });
  }
  return refs;
}

/**
 * "2026 in Bangladesh"-style pages: a dated, cited chronology for a country or place.
 * Only items with an explicit day and a cited external report are kept.
 */
export function parseYearPage(rawHtml: string, year: number, retrievedAt: string, sinceMs: number) {
  const html = rawHtml.replace(/&#95;/g, "_"); // MediaWiki escapes underscores in reference ids
  const events = html.split(/<h2 id="Events"/)[1]?.split(/<h2 /)[0] ?? "";
  const refs = referenceMap(html);
  const out: { result: SearchResult; text: string }[] = [];
  let month = -1;
  for (const chunk of events.split(/(?=<h3 id=")/)) {
    const h = chunk.match(/^<h3 id="([A-Za-z]+)/);
    if (h) month = MONTHS.indexOf(h[1]);
    for (const li of chunk.matchAll(/<li>((?:(?!<li[ >]|<ul)[\s\S])*?)<\/li>/g)) {
      const raw = li[1];
      const text = decodeEntities(raw.replace(/<sup[\s\S]*?<\/sup>/g, "")).replace(/\s+/g, " ").trim();
      const dm = text.match(/^(\d{1,2})(?:\s+([A-Z][a-z]+))?\s*[–—-]\s*(.+)$/);
      if (!dm) continue;
      const m = dm[2] ? MONTHS.indexOf(dm[2]) : month;
      if (m < 0) continue;
      const date = new Date(Date.UTC(year, m, Number(dm[1]), 12));
      if (date.getTime() < sinceMs || date.getTime() > Date.now() + 86_400_000) continue;
      const refId = raw.match(/href="#(cite_note-[^"]+)"/)?.[1];
      const ref = refId ? refs.get(refId) : undefined;
      if (!ref || !/^https?:\/\//.test(ref.href)) continue; // no original report, no entry
      const body = dm[3];
      out.push({
        text: body,
        result: {
          id: stableId("currents", ref.href + body.slice(0, 40)),
          title: body.length > 150 ? `${body.slice(0, 147).replace(/\s\S*$/, "")}…` : body,
          canonicalUrl: ref.href,
          domain: domainOf(ref.href),
          publisher: ref.work ?? domainOf(ref.href),
          contentType: "news",
          snippet: `${body} Cited report: “${ref.label}”.`,
          publicationDate: date.toISOString(),
          retrievedAt,
          sourceProvider: "currents",
          freshnessStatus: "live",
          limitations: [
            "One-line summary from Wikipedia's chronology; the link is the cited original report.",
            "Date is the day of the event, not the article's publication time.",
          ],
        },
      });
    }
  }
  return out.sort((a, b) => Date.parse(b.result.publicationDate!) - Date.parse(a.result.publicationDate!));
}

export const currents: Provider = {
  id: "currents",
  label: "Wikipedia Current events",
  supports: ["news"],
  freshness: () => "volatile",
  available: () => true,
  async search(q) {
    const days = 3; // the daily log is dense; the place chronology below covers the longer tail
    const terms = q.topic.toLowerCase().split(/\s+/).filter((t) => t.length > 2).slice(0, 3);
    const retrievedAt = new Date().toISOString();
    const dates = Array.from({ length: days }, (_, i) => new Date(Date.now() - i * 86_400_000));
    const pages = await Promise.allSettled(
      dates.map(async (d) => {
        const params = new URLSearchParams({ action: "parse", page: pageTitleFor(d), prop: "text", format: "json", formatversion: "2", origin: "*" });
        const html = Parse.parse(await fetchJson(`https://en.wikipedia.org/w/api.php?${params}`)).parse?.text ?? "";
        return parseDay(html, d.toISOString().slice(0, 10), terms, retrievedAt);
      }),
    );
    let rows = pages.flatMap((p) => (p.status === "fulfilled" ? p.value : []));
    // Few items in the daily log: try the place's own chronology for the last six weeks.
    if (rows.length < 4 && terms.length && q.topic.split(/\s+/).length <= 3) {
      const year = new Date().getUTCFullYear();
      const place = q.topic.replace(/\b\p{L}/gu, (c) => c.toUpperCase()).replace(/\s+/g, "_");
      try {
        const params = new URLSearchParams({ action: "parse", page: `${year}_in_${place}`, prop: "text", format: "json", formatversion: "2", redirects: "1", origin: "*" });
        const html = Parse.parse(await fetchJson(`https://en.wikipedia.org/w/api.php?${params}`)).parse?.text ?? "";
        rows = [...rows, ...parseYearPage(html, year, retrievedAt, Date.now() - 45 * 86_400_000)];
      } catch {
        /* no chronology page for this topic */
      }
    }
    const results = rows.slice(0, q.limit).map((r) => r.result);
    return { results, texts: Object.fromEntries(rows.map((r) => [r.result.id, r.text])) };
  },
};
