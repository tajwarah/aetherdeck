// Artifacts: finished pieces of work an agent makes for the person to keep, open and share, like a report, a page, a
// chart or code. Documents and code are written in Markdown and become one self-contained page in AetherDeck's
// look; pages and charts arrive as HTML. Either way they're kept like built apps and served with no network.
export type ArtifactKind = "document" | "page" | "chart" | "code";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Bold, italics, code and links inside a line, after escaping. Only http(s) and mailto links survive. */
function inline(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

/** A small Markdown: headings, paragraphs, lists, quotes, code blocks, tables and rules. Exported for tests. */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    const fence = /^```\s*([\w-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code${fence[1] ? ` class="lang-${esc(fence[1])}"` : ""}>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (/^\|.*\|\s*$/.test(line) && /^\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && /^\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    const list = /^\s*([-*]|\d+\.)\s+/.exec(line);
    if (list) {
      const ordered = /\d/.test(list[1]);
      const items: string[] = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]); i++) items.push(`<li>${inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>`);
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) q.push(lines[i].replace(/^>\s?/, ""));
      out.push(`<blockquote>${inline(q.join(" "))}</blockquote>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    for (; i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*]|\d+\.)\s|\|)/.test(lines[i]); i++) para.push(lines[i]);
    if (!para.length) { out.push(`<p>${inline(line)}</p>`); i++; continue; }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

const STYLE = `
:root { color-scheme: dark; }
body { margin: 0; background: radial-gradient(120% 70% at 50% 0%, #17142a, #07070f 70%) fixed; color: #ece9f6; font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 56px 28px 80px; }
.by { font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: #f6c89c; margin: 0 0 10px; }
h1, h2, h3, h4 { line-height: 1.25; color: #fff; margin: 1.6em 0 .5em; } h1 { font-size: 32px; margin-top: 0; } h2 { font-size: 23px; } h3 { font-size: 18px; }
a { color: #c3b6ff; } code { font: 13.5px ui-monospace, SFMono-Regular, Menlo, monospace; background: rgba(167,150,255,.14); padding: 1px 5px; border-radius: 5px; }
pre { background: #0d0c16; border: 1px solid rgba(167,150,255,.25); border-radius: 12px; padding: 16px 18px; overflow: auto; } pre code { background: none; padding: 0; }
blockquote { margin: 1em 0; padding: .4em 1em; border-left: 3px solid #a796ff; color: #cfc8e6; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 14.5px; } th, td { border-bottom: 1px solid rgba(255,255,255,.12); padding: 8px 10px; text-align: left; } th { color: #f6c89c; font-weight: 600; }
hr { border: 0; border-top: 1px solid rgba(255,255,255,.14); margin: 2em 0; }`;

/** The page an artifact is kept as. */
export function artifactHtml(o: { title: string; kind: ArtifactKind; content: string; agent: string }): string {
  if (o.kind === "page" || o.kind === "chart") return o.content;
  const body = o.kind === "code" && !/```/.test(o.content) ? `<pre><code>${esc(o.content)}</code></pre>` : markdownToHtml(o.content);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(o.title)}</title><style>${STYLE}</style></head>
<body><main><p class="by">${esc(o.kind)} · made by ${esc(o.agent)} in AetherDeck</p><h1>${esc(o.title)}</h1>
${body}
</main></body></html>`;
}
