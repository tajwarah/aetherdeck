// ChatGPT as a model, on the person's own ChatGPT plan: "Sign in with ChatGPT" (the desktop app holds the tokens, see
// electron/chatgpt.ts) lets AetherDeck send AI requests against the plan's allowance, up to the cap the person set
// for AetherDeck in ChatGPT, instead of an API key. Requests go to OpenAI's Responses API, streamed, with nothing
// stored there (store: false), and each carries the whole context it needs.
import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { compact, type TurnResult } from "./brains.ts";
import { extractJson, type ModelBackend, type Part, type Turn } from "./models.ts";
import { log } from "./log.ts";

const API = "https://api.openai.com/v1";
/** Used until the account's own model list has been read. */
export const CHATGPT_DEFAULT = "gpt-6.1-sol";

interface Source { ready: () => boolean; token: () => Promise<string>; email?: () => string | undefined }
let source: Source | null = null;
/** The desktop app hands over a way to get a fresh access token once the person has signed in. */
export function setChatGPT(s: Source | null) { source = s; }
export const chatgptReady = () => !!source?.ready();

type Item = Record<string, unknown>;
interface Done { output: { type: string; content?: { type: string; text?: string }[]; call_id?: string; name?: string; arguments?: string }[]; usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } }; status?: string; incomplete_details?: { reason?: string } }

/** Explains the errors ChatGPT plan usage sends back, in the person's terms. */
function explain(status: number, body: string): Error {
  const code = /"code"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? "";
  const message = code === "subscription_sharing_usage_limit_exceeded" ? "AetherDeck has used the share of your ChatGPT plan you allowed it. Raise the limit in ChatGPT's settings, or wait for it to reset."
    : code === "subscription_sharing_user_not_eligible" ? "This ChatGPT plan can't be used in other apps. It needs Plus or Pro."
    : status === 401 || code === "subscription_sharing_invalid_user" ? "ChatGPT signed AetherDeck out. Sign in with ChatGPT again in Settings."
    : `ChatGPT answered HTTP ${status}`;
  return Object.assign(new Error(message), { status: status === 429 ? 429 : 503 });
}

/** One request, streamed, gathered into the finished response. Only response.completed counts as success. */
async function respond(model: string, instructions: string, input: Item[], tools?: Item[], fetchImpl: typeof fetch = fetch): Promise<Done> {
  if (!source?.ready()) throw Object.assign(new Error("Sign in with ChatGPT in Settings first."), { status: 503 });
  const res = await fetchImpl(`${API}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await source.token()}`, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ model, instructions, input, store: false, stream: true, ...(tools?.length ? { tools } : {}) }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok || !res.body) throw explain(res.status, await res.text().catch(() => ""));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const event = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const data = event.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data || data === "[DONE]") continue;
      let e: { type?: string; response?: Done & { error?: { code?: string; message?: string } } };
      try { e = JSON.parse(data); } catch { continue; }
      if (e.type === "response.completed" && e.response) return e.response;
      if (e.type === "response.failed" || e.type === "error") {
        const code = e.response?.error?.code ?? "";
        throw explain(code === "subscription_sharing_usage_limit_exceeded" ? 429 : 503, JSON.stringify(e.response?.error ?? e));
      }
    }
  }
  throw Object.assign(new Error("ChatGPT stopped before finishing."), { status: 503 });
}

const textOf = (d: Done) => d.output.flatMap((o) => (o.type === "message" ? (o.content ?? []).flatMap((c) => (c.type === "output_text" && c.text ? [c.text] : [])) : [])).join("\n").trim();
const userText = (text: string): Item => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });

