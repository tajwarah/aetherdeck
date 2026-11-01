// What an agent can think with besides Claude: Ollama on this computer or in its cloud, LM Studio, and any provider with an
// OpenAI-style API. The agent loop speaks Claude's block format everywhere, so this file translates each turn there and back.
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { listModels, ollamaChat, ollamaUrl, PRESETS, THINK_TIME } from "./models.ts";

export type Cost = "local" | "free" | "paid";
export interface Brain { id: string; label: string; cost: Cost; ready: boolean; models: { id: string; name: string }[]; note?: string }
type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };
type Message = { role: string; content: string | Block[] };
export interface TurnResult { content: Block[]; stop: string; usage: { input: number; output: number; cached: number; written: number } }

const COMPAT: { id: string; cost: Cost }[] = [{ id: "groq", cost: "free" }, { id: "gemini", cost: "free" }, { id: "openrouter", cost: "free" }, { id: "openai", cost: "paid" }];
const LISTED = 40;
/** Older tool results shrink so a long run stays within a small model's memory, and costs stay flat. */
const KEEP_WHOLE = 6;
const CLIPPED = 500;

const textOf = (c: unknown) => (typeof c === "string" ? c : JSON.stringify(c ?? ""));

export function compact(messages: Message[]): Message[] {
  return messages.map((m, i) => (i >= messages.length - KEEP_WHOLE || typeof m.content === "string" ? m : {
    ...m,
    content: m.content.map((b) => (b.type === "tool_result" && textOf(b.content).length > CLIPPED ? { ...b, content: `${textOf(b.content).slice(0, CLIPPED)}… [shortened]` } : b)),
  }));
}

/** The conversation in OpenAI's shape. Ollama differs only in sending arguments as an object and naming the tool. */
export function toChat(system: string, messages: Message[], native = false) {
  const names = new Map<string, string>();
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const m of compact(messages)) {
    if (typeof m.content === "string") { out.push({ role: m.role, content: m.content }); continue; }
    const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (m.role === "assistant") {
      const calls = m.content.filter((b) => b.type === "tool_use");
      for (const c of calls) names.set(c.id!, c.name!);
      out.push({ role: "assistant", content: text, ...(calls.length ? { tool_calls: calls.map((c) => (native ? { function: { name: c.name, arguments: c.input ?? {} } } : { id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) } : {}) });
      continue;
    }
    for (const b of m.content.filter((x) => x.type === "tool_result")) out.push(native ? { role: "tool", tool_name: names.get(b.tool_use_id!), content: textOf(b.content) } : { role: "tool", tool_call_id: b.tool_use_id, content: textOf(b.content) });
    if (text) out.push({ role: "user", content: text });
  }
  return out;
}

export const toFunctions = (tools: Anthropic.Tool[]) => tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));

const parseArgs = (a: unknown): Record<string, unknown> => { if (typeof a !== "string") return (a ?? {}) as Record<string, unknown>; try { return JSON.parse(a) as Record<string, unknown>; } catch { return {}; } };
const call = (name: string, input: unknown, id?: string): Block => ({ type: "tool_use", id: id || `call_${randomUUID()}`, name, input: parseArgs(input) });

/** Smaller local models often write a tool call as text instead of using the API. */
export function callsInText(text: string, tools: Anthropic.Tool[]): Block[] {
  const known = new Set(tools.map((t) => t.name));
  const found: Block[] = [];
  for (const m of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>|^\s*(?:```(?:json)?\s*)?(\{[\s\S]*\})\s*(?:```)?\s*$/g)) {
    try {
      const j = JSON.parse(m[1] ?? m[2]) as { name?: string; arguments?: unknown; parameters?: unknown };
      if (j.name && known.has(j.name)) found.push(call(j.name, j.arguments ?? j.parameters ?? {}));
    } catch { /* ordinary text */ }
  }
  return found;
}

/** A model's reply as Claude-style blocks. */
export function toBlocks(text: string | null | undefined, calls: Block[], finish: string | null | undefined, tools: Anthropic.Tool[]): Pick<TurnResult, "content" | "stop"> {
  const said = (text ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Some models repeat a call within one reply; doing it once is what they meant.
  const made = [...new Map((calls.length ? calls : callsInText(said, tools)).map((c) => [`${c.name}${JSON.stringify(c.input)}`, c])).values()];
  const inText = !calls.length && made.length > 0;
  const content: Block[] = [...(said && !inText ? [{ type: "text", text: said }] : []), ...made];
  return { content, stop: made.length ? "tool_use" : finish === "length" ? "max_tokens" : "end_turn" };
}

async function compatTurn(provider: string, model: string, system: string, tools: Anthropic.Tool[], messages: Message[], maxTokens: number, fetchImpl: typeof fetch): Promise<TurnResult> {
  const preset = PRESETS[provider];
  if (!preset) throw Object.assign(new Error(`Unknown provider ${provider}`), { status: 400 });
  const key = preset.keyEnv ? process.env[preset.keyEnv] : provider;
  if (!key) throw Object.assign(new Error(`Add your ${preset.label} key in Settings first.`), { status: 503 });
  let res: Response;
  try {
    res = await fetchImpl(`${preset.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...(preset.headers ?? {}) },
      body: JSON.stringify({ model, messages: toChat(system, messages), ...(tools.length ? { tools: toFunctions(tools) } : {}), ...(preset.completionTokens ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }) }),
      signal: AbortSignal.timeout(280_000),
    });
  } catch { throw Object.assign(new Error(provider === "lmstudio" ? "LM Studio isn't running. Start its local server and try again." : `${preset.label} can't be reached.`), { status: 503 }); }
  const raw = await res.text();
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`${preset.label} did not accept the API key.`), { status: 401 });
  if (res.status === 429) throw Object.assign(new Error(`${preset.label}'s limit is reached. Free tiers have daily caps: try again later or choose another model.`), { status: 429 });
  if (!res.ok) throw Object.assign(new Error(`${preset.label} answered ${res.status}: ${raw.slice(0, 200)}`), { status: 502 });
  const body = JSON.parse(raw) as { choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } };
  const choice = body.choices?.[0];
  const cached = body.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    ...toBlocks(choice?.message?.content, (choice?.message?.tool_calls ?? []).map((c) => call(c.function.name, c.function.arguments, c.id)), choice?.finish_reason, tools),
    usage: { input: (body.usage?.prompt_tokens ?? 0) - cached, output: body.usage?.completion_tokens ?? 0, cached, written: 0 },
  };
}

