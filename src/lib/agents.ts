// The Agent Station's agents: who they are, where they're kept, and the loop that runs one. Claude decides each
// step; the steps run here in the browser, in view. Clicks and typing that could change something out in the
// world wait for the person.
import { desktop } from "./desktop.ts";

export type Access = "read" | "ask" | "auto";
export type Skill = "harvest" | "mail" | "video" | "build";
export type Fx = "think" | "radar" | "scan" | "harvest" | "mail" | "video" | "build" | "act";
/** How an agent's avatar looks right now. */
export type Mood = "idle" | "hello" | "salute" | "think" | "search" | "read" | "harvest" | "mail" | "watch" | "build" | "act" | "wait" | "done" | "failed" | "stopped";
export interface Agent {
  id: string;
  name: string;
  role: string;
  task: string;
  plan: string[];
  access: Access;
  model: string;
  hue: number;
  notes: { title: string; text: string; at: number }[];
  last?: { at: number; report: string };
  /** What it's built for: picks its emblem. */
  order?: string;
  skills?: Skill[];
  /** Short facts it carries from run to run. The person can read and delete them. */
  memory?: string[];
  /** Steps finished over its life; a bit of fun that grows into a rank. */
  xp?: number;
}

export const SKILLS: { id: Skill; label: string; hint: string }[] = [
  { id: "harvest", label: "Harvest", hint: "Extracts tables and listings, crawls politely, saves CSV and JSON." },
  { id: "mail", label: "Mail", hint: "Reads your signed-in Gmail and prepares drafts. Only you can send." },
  { id: "video", label: "Video", hint: "Reads YouTube transcripts without playing them." },
  { id: "build", label: "Build", hint: "Makes small apps that run here, sealed off from the internet." },
];

/** The crew an agent can be summoned from: a starting character, not a limit. Ids stay as they were so saved agents keep theirs. */
export const ORDERS: { id: string; name: string; tagline: string; hue: number; skills: Skill[]; access: Access; role: string; plan: string[]; names: string[]; tasks: string[] }[] = [
  { id: "falcon", name: "Scout", tagline: "Hunts down answers", hue: 205, skills: ["harvest"], access: "read", role: "Finds what's reliable on a topic and writes it up with sources.", plan: ["Search the web for the topic", "Read the best sources", "Save a short summary with the sources"], names: ["Vega", "Kestrel", "Comet", "Vesper"], tasks: ["Brief me on this week's news in AI browsers", "Compare the three best standing desks under $500"] },
  { id: "scarab", name: "Collector", tagline: "Harvests the web into data", hue: 150, skills: ["harvest"], access: "read", role: "Turns web pages into clean data sets.", plan: ["Open the source pages", "Extract the rows", "Check them and save a CSV"], names: ["Ledger", "Tally", "Rook", "Cobalt"], tasks: ["Collect the top 30 Hacker News stories into a CSV", "Build a table of laptop prices from this page"] },
  { id: "ibis", name: "Comms", tagline: "Keeps your inbox clear", hue: 190, skills: ["mail"], access: "ask", role: "Reads email and turns it into what needs doing.", plan: ["List recent unread email", "Read what matters", "Save a digest and draft replies"], names: ["Quill", "Echo", "Relay", "Wren"], tasks: ["Summarize my unread email from the last two days", "Find anything in my inbox that needs a reply today"] },
  { id: "serpent", name: "Watcher", tagline: "Watches so you don't have to", hue: 340, skills: ["video"], access: "read", role: "Boils videos down to what's worth knowing.", plan: ["Get the transcript", "Pick out the main points with timestamps", "Save the summary"], names: ["Ember", "Lumen", "Cinder", "Iris"], tasks: ["Summarize this YouTube video with timestamps", "Compare what these two videos claim"] },
  { id: "artisan", name: "Engineer", tagline: "Builds apps from a sentence", hue: 280, skills: ["build", "harvest"], access: "read", role: "Designs and builds small, polished apps inside the browser.", plan: ["Work out what the app must do", "Build it as one page", "Test the idea and improve it"], names: ["Forge", "Dart", "Pixel", "Sprocket"], tasks: ["Build me a pomodoro timer with a task list", "Make a budget tracker that saves my entries"] },
  { id: "jackal", name: "Pilot", tagline: "Works through websites", hue: 18, skills: ["harvest"], access: "ask", role: "Works through a website step by step.", plan: ["Open the site", "Find the page that's needed", "Do the task, asking before each action"], names: ["Atlas", "Ranger", "Sable", "Nova"], tasks: ["Find the cancellation page for this service and tell me the steps", "Fill out this form with the details I gave you"] },
];

