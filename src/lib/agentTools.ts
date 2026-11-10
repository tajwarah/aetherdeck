// The tools that go beyond a visible window: reading pages through the agent engine, data sets, Gmail, YouTube, files,
// apps and memory. Big results stay here on the workbench and only a short preview enters the conversation, so a long
// run neither grows the app's memory nor pays again for rows Claude has already seen.
import { appUrl, extractScript, inboxScript, inGmail, INBOX_READY, ROWS_LIMIT, stamp, TEXT_LIMIT, threadScript, THREAD_READY, toCsv, videoScript, type ExtractKind, type Row } from "../../shared/harvest.ts";
import { artifactHtml, type ArtifactKind } from "../../shared/artifact.ts";
import { desktop } from "./desktop.ts";
import type { Agent } from "./agents.ts";

export type DataSets = Map<string, { source: string; rows: Row[] }>;
interface Ctx {
  agent: Agent;
  data: DataSets;
  signal: AbortSignal;
  openUrl: (url: string, title?: string) => void;
  markMail: () => void;
  remember: (fact: string) => void;
  livePage: (window: unknown) => Promise<{ url: string; read: <T>(script: string) => Promise<T | null> }>;
}
interface Visited<T> { url: string; title: string; humanCheck: boolean; result: T }

const ENGINE = new Set(["fetch_page", "extract_data", "crawl_pages", "save_file", "read_inbox", "read_email", "watch_video", "build_app", "make_artifact", "build_site", "pick_files", "drive_save", "drive_read", "drive_list", "calendar_add", "calendar_list"]);

const CHECK = "The site is asking for a human check. Agents never get around those: tell the person, and they can open the page and do it themselves.";
const wrap = (url: string, text: string) => `<page_content source="${url.replace(/"/g, "")}">\n${text}\n</page_content>`;

/** One part of a long text, saying where the next begins. */
export function inParts(url: string, text: string, offset = 0) {
  const part = text.slice(offset, offset + TEXT_LIMIT);
  const next = offset + part.length;
  return wrap(url, part) + (next < text.length ? `\n[Part only: ${next} of ${text.length} characters. Continue with offset ${next}.]` : "");
}

export const keepRows = (data: DataSets, source: string, rows: Row[]) => {
  const id = `d${data.size + 1}`;
  data.set(id, { source, rows: rows.slice(0, ROWS_LIMIT) });
  if (data.size > 20) data.delete(data.keys().next().value!);
  const columns = [...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)))];
  return wrap(source, JSON.stringify({ dataset: id, rows: rows.length, columns, first: rows.slice(0, 10) }));
};

function need(data: DataSets, id: unknown) {
  const set = data.get(String(id));
  if (!set) throw new Error(`No data set ${String(id)}`);
  return set;
}