async function ollamaTurn(cloud: boolean, model: string, system: string, tools: Anthropic.Tool[], messages: Message[], fetchImpl: typeof fetch): Promise<TurnResult> {
  const r = await ollamaChat(cloud, { model, messages: toChat(system, messages, true), ...(tools.length ? { tools: toFunctions(tools) } : {}) }, THINK_TIME, fetchImpl);
  const cached = r.prompt_eval_cached_count ?? 0;
  return {
    ...toBlocks(r.message.content, r.message.tool_calls.map((c) => call(c.function.name, c.function.arguments)), r.done_reason, tools),
    usage: { input: (r.prompt_eval_count ?? 0) - cached, output: r.eval_count ?? 0, cached, written: 0 },
  };
}

/** One turn on any brain but Claude. */
export function brainTurn(provider: string, model: string, system: string, tools: Anthropic.Tool[], messages: Message[], maxTokens: number, fetchImpl: typeof fetch = fetch) {
  if (provider === "ollama" || provider === "ollama-cloud") return ollamaTurn(provider === "ollama-cloud", model, system, tools, messages, fetchImpl);
  return compatTurn(provider, model, system, tools, messages, maxTokens, fetchImpl);
}

/** Ollama says which models can use tools; agents can't work without them. Older versions don't say, so those stay listed. */
async function withTools(models: { id: string; name: string }[], fetchImpl: typeof fetch) {
  const checked = await Promise.all(models.map(async (m) => {
    try {
      const r = await fetchImpl(`${ollamaUrl()}/api/show`, { method: "POST", body: JSON.stringify({ model: m.id }), signal: AbortSignal.timeout(3000) });
      const caps = ((await r.json()) as { capabilities?: string[] }).capabilities;
      return !caps || caps.includes("tools") ? [m] : [];
    } catch { return [m]; }
  }));
  return checked.flat();
}

const tryList = (provider: string, key: string, fetchImpl: typeof fetch) => listModels(provider, key, fetchImpl).catch((err: Error) => ({ error: err.message }));
const CLAUDE = [{ id: "claude-opus-5-5", name: "Opus 5.5, most capable" }, { id: "claude-sonnet-5-5", name: "Sonnet 5.5, balanced" }, { id: "claude-haiku-5-5", name: "Haiku 5.5, fastest and cheapest" }];

/** Every brain, cheapest first, with what can be used now and what it takes to connect the rest. */
export async function listBrains(fetchImpl: typeof fetch = fetch): Promise<Brain[]> {
  const local = await tryList("ollama", "", fetchImpl);
  const models = "error" in local ? [] : await withTools(local, fetchImpl);
  const brains: Brain[] = [{ id: "ollama", label: "Ollama, on this computer", cost: "local", ready: models.length > 0, models, note: "error" in local ? "Install Ollama from ollama.com, then run: ollama pull qwen3" : models.length ? undefined : "Download a model with tool support. Run: ollama pull qwen3" }];
  const studio = await tryList("lmstudio", "lmstudio", fetchImpl);
  brains.push({ id: "lmstudio", label: "LM Studio, on this computer", cost: "local", ready: !("error" in studio) && studio.length > 0, models: "error" in studio ? [] : studio.slice(0, LISTED), note: "error" in studio ? "Start LM Studio's local server." : undefined });
  const cloudKey = process.env.OLLAMA_API_KEY;
  const cloud = cloudKey ? await tryList("ollama-cloud", cloudKey, fetchImpl) : null;
  brains.push({ id: "ollama-cloud", label: "Ollama Cloud", cost: "free", ready: !!cloud && !("error" in cloud) && cloud.length > 0, models: cloud && !("error" in cloud) ? cloud.slice(0, LISTED) : [], note: !cloudKey ? "Add an Ollama key in Settings." : cloud && "error" in cloud ? cloud.error : undefined });
  for (const c of COMPAT) {
    const preset = PRESETS[c.id];
    const key = process.env[preset.keyEnv];
    const list = key ? await tryList(c.id, key, fetchImpl) : null;
    const usable = list && !("error" in list) ? (c.id === "openrouter" ? [...list].sort((a, b) => Number(b.id.endsWith(":free")) - Number(a.id.endsWith(":free"))) : list).slice(0, LISTED) : [];
    brains.push({ id: c.id, label: preset.label, cost: c.cost, ready: usable.length > 0, models: usable, note: !key ? `Add a ${preset.label} key in Settings.` : list && "error" in list ? list.error : undefined });
  }
  brains.push({ id: "anthropic", label: "Anthropic Claude", cost: "paid", ready: !!process.env.ANTHROPIC_API_KEY, models: process.env.ANTHROPIC_API_KEY ? CLAUDE : [], note: process.env.ANTHROPIC_API_KEY ? undefined : "Add a Claude key in Settings." });
  return brains;
}