/** Which effect a tool plays on the stage. */
export const FX: Record<string, Fx> = { search_web: "radar", list_windows: "radar", read_page: "scan", see_page: "scan", fetch_page: "scan", open_page: "scan", extract_data: "harvest", crawl_pages: "harvest", query_data: "harvest", save_file: "harvest", read_inbox: "mail", read_email: "mail", draft_email: "mail", watch_video: "video", build_app: "build", click: "act", type_text: "act" };

const MOOD_OF_FX: Record<Fx, Mood> = { think: "think", radar: "search", scan: "read", harvest: "harvest", mail: "mail", video: "watch", build: "build", act: "act" };

/** What the avatar does: greets until its first run, salutes a new task, then acts out each step. */
export function moodOf(agent: Pick<Agent, "last">, run?: Pick<Run, "status" | "steps" | "said" | "ask">): Mood {
  if (!run) return agent.last ? "idle" : "hello";
  if (run.ask) return "wait";
  if (run.status === "done") return "done";
  if (run.status === "failed") return "failed";
  if (run.status === "stopped") return "stopped";
  if (!run.steps.length && !run.said) return "salute";
  const step = run.steps[run.steps.length - 1];
  return step?.status === "running" ? MOOD_OF_FX[FX[step.tool] ?? "think"] : "think";
}

/** What it says when no step is speaking for it. */
export const MOOD_LINE: Partial<Record<Mood, string>> = { hello: "Ready when you are", salute: "On it!", think: "Thinking it through…", wait: "I need your OK", done: "Mission complete!", failed: "I hit a snag", stopped: "Standing by" };

const TOOL_WORDS: Record<string, string> = { list_windows: "Looked at the windows", open_page: "Opened a page", fetch_page: "Read", search_web: "Searched the web", read_page: "Read a page", see_page: "Looked over a page", focus_window: "Brought a window forward", close_window: "Closed a window", arrange_windows: "Arranged the windows", save_note: "Saved a note", click: "Clicked", type_text: "Typed", extract_data: "Harvested data", crawl_pages: "Crawled pages", query_data: "Checked the data", save_file: "Saved a file", read_inbox: "Read the inbox", read_email: "Read an email", draft_email: "Drafted an email", watch_video: "Watched a video", build_app: "Built an app", remember: "Remembered" };
const DOING: Record<string, string> = { list_windows: "Checking the windows", open_page: "Opening a page", fetch_page: "Reading", search_web: "Scanning the web", read_page: "Reading a page", see_page: "Looking over a page", focus_window: "Pulling up a window", close_window: "Closing a window", arrange_windows: "Tidying the windows", save_note: "Writing a note", click: "Clicking", type_text: "Typing", extract_data: "Collecting data", crawl_pages: "Crawling pages", query_data: "Checking the data", save_file: "Saving a file", read_inbox: "Opening the inbox", read_email: "Reading an email", draft_email: "Drafting an email", watch_video: "Watching a video", build_app: "Building an app", remember: "Remembering" };
const stepWhat = (s: Step) => {
  const i = s.input as { url?: string; query?: string; title?: string; name?: string; subject?: string; fact?: string };
  return (i.url ?? i.query ?? i.title ?? i.name ?? i.subject ?? i.fact ?? "").replace(/^https?:\/\/(www\.)?/, "");
};
export const stepText = (s: Step) => { const what = stepWhat(s); return `${TOOL_WORDS[s.tool] ?? s.tool}${what ? `: ${what.slice(0, 64)}` : ""}`; };
/** A live line for the speech bubble. */
export const doingText = (s: Step) => { const what = stepWhat(s); return `${DOING[s.tool] ?? s.tool}${what ? ` ${what.slice(0, 30)}` : ""}…`; };

