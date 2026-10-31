// The Agent Station's agents: who they are, where they're kept, and the loop that runs one. Claude decides each
// step; the steps run here in the browser, in view. Clicks and typing that could change something out in the
// world wait for the person.
import { desktop } from "./desktop.ts";

export type Access = "read" | "ask" | "auto";
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
}

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
export const TEMPLATES: Pick<Agent, "name" | "role" | "task" | "plan" | "access">[] = [
  { name: "Researcher", role: "Finds what's reliable on a topic and writes it up.", task: "", plan: ["Search the web for the topic", "Read the three best sources", "Save a short summary with the sources"], access: "read" },
  { name: "Price Watcher", role: "Compares what something costs across shops.", task: "", plan: ["Open the main shops that sell it", "Read each price and delivery cost", "Save a comparison, cheapest first"], access: "read" },
  { name: "Page Helper", role: "Works through a website for you, step by step.", task: "", plan: ["Open the site", "Find the page that's needed", "Do the task, asking before each action"], access: "ask" },
];

const KEY = "horus.agents.v1";

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
}

type Block = { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string };
const MAX_TURNS = 30;

/** Whether a click or typing needs the person, and how to ask. Null means go ahead. */
export function needsApproval(access: Access, what: string): string | null {
  if (access === "ask") return what;
  return /\b(buy|order|pay|checkout|check out|purchase|subscribe|send|post|publish|submit|delete|remove|sign in|log ?in|sign up|register|confirm|transfer|book)\b/i.test(what) ? what : null;
}

export async function runAgent(agent: Agent, deps: {
  turn: (messages: unknown[]) => Promise<{ content: Block[]; stop: string }>;
  tool: (name: string, input: Record<string, unknown>, ask: (question: string) => Promise<boolean>) => Promise<string>;
  update: (patch: (r: Run) => Run) => void;
  signal: AbortSignal;
}) {
  const messages: { role: string; content: unknown }[] = [{ role: "user", content: `Task: ${agent.task}` }];
  for (let i = 0; i < MAX_TURNS; i++) {
    if (deps.signal.aborted) return deps.update((r) => ({ ...r, status: "stopped", ask: undefined }));
    const { content, stop } = await deps.turn(messages);
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
    const results: unknown[] = [];
    for (const call of calls) {
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
        results.push({ type: "tool_result", tool_use_id: step.id, content: output });
      } catch (err) {
        const message = (err as Error).message;
        finish("failed", message);
        results.push({ type: "tool_result", tool_use_id: step.id, content: message, is_error: true });
      }
    }
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
