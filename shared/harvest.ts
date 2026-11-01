// What agents run inside pages, and the manners they keep: extraction scripts for tables, links and repeated items,
// Gmail and YouTube readers, robots.txt rules, pacing, and spotting a human check (which is left to the person).

/** How much page text one tool result may carry. Longer pages are read in parts, so a run's cost stays flat. */
export const TEXT_LIMIT = 12_000;
export const CRAWL_LIMIT = 40;
export const ROWS_LIMIT = 5000;

export type ExtractKind = "tables" | "links" | "list" | "meta";
export type Row = Record<string, string>;

export const textScript = `({ title: document.title, url: location.href, text: (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 400000) })`;

/** Same-site links on a page, for following while crawling. */
export const linksScript = `[...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href.split('#')[0]))].filter((u) => /^https?:/.test(u)).slice(0, 400)`;

const CLEAN = `const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, 600);`;

/** Rows from a page. `list` finds the repeated items (results, products, posts) when no selector is given. */
export function extractScript(kind: ExtractKind, selector = ""): string {
  const sel = JSON.stringify(selector);
  if (kind === "tables") return `(() => { ${CLEAN} const rows = [];
    [...document.querySelectorAll(${sel} || 'table')].slice(0, 12).forEach((t, n) => {
      const cells = [...t.querySelectorAll('tr')].map((r) => [...r.children].map((c) => clean(c.innerText)));
      if (cells.length < 2) return;
      const head = cells[0].map((h, i) => h || 'column ' + (i + 1));
      cells.slice(1).forEach((c) => { const row = { table: String(n + 1) }; head.forEach((h, i) => { row[h] = c[i] || ''; }); rows.push(row); });
    }); return rows; })()`;
  if (kind === "links") return `(() => { ${CLEAN} const seen = new Set(); return [...document.querySelectorAll((${sel} || 'body') + ' a[href]')].flatMap((a) => { const url = a.href.split('#')[0]; if (!/^https?:/.test(url) || seen.has(url)) return []; seen.add(url); return [{ text: clean(a.innerText || a.title || a.getAttribute('aria-label')), url }]; }); })()`;
  if (kind === "meta") return `(() => { ${CLEAN} const row = { title: document.title, url: location.href };
    document.querySelectorAll('meta[name],meta[property]').forEach((m) => { const k = m.getAttribute('property') || m.getAttribute('name'); if (/^(description|author|keywords|og:|article:|twitter:title|twitter:description)/.test(k)) row[k] = clean(m.content); });
    const rows = [row]; document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => { if (s.textContent.length < 20000) rows.push({ jsonLd: s.textContent.trim() }); }); return rows; })()`;
  return `(() => { ${CLEAN}
    const sign = (e) => e.tagName + '.' + [...e.classList].filter((c) => !/\\d/.test(c)).sort().join('.');
    let items = ${sel} ? [...document.querySelectorAll(${sel})] : [];
    if (!items.length) {
      let best = 0;
      document.querySelectorAll('main *, body *').forEach((p) => {
        if (p.children.length < 3 || /^(NAV|HEADER|FOOTER|SELECT|SCRIPT|STYLE|HEAD)$/.test(p.tagName)) return;
        const groups = new Map();
        for (const c of p.children) { const k = sign(c); groups.set(k, [...(groups.get(k) || []), c]); }
        for (const g of groups.values()) {
          if (g.length < 3) continue;
          const text = g.reduce((n, e) => n + Math.min((e.innerText || '').length, 400), 0);
          const score = text * (g.some((e) => e.querySelector('a[href]')) ? 2 : 1);
          if (score > best) { best = score; items = g; }
        }
      });
    }
    return items.map((e) => {
      const a = e.matches('a[href]') ? e : e.querySelector('a[href]');
      const h = e.querySelector('h1,h2,h3,h4,h5,[class*=title i],[class*=name i]');
      const text = clean(e.innerText);
      const price = text.match(/[$€£¥₹]\\s?\\d[\\d,.]*|\\d[\\d,.]*\\s?(?:USD|EUR|GBP|INR)\\b/);
      const row = { title: clean((h && h.innerText) || (a && a.innerText)) || text.slice(0, 120), url: a ? a.href : '', text };
      if (price) row.price = price[0];
      return row;
    }).filter((r) => r.title || r.text); })()`;
}

export const INBOX_READY = "tr.zA, td.TC";
export const inboxScript = (limit: number) => `[...document.querySelectorAll('tr.zA')].slice(0, ${Math.min(limit, 50)}).map((r) => { const t = (s) => (r.querySelector(s)?.innerText || '').replace(/\\s+/g, ' ').trim();
  return { thread: r.querySelector('[data-legacy-thread-id]')?.getAttribute('data-legacy-thread-id') || '', from: r.querySelector('.yW [email]')?.getAttribute('name') || t('.yW'), subject: t('.bog'), snippet: t('.y2').replace(/^[-\\s]+/, ''), date: r.querySelector('.xW span[title]')?.title || t('.xW'), unread: r.classList.contains('zE') }; })`;