/** Where each crew member stands: up to five on the front row, the rest behind them, as fractions of the stage. */
export function seat(i: number, n: number) {
  const front = Math.min(n, 5);
  const back = i >= front;
  const row = back ? n - front : front;
  const at = back ? i - front : i;
  return { x: (at + 1) / (row + 1), y: back ? 0.46 : 0.72, scale: back ? 0.74 : 1, back };
}

const RANKS = [[0, "Cadet"], [25, "Crew"], [100, "Officer"], [300, "Commander"], [1000, "Legend"]] as const;
export const rankOf = (xp = 0) => [...RANKS].reverse().find(([at]) => xp >= at)![1];

export const skillsOf = (a: Pick<Agent, "skills">): Skill[] => a.skills ?? ["harvest"];

export const MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5, most capable" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5, balanced" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5, fastest and cheapest" },
];
export const ACCESS: { id: Access; label: string; hint: string }[] = [
  { id: "read", label: "Read only", hint: "Opens and reads pages. Never clicks or types." },
  { id: "ask", label: "Ask me first", hint: "Asks before every click and every bit of typing." },
  { id: "auto", label: "Works on its own", hint: "Clicks and types by itself, but still asks before anything like buy, send, post, delete or sign in." },
];
const KEY = "warpnaut.agents.v1";

export async function loadAgents(): Promise<Agent[]> {
  if (desktop) return (await desktop.invoke<Agent[]>("agents:list").catch(() => [])) ?? [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Agent[]; } catch { return []; }
}

export function saveAgents(agents: Agent[]) {
  if (desktop) return void desktop.invoke("agents:save", agents);
  try { localStorage.setItem(KEY, JSON.stringify(agents)); } catch { /* lasts for this visit */ }
}

export interface Step { id: string; tool: string; input: Record<string, unknown>; status: "running" | "done" | "failed" | "declined"; output?: string }
export interface Run {
  agentId: string;
  status: "working" | "done" | "stopped" | "failed";
  steps: Step[];
  said: string;
  report?: string;
  error?: string;
  /** A click or typing waiting for the person. */
  ask?: { question: string; answer: (ok: boolean) => void };
  /** Tokens this run used, and how many came from the cache. */
  used?: { input: number; output: number; cached: number };
}

type Block = { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string };
const MAX_TURNS = 60;
/** Tools that only look: when Claude asks for several at once they run together. */
export const PARALLEL = new Set(["list_windows", "fetch_page", "read_page", "see_page", "extract_data", "query_data", "watch_video", "read_inbox", "read_email"]);

/** Whether a click or typing needs the person, and how to ask. Null means go ahead. */
export function needsApproval(access: Access, what: string): string | null {
  if (access === "ask") return what;
  return /\b(buy|order|pay|checkout|check out|purchase|subscribe|send|post|publish|submit|delete|remove|sign in|log ?in|sign up|register|confirm|transfer|book)\b/i.test(what) ? what : null;
}