/** The models this sign-in can use, for the picker. */
export async function chatgptModels(fetchImpl: typeof fetch = fetch): Promise<{ id: string; name: string }[]> {
  if (!source?.ready()) return [];
  try {
    const res = await fetchImpl(`${API}/models`, { headers: { Authorization: `Bearer ${await source.token()}` }, signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const list = ((await res.json()) as { data?: { id: string }[] }).data ?? [];
      const chat = list.filter((m) => /^(gpt-|o\d)/.test(m.id) && !/(audio|realtime|tts|transcribe|image|embedding|search|moderation)/.test(m.id));
      if (chat.length) return chat.map((m) => ({ id: m.id, name: `${m.id}, on your ChatGPT plan` }));
    }
  } catch (err) { log("info", "chatgpt_models_unread", { error: (err as Error).message }); }
  return [{ id: CHATGPT_DEFAULT, name: `${CHATGPT_DEFAULT}, on your ChatGPT plan` }];
}

/** ChatGPT for research and the assistant. */
export function chatgptBackend(model = CHATGPT_DEFAULT): ModelBackend {
  return {
    provider: "chatgpt",
    free: true,
    vision: true,
    label: () => `${model} (your ChatGPT plan)`,
    async ask(system, history: Turn[], parts: Part[]) {
      const last: Item = {
        type: "message", role: "user",
        content: parts.map((p) => (p.type === "text" ? { type: "input_text", text: p.text } : p.type === "image" ? { type: "input_image", image_url: `data:${p.mime};base64,${p.data}` } : { type: "input_file", filename: p.name, file_data: `data:application/pdf;base64,${p.data}` })),
      };
      const input = [...history.map((t): Item => (t.role === "user" ? userText(t.text) : { type: "message", role: "assistant", content: [{ type: "output_text", text: t.text }] })), last];
      return textOf(await respond(model, system, input));
    },
    async json<T>(schema: z.ZodType<T>, system: string, user: string) {
      const shape = JSON.stringify(z.toJSONSchema(schema));
      const done = await respond(model, `${system}\n\nReply with one JSON object only, matching this JSON Schema:\n${shape}`, [userText(user)]);
      const parsed = schema.safeParse(extractJson(textOf(done)));
      if (parsed.success) return parsed.data;
      log("warn", "llm_invalid_json", { provider: "chatgpt", model });
      return null;
    },
  };
}

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown };
type Message = { role: string; content: string | Block[] };

/** The agent conversation (Claude's block format) as Responses input items. Exported for tests. */
export function toItems(messages: Message[]): Item[] {
  const out: Item[] = [];
  const str = (c: unknown) => (typeof c === "string" ? c : JSON.stringify(c ?? ""));
  for (const m of compact(messages as never) as Message[]) {
    if (typeof m.content === "string") { out.push(m.role === "assistant" ? { type: "message", role: "assistant", content: [{ type: "output_text", text: m.content }] } : userText(m.content)); continue; }
    const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (m.role === "assistant") {
      if (text) out.push({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
      for (const b of m.content.filter((x) => x.type === "tool_use")) out.push({ type: "function_call", call_id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) });
      continue;
    }
    for (const b of m.content.filter((x) => x.type === "tool_result")) out.push({ type: "function_call_output", call_id: b.tool_use_id, output: str(b.content) });
    if (text) out.push(userText(text));
  }
  return out;
}

/** One agent turn on the ChatGPT plan, answered in Claude's block format like every other brain. */
export async function chatgptTurn(model: string, system: string, tools: Anthropic.Tool[], messages: Message[], fetchImpl: typeof fetch = fetch): Promise<TurnResult> {
  const done = await respond(model, system, toItems(messages), tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.input_schema })), fetchImpl);
  const content: Block[] = [];
  const said = textOf(done);
  if (said) content.push({ type: "text", text: said });
  for (const o of done.output) {
    if (o.type !== "function_call" || !o.name) continue;
    let input: unknown = {};
    try { input = JSON.parse(o.arguments || "{}"); } catch { /* left empty */ }
    content.push({ type: "tool_use", id: o.call_id || `call_${randomUUID()}`, name: o.name, input });
  }
  const u = done.usage ?? {};
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  return {
    content: content as TurnResult["content"],
    stop: content.some((b) => b.type === "tool_use") ? "tool_use" : done.incomplete_details?.reason === "max_output_tokens" ? "max_tokens" : "end_turn",
    usage: { input: (u.input_tokens ?? 0) - cached, output: u.output_tokens ?? 0, cached, written: 0 },
  };
}