/** Runs a tool, or returns null when it's one of the window tools in App. */
export async function engineTool(name: string, input: Record<string, unknown>, c: Ctx): Promise<string | null> {
  const ipc = desktop;
  const run = <T,>(url: string, script: string, o?: { waitFor?: string }) => ipc!.invoke<Visited<T>>("engine:run", url, script, o);
  const offset = Number(input.offset) || 0;
  if (!ipc && ENGINE.has(name)) throw new Error("This works in the desktop app");
  switch (name) {
    case "fetch_page": {
      const p = await ipc!.invoke<{ url: string; title: string; text: string; humanCheck: boolean }>("engine:read", String(input.url ?? ""));
      if (p.humanCheck) return CHECK;
      return inParts(p.url, `${p.title}\n\n${p.text}`, offset);
    }
    case "extract_data": {
      const script = extractScript(String(input.kind ?? "list") as ExtractKind, String(input.selector ?? ""));
      if (input.url) {
        const v = await run<Row[]>(String(input.url), script);
        if (v.humanCheck) return CHECK;
        return keepRows(c.data, v.url, v.result ?? []);
      }
      const p = await c.livePage(input.window);
      return keepRows(c.data, p.url, (await p.read<Row[]>(script)) ?? []);
    }
    case "crawl_pages": {
      const urls = (Array.isArray(input.urls) ? input.urls : []).map(String).slice(0, 40);
      const stop = () => void ipc!.invoke("engine:stop", c.agent.id);
      c.signal.addEventListener("abort", stop, { once: true });
      const r = await ipc!.invoke<{ pages: Row[]; skipped: { url: string; why: string }[] }>("engine:crawl", c.agent.id, urls, { limit: Number(input.limit) || undefined, follow: input.follow ? String(input.follow) : undefined });
      c.signal.removeEventListener("abort", stop);
      return `${keepRows(c.data, urls[0] ?? "crawl", r.pages)}\nSkipped: ${JSON.stringify(r.skipped.slice(0, 10))}`;
    }
    case "query_data": {
      const set = need(c.data, input.dataset);
      const word = String(input.contains ?? "").toLowerCase();
      const rows = word ? set.rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(word))) : set.rows;
      const limit = Math.min(Number(input.limit) || 20, 50);
      return wrap(set.source, JSON.stringify({ matching: rows.length, offset, rows: rows.slice(offset, offset + limit) }));
    }
    case "save_file": {
      const file = String(input.name ?? "results.txt");
      const set = input.dataset ? need(c.data, input.dataset) : null;
      const body = set ? (/\.json$/i.test(file) ? JSON.stringify(set.rows, null, 2) : toCsv(set.rows)) : String(input.text ?? "");
      return `Saved to ${await ipc!.invoke<string>("engine:save", set && !/\.(csv|json)$/i.test(file) ? `${file}.csv` : file, body)}`;
    }
    case "read_inbox": {
      c.markMail();
      const q = String(input.search ?? "").trim();
      const url = `https://mail.google.com/mail/u/0/#${q ? `search/${encodeURIComponent(q)}` : "inbox"}`;
      const v = await run<{ ready: boolean; rows: Row[] }>(url, inboxScript(Number(input.limit) || 20), { waitFor: INBOX_READY });
      if (!inGmail(v.url)) return "Gmail isn't signed in here. Tell the person to open Gmail in a window and sign in; agents never sign in.";
      if (!v.result.ready) return "Gmail didn't show an inbox, so nothing is known about the person's email. Say so; don't report it as empty.";
      return wrap("gmail", JSON.stringify(v.result.rows));
    }
    case "read_email": {
      c.markMail();
      const v = await run<unknown>(`https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(String(input.thread ?? ""))}`, threadScript, { waitFor: THREAD_READY });
      if (!inGmail(v.url)) return "Gmail isn't signed in here. Tell the person to sign in; agents never sign in.";
      return inParts("gmail", JSON.stringify(v.result), offset);
    }
    case "draft_email": {
      const q = new URLSearchParams({ view: "cm", fs: "1", to: String(input.to ?? ""), su: String(input.subject ?? ""), body: String(input.body ?? "").slice(0, 1800) });
      c.openUrl(`https://mail.google.com/mail/?${q}`, "Draft");
      return "The draft is open for the person to check and send. You can't send it.";
    }
    case "watch_video": {
      const url = String(input.url ?? "");
      if (!/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(url)) throw new Error("That isn't a YouTube address");
      const v = await run<{ title: string; channel: string; seconds: number; description: string; lines: { s: number; x: string }[] }>(url, videoScript, { waitFor: "ytd-watch-metadata, ytd-video-description-transcript-section-renderer" });
      if (v.humanCheck) return CHECK;
      const m = v.result;
      const said = m.lines.map((l) => `[${stamp(l.s)}] ${l.x}`).join("\n");
      return inParts(v.url, `${m.title}\nChannel: ${m.channel}\nLength: ${stamp(m.seconds)}\n\n${m.description}\n\nTranscript:\n${said || "(YouTube didn't give this browser a transcript. Say so plainly, work only from the title and description, and never guess what was said.)"}`, offset);
    }
    case "build_app": {
      const given = String(input.id ?? "");
      const id = /^[a-z0-9]{4,24}$/.test(given) ? given : `a${Date.now().toString(36)}`;
      const title = String(input.title ?? "App");
      await ipc!.invoke("apps:save", { id, title, agent: c.agent.name, html: String(input.html ?? "") });
      c.openUrl(appUrl(id), title);
      return `Built and opened ${title}, id ${id}. Pass this id to improve it.`;
    }
    case "make_artifact": {
      const given = String(input.id ?? "");
      const id = /^[a-z0-9]{4,24}$/.test(given) ? given : `r${Date.now().toString(36)}`;
      const title = String(input.title ?? "Untitled").slice(0, 80);
      const kind = (["document", "page", "chart", "code"].includes(String(input.kind)) ? input.kind : "document") as ArtifactKind;
      await ipc!.invoke("apps:save", { id, title, agent: c.agent.name, kind: "artifact", html: artifactHtml({ title, kind, content: String(input.content ?? ""), agent: c.agent.name }) });
      c.openUrl(appUrl(id), title);
      return `Made the ${kind} “${title}”, id ${id}, and opened it. It's kept in the Agent Station under Artifacts. Pass this id to revise it.`;
    }
    case "build_site": {
      const files = Array.isArray(input.files) ? (input.files as { path: string; content: string }[]) : [];
      if (!files.length) throw new Error("Send at least one file, such as index.html");
      const r = await ipc!.invoke<{ url: string; folder: string; files: string[] }>("sites:write", { agent: c.agent.name, name: String(input.name ?? "site"), files });
      c.openUrl(r.url, String(input.name ?? "Website"));
      return `Wrote ${r.files.join(", ")} to ${r.folder}. The site is at ${r.url} (this computer only) and is open in a window.`;
    }
    case "drive_save": case "drive_read": case "drive_list": case "calendar_add": case "calendar_list": {
      try { return wrap("google", JSON.stringify(await ipc!.invoke("google:api", name, input))); } catch (e) {
        throw new Error((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
      }
    }
    case "pick_files": {
      const picked = await ipc!.invoke<{ name: string; mb: number }[]>("media:pick", { agent: c.agent.name, purpose: String(input.purpose ?? "") });
      return picked.length ? JSON.stringify(picked) : "The person didn't choose any files.";
    }
    case "remember":
      c.remember(String(input.fact ?? ""));
      return "Kept for future runs";
    default:
      return null;
  }
}