export const THREAD_READY = ".a3s";
export const threadScript = `(() => ({ subject: document.querySelector('h2.hP')?.innerText || document.title, messages: [...document.querySelectorAll('.adn')].map((m) => ({ from: m.querySelector('.gD')?.getAttribute('email') || '', name: m.querySelector('.gD')?.getAttribute('name') || '', date: m.querySelector('.g3')?.title || '', text: (m.querySelector('.a3s')?.innerText || '').slice(0, 8000) })) }))()`;

/** A video's title, description and transcript: its caption track when the page offers one, else YouTube's transcript panel. */
export const videoScript = `(async () => {
  const p = window.ytInitialPlayerResponse || {};
  const v = p.videoDetails || {};
  const tracks = p.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const pick = tracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') || tracks.find((t) => t.languageCode?.startsWith('en')) || tracks[0];
  let lines = [];
  if (pick) { try {
    const j = await (await fetch(pick.baseUrl + '&fmt=json3')).json();
    lines = (j.events || []).filter((e) => e.segs).map((e) => ({ s: Math.round((e.tStartMs || 0) / 1000), x: e.segs.map((g) => g.utf8).join('').replace(/\\s+/g, ' ').trim() })).filter((l) => l.x);
  } catch {} }
  if (!lines.length) {
    document.querySelector('#description-inline-expander #expand, tp-yt-paper-button#expand')?.click();
    await new Promise((r) => setTimeout(r, 1500));
    document.querySelector('ytd-video-description-transcript-section-renderer button')?.click();
    for (let i = 0; i < 12 && !lines.length; i++) {
      await new Promise((r) => setTimeout(r, 300));
      lines = [...document.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model')].map((e) => {
        const stamp = (e.querySelector('.segment-timestamp, .ytwTranscriptSegmentViewModelTimestamp')?.innerText || '0').trim().split(':').reduce((a, n) => a * 60 + Number(n), 0);
        return { s: stamp || 0, x: (e.querySelector('.segment-text, span.yt-core-attributed-string')?.innerText || '').trim() };
      }).filter((l) => l.x);
    }
  }
  return { title: v.title || document.title.replace(/ - YouTube$/, ''), channel: v.author || '', seconds: Number(v.lengthSeconds) || 0, views: v.viewCount || '', description: (v.shortDescription || '').slice(0, 3000), language: pick?.languageCode || '', lines };
})()`;

/** Minutes and seconds beside the words, so a summary can point to the moment. */
export const stamp = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const HUMAN_CHECK = /\b(captcha|verify (that )?you('| a)re (a )?human|are you (a )?(human|robot)|unusual traffic|confirm you('| a)re not a (robot|bot)|checking your browser|access denied|attention required|too many requests|not able to serve your requests)\b/i;
/** A page asking for a person, or telling visitors to slow down. Agents stop here: bot checks are never bypassed. */
export const isHumanCheck = (title: string, text: string) => text.length < 3000 && (HUMAN_CHECK.test(title) || HUMAN_CHECK.test(text));

/** The rules for everyone (`*`) in a robots.txt. */
export function robotsRules(txt: string) {
  const rules: { allow: boolean; path: string }[] = [];
  let delay = 0;
  let mine = false;
  let inAgents = false;
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.replace(/#.*/, "").trim().match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    if (field === "user-agent") { mine = (inAgents ? mine : false) || m[2] === "*"; inAgents = true; continue; }
    inAgents = false;
    if (!mine) continue;
    if ((field === "allow" || field === "disallow") && m[2]) rules.push({ allow: field === "allow", path: m[2] });
    if (field === "crawl-delay") delay = Number(m[2]) || delay;
  }
  return { rules, delay };
}

/** The longest matching rule wins, and a tie goes to Allow, as the Robots Exclusion Protocol says. */
export function robotsAllow(rules: ReturnType<typeof robotsRules>["rules"], path: string) {
  let best = { allow: true, len: -1 };
  for (const r of rules) {
    const re = new RegExp(`^${r.path.replace(/[.+?^(){}|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\?\$$/, "$")}`);
    if (re.test(path) && (r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
  }
  return best.allow;
}

/** At least a second between pages of one site; a site's own Crawl-delay is honoured up to ten. */
export const paceFor = (delay: number) => Math.max(1000, Math.min(delay * 1000, 10_000));

/** CSV a spreadsheet opens safely: cells that would run as formulas are kept as text. */
export function toCsv(rows: Row[]) {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v = "") => { const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.map(cell).join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n");
}

export const safeFileName = (name: string) => name.replace(/[/\\?%*:|"<>\x00-\x1f]/g, "-").replace(/^\.+/, "").trim().slice(0, 100) || "agent-file";

export const APP_ID = /^[a-z0-9]{4,24}$/;
export const APP_SCHEME = "agent-app";
export const appUrl = (id: string) => `${APP_SCHEME}://${id}/`;

/** Apps run alone: no network, no way to leave their page, so whatever an agent builds can't carry data anywhere. */
export const APP_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts allow-same-origin allow-modals allow-forms allow-pointer-lock";