/** After email has been read, a run could be carrying someone's hidden instructions: anything that could send data out needs the person. */
export function leavesTrace(name: string, input: Record<string, unknown>) {
  if (name === "click" || name === "type_text" || name === "remember" || name === "crawl_pages") return true;
  if (name === "open_page" || name === "fetch_page" || name === "extract_data") return /[?#]/.test(String(input.url ?? ""));
  return false;
}

export async function runAgent(agent: Agent, deps: {
  turn: (messages: unknown[]) => Promise<{ content: Block[]; stop: string; usage?: { input: number; output: number; cached: number } }>;
  tool: (name: string, input: Record<string, unknown>, ask: (question: string) => Promise<boolean>) => Promise<string>;
  update: (patch: (r: Run) => Run) => void;
  signal: AbortSignal;
}) {
  const messages: { role: string; content: unknown }[] = [{ role: "user", content: `Task: ${agent.task}` }];
  for (let i = 0; i < MAX_TURNS; i++) {
    if (deps.signal.aborted) return deps.update((r) => ({ ...r, status: "stopped", ask: undefined }));
    const { content, stop, usage } = await deps.turn(messages);
    if (usage) deps.update((r) => ({ ...r, used: { input: (r.used?.input ?? 0) + usage.input, output: (r.used?.output ?? 0) + usage.output, cached: (r.used?.cached ?? 0) + usage.cached } }));
    if (deps.signal.aborted) return deps.update((r) => ({ ...r, status: "stopped", ask: undefined }));
    const said = content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (said) deps.update((r) => ({ ...r, said }));
    if (stop === "pause_turn") { messages.push({ role: "assistant", content }); continue; }
    const calls = content.filter((b) => b.type === "tool_use");
    if (!calls.length) {
      if (stop === "refusal") throw new Error("Claude declined this task.");
      if (stop === "max_tokens") throw new Error("Claude ran out of room before finishing.");
      return deps.update((r) => ({ ...r, status: "done", report: said }));
    }
    messages.push({ role: "assistant", content });
    const work = async (call: Block) => {
      const step: Step = { id: call.id!, tool: call.name!, input: call.input ?? {}, status: "running" };
      deps.update((r) => ({ ...r, steps: [...r.steps, step] }));
      const finish = (status: Step["status"], output: string) => deps.update((r) => ({ ...r, steps: r.steps.map((s) => (s.id === step.id ? { ...s, status, output } : s)) }));
      let declined = false;
      const ask = (question: string) => new Promise<boolean>((resolve) => {
        const answer = (ok: boolean) => { declined = !ok; deps.update((r) => ({ ...r, ask: undefined })); resolve(ok); };
        deps.signal.addEventListener("abort", () => answer(false), { once: true });
        deps.update((r) => ({ ...r, ask: { question, answer } }));
      });
      try {
        const output = await deps.tool(step.tool, step.input, ask);
        finish(declined ? "declined" : "done", output.slice(0, 400));
        return { type: "tool_result", tool_use_id: step.id, content: output };
      } catch (err) {
        const message = (err as Error).message;
        finish("failed", message);
        return { type: "tool_result", tool_use_id: step.id, content: message, is_error: true };
      }
    };
    // Reading tools run together; anything that acts keeps its order, one at a time.
    const results: unknown[] = [];
    if (calls.every((c) => PARALLEL.has(c.name!))) results.push(...await Promise.all(calls.map(work)));
    else for (const call of calls) results.push(await work(call));
    messages.push({ role: "user", content: results });
  }
  throw new Error(`Stopped after ${MAX_TURNS} turns without finishing.`);
}

/* ---------- reaching into a page: what see_page, click and type_text run there ---------- */

const ELEMENTS = `[...document.querySelectorAll('a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[contenteditable=true]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }).slice(0, 150)`;
const LABEL = `(e) => (e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || e.name || e.title || e.href || '').trim().replace(/\\s+/g, ' ').slice(0, 90)`;
/** Fields nothing here may type in, however it is asked. */
const SECRET = `(e) => e.type === 'password' || /cc-|card|cvv|cvc|one-time-code|current-password|new-password|otp|ssn/i.test([e.autocomplete, e.name, e.id].join(' '))`;

export const seeScript = `(() => { const label = ${LABEL}; return ${ELEMENTS}.map((e, i) => ({ n: i, kind: e.tagName.toLowerCase() + (e.type ? ':' + e.type : ''), label: label(e) })); })()`;
export const labelScript = (n: number) => `(() => { const e = ${ELEMENTS}[${n}]; if (!e) return null; const label = ${LABEL}; return { label: label(e), secret: (${SECRET})(e) }; })()`;
export const clickScript = (n: number) => `(() => { const e = ${ELEMENTS}[${n}]; if (!e) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true; })()`;
export const typeScript = (n: number, text: string, submit: boolean) => `(() => { const e = ${ELEMENTS}[${n}]; if (!e || (${SECRET})(e)) return false; e.focus();
  const set = Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set;
  if (e.isContentEditable) e.textContent = ${JSON.stringify(text)}; else if (set) set.call(e, ${JSON.stringify(text)}); else e.value = ${JSON.stringify(text)};
  e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
  ${submit ? `e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); (e.form?.requestSubmit ? e.form.requestSubmit() : e.form?.submit());` : ""}
  return true; })()`;
