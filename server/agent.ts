// The agents: one spoken (or typed) request, planned by the person's model into steps for a small crew that
// works the browser in front of them. Scout searches and maps, Navigator opens and arranges windows, Reader
// reads pages and answers, Scribe writes. They act only inside Warpnaut's own interface: they open, arrange, read
// and write, and never sign in, buy, post, send or fill in a form; those stay with the person.
import { z } from "zod/v4";
import { extractJson, getBackend } from "./models.ts";

export const AGENTS = ["scout", "navigator", "reader", "scribe"] as const;
export const ACTIONS = ["search", "open", "openMany", "arrange", "focus", "close", "minimizeAll", "fullscreen", "read", "write", "say"] as const;

export const AgentRequest = z.object({
  request: z.string().trim().min(1).max(2000),
  context: z.object({
    windows: z.array(z.object({ title: z.string().max(300), url: z.string().max(2000), front: z.boolean() })).max(40).default([]),
    map: z.string().max(400).optional(),
  }).default({ windows: [] }),
});
export type AgentRequest = z.infer<typeof AgentRequest>;

export const Step = z.object({
  agent: z.enum(AGENTS),
  do: z.enum(ACTIONS),
  query: z.string().max(400).optional(),
  url: z.string().max(2000).optional(),
  urls: z.array(z.string().max(2000)).max(8).optional(),
  match: z.string().max(200).optional(),
  question: z.string().max(2000).optional(),
  text: z.string().max(4000).optional(),
});
export type Step = z.infer<typeof Step>;
export const Plan = z.object({ say: z.string().max(600).default(""), steps: z.array(Step).max(8).default([]) });
export type Plan = z.infer<typeof Plan>;

const SYSTEM = `You direct four agents that work the Warpnaut web browser for the person, from one request.
Agents and what each may do:
- scout: {"do":"search","query":"…"} lays a web search out as a mind map of every site found.
- navigator: {"do":"open","url":"https://…"} opens one page in a window; {"do":"openMany","urls":[…]} opens several side by side as a group; {"do":"arrange"} lays the open windows side by side; {"do":"focus","match":"…"} brings the window whose title or address contains the words to the front; {"do":"close","match":"…"}; {"do":"minimizeAll"}; {"do":"fullscreen","match":"…"}.
- reader: {"do":"read","match":"…","question":"…"} reads the window that matches (or the front window when match is empty) and answers the question from its text.
- scribe: {"do":"write","text":"what to write"} drafts text (emails, summaries, plans) and shows it.
Any agent may {"do":"say","text":"…"} to tell the person something.
Rules: use only these actions. Prefer few steps (at most 8). Use real, well-known addresses for sites (https://www.youtube.com/results?search_query=… for YouTube searches, https://mail.google.com/ for Gmail, https://www.google.com/maps/search/… for places). Never sign in, buy, book, post, send, submit forms or enter personal data: say what the person should do instead. If the request is unclear, return no steps and ask in "say".
Reply with JSON only: {"say":"one short sentence about what the crew will do","steps":[{"agent":"…","do":"…", …}]}`;

export async function planAgents(req: AgentRequest): Promise<Plan & { model: string }> {
  const b = getBackend();
  if (!b) throw Object.assign(new Error("Agents need an AI model. Connect one in Settings."), { status: 503 });
  const ctx = [
    req.context.windows.length ? `Open windows:\n${req.context.windows.map((w) => `- ${w.front ? "[front] " : ""}${w.title} — ${w.url}`).join("\n")}` : "No windows are open.",
    req.context.map ? `The mind map on screen is about: ${req.context.map}` : "",
  ].filter(Boolean).join("\n");
  const reply = await b.ask(SYSTEM, [], [{ type: "text", text: `${ctx}\n\nRequest: ${req.request}` }], 1200);
  const plan = Plan.parse(extractJson(reply));
  // Only web addresses leave the plan; anything else is dropped rather than opened.
  const web = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : undefined);
  plan.steps = plan.steps.map((s) => ({ ...s, url: web(s.url), urls: s.urls?.map(web).filter(Boolean) as string[] | undefined }));
  return { ...plan, model: b.label() };
}
