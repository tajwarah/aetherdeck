// Model backends for the AI layer. Every backend answers one question: "return JSON matching this schema".
// Anthropic uses native structured outputs; everything else speaks the OpenAI-compatible chat API,
// which free tiers (OpenRouter :free models, Groq, Google Gemini, Moonshot/Kimi) all expose.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { totalmem } from "node:os";
import { log } from "./log.ts";
import { CHATGPT_DEFAULT, chatgptBackend, chatgptReady } from "./chatgpt.ts";

/** One piece of what the person hands the assistant: text, an image, or a PDF the model can read itself. */
export type Part = { type: "text"; text: string } | { type: "image"; mime: string; data: string } | { type: "pdf"; name: string; data: string };
export interface Turn { role: "user" | "assistant"; text: string }

export interface ModelBackend {
  provider: string;
  /** Human-readable, shown in the UI: which model, from whom, free or paid. */
  label: () => string;
  free: boolean;
  /** Whether the model can be handed images and PDFs directly (otherwise it gets the extracted text only). */
  vision: boolean;
  json<T>(schema: z.ZodType<T>, system: string, user: string, maxTokens: number): Promise<T | null>;
  /** A plain answer to a conversation whose last turn carries the parts. */
  ask(system: string, history: Turn[], parts: Part[], maxTokens: number): Promise<string>;
}

// --- Anthropic ------------------------------------------------------------------

function anthropicBackend(): ModelBackend {
  const model = process.env.LLM_MODEL || process.env.AETHERDECK_MODEL || "claude-opus-5-5";
  const client = new Anthropic({ timeout: 25_000, maxRetries: 1 });
  const slow = new Anthropic({ timeout: 120_000, maxRetries: 1 });
  return {
    provider: "anthropic",
    free: false,
    vision: true,
    label: () => `${model} (Anthropic)`,
    async ask(system, history, parts, maxTokens) {
      const content: Anthropic.ContentBlockParam[] = parts.map((p) =>
        p.type === "text" ? { type: "text", text: p.text }
        : p.type === "image" ? { type: "image", source: { type: "base64", media_type: p.mime as "image/png", data: p.data } }
        : { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.data }, title: p.name });
      const message = await slow.messages.stream({
        model,
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        system,
        messages: [...history.map((t) => ({ role: t.role, content: t.text })), { role: "user", content }],
      }).finalMessage();
      if (message.stop_reason === "refusal") throw new Error("The model declined to answer this.");
      return message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    },
    async json(schema, system, user, maxTokens) {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(schema) },
        system,
        messages: [{ role: "user", content: user }],
      });
      if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
        log("warn", "llm_incomplete", { stop: response.stop_reason });
        return null;
      }
      return (response.parsed_output as never) ?? null;
    },
  };
}

// --- OpenAI-compatible ----------------------------------------------------------

export interface CompatPreset {
  label: string;
  baseUrl: string;
  keyEnv: string;
  free: boolean;
  /** Used when LLM_MODEL is unset and the model list can't be read. */
  defaultModel?: string;
  headers?: Record<string, string>;
  /** Tried in order when the current model is overloaded (5xx) or retired (404). */
  fallbackModels?: string[];
  /** Extra request fields, e.g. keeping reasoning short so it doesn't eat the output budget. */
  extraBody?: Record<string, unknown>;
  /** Newer OpenAI models take max_completion_tokens and only their default temperature. */
  completionTokens?: boolean;
  /** Models to prefer when choosing from the live list. */
  prefer?: RegExp[];
  /** Accepts images (and, for OpenAI, PDFs) in messages. */
  vision?: boolean;
}

export const PRESETS: Record<string, CompatPreset> = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", free: false, completionTokens: true, vision: true, prefer: [/^gpt-5(\.\d+)?-mini$/, /^gpt-5(\.\d+)?$/, /^gpt-4\.1-mini$/, /^gpt-4o-mini$/] },
  // Free models end in ":free"; the roster changes often, so one is picked from the live list.
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", free: true, headers: { "X-Title": "AetherDeck" } },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", free: true, defaultModel: "openai/gpt-oss-120b" },
  gemini: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY", free: true, defaultModel: "gemini-3-flash-preview", fallbackModels: ["gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-flash-latest"], extraBody: { reasoning_effort: "low" }, vision: true },
  moonshot: { label: "Moonshot (Kimi)", baseUrl: "https://api.moonshot.ai/v1", keyEnv: "MOONSHOT_API_KEY", free: false },
  lmstudio: { label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", keyEnv: "", free: true },
  custom: { label: "Custom endpoint", baseUrl: "", keyEnv: "LLM_API_KEY", free: false },
};

/** Preference order when choosing a model automatically: Kimi first, then strong open models. */
const PREFERENCE = [/kimi/i, /deepseek/i, /qwen3/i, /gpt-oss-120b/i, /nemotron-3-ultra/i, /nemotron-3\.5-super/i, /gemma-4-31b/i, /llama-4/i, /gpt-oss/i];
const AVOID = /(safety|guard|embed|tts|whisper|vision-only|audio|code)/i;

export function pickModel(models: { id: string; supported_parameters?: string[] }[], freeOnly: boolean, prefer = PREFERENCE): string | undefined {
  const usable = models.filter((m) => (!freeOnly || m.id.endsWith(":free")) && !AVOID.test(m.id));
  for (const re of prefer) {
    const hits = usable.filter((m) => re.test(m.id));
    const structured = hits.find((m) => m.supported_parameters?.includes("structured_outputs") || m.supported_parameters?.includes("response_format"));
    if (structured ?? hits[0]) return (structured ?? hits[0]).id;
  }
  return usable.find((m) => m.supported_parameters?.includes("response_format"))?.id ?? usable[0]?.id;
}

/** Pulls the first JSON object out of a model reply (handles ``` fences and <think> blocks). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("No JSON object in reply");
  let depth = 0;
  let inString = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
  }
  throw new Error("Unterminated JSON object in reply");
}

const ChatResponse = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional() }), finish_reason: z.string().nullable().optional() })).min(1),
});

export function compatBackend(presetName: string, preset: CompatPreset, apiKey: string, fetchImpl: typeof fetch = fetch): ModelBackend {
  const baseUrl = ((presetName === "custom" || presetName === "lmstudio") && process.env.LLM_BASE_URL || preset.baseUrl).replace(/\/$/, "");
  let model: string | undefined = process.env.LLM_MODEL || preset.defaultModel;
  let modelInfo: { supported_parameters?: string[] } | undefined;
  let resolving: Promise<string> | null = null;
  let jsonMode: "schema" | "object" | "none" = "schema"; // degrade once if the endpoint rejects a mode

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...(preset.headers ?? {}) };

  async function resolveModel(): Promise<string> {
    if (model) return model;
    if (preset.defaultModel) return (model = preset.defaultModel); // providers with a known-good default skip discovery
    resolving ??= (async () => {
      try {
        const res = await fetchImpl(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(8000) });
        const body = (await res.json()) as { data?: { id: string; supported_parameters?: string[] }[] };
        const list = body.data ?? [];
        const chosen = pickModel(list, presetName === "openrouter", preset.prefer);
        if (chosen) {
          modelInfo = list.find((m) => m.id === chosen);
          log("info", "llm_model_selected", { provider: presetName, model: chosen });
          return (model = chosen);
        }
      } catch (err) {
        log("warn", "llm_model_list_failed", { provider: presetName, error: (err as Error).message });
      }
      if (preset.defaultModel) return (model = preset.defaultModel);
      resolving = null;
      throw new Error(`No model available from ${preset.label}; set LLM_MODEL`);
    })();
    return resolving;
  }

  const limits = (n: number) => (preset.completionTokens ? { max_completion_tokens: n } : { max_tokens: n, temperature: 0.2 });

  async function call(body: Record<string, unknown>, timeout = 25_000) {
    try {
      const res = await fetchImpl(`${baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
      const text = await res.text();
      return { status: res.status, text };
    } catch (err) {
      // A hung model is treated like an overloaded one, so the fallback chain can move on.
      if ((err as Error).name === "TimeoutError" || (err as Error).name === "AbortError") return { status: 504, text: "timed out" };
      throw err;
    }
  }

  return {
    provider: presetName,
    free: preset.free,
    vision: Boolean(preset.vision),
    label: () => `${model ?? "auto"} (${preset.label}${preset.free ? ", free tier" : ""})`,
    async ask(system, history, parts, maxTokens) {
      const m = await resolveModel();
      const content = parts.flatMap<Record<string, unknown>>((p) =>
        p.type === "text" ? [{ type: "text", text: p.text }]
        : !preset.vision ? []
        : p.type === "image" ? [{ type: "image_url", image_url: { url: `data:${p.mime};base64,${p.data}` } }]
        : presetName === "openai" ? [{ type: "file", file: { filename: p.name, file_data: `data:application/pdf;base64,${p.data}` } }] : []);
      const messages = [{ role: "system", content: system }, ...history.map((t) => ({ role: t.role, content: t.text })), { role: "user", content }];
      // Free quotas are per model: when one is spent or overloaded, try the next.
      const tries = [m, ...(process.env.LLM_MODEL ? [] : preset.fallbackModels ?? []).filter((x) => x !== m)];
      let status = 0;
      let text = "";
      for (const id of tries) {
        ({ status, text } = await call({ model: id, messages, ...limits(maxTokens), ...(preset.extraBody ?? {}) }, 120_000));
        if (status !== 429 && status !== 404 && status < 500) break;
        log("warn", "llm_model_fallback", { provider: presetName, from: id, status });
      }
      if (status === 429) throw new Error(`${preset.label} rate limit reached (free tiers have daily caps). Try again later or choose another model in Settings.`);
      if (status === 401 || status === 403) throw new Error(`${preset.label} did not accept the API key`);
      if (status >= 400) throw new Error(`${preset.label} answered HTTP ${status}: ${text.slice(0, 160)}`);
      const parsed = ChatResponse.safeParse(JSON.parse(text));
      return parsed.success ? (parsed.data.choices[0].message.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim() : "";
    },
    async json(schema, system, user, maxTokens) {
      let m = await resolveModel();
      const spare = [...(process.env.LLM_MODEL ? [] : preset.fallbackModels ?? [])].filter((x) => x !== m);
      let retried5xx = false;
      const jsonSchema = z.toJSONSchema(schema);
      const messages = [
        {
          role: "system",
          content: `${system}\n\nReply with a single JSON object and nothing else. It must validate against this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
        },
        { role: "user", content: user },
      ];
      for (let attempt = 0; attempt < 2; attempt++) {
        const body: Record<string, unknown> = { model: m, messages, ...limits(maxTokens), ...(preset.extraBody ?? {}) };
        if (jsonMode === "schema" && (presetName !== "openrouter" || modelInfo?.supported_parameters?.includes("structured_outputs"))) {
          body.response_format = { type: "json_schema", json_schema: { name: "result", strict: false, schema: jsonSchema } };
        } else if (jsonMode !== "none") {
          body.response_format = { type: "json_object" };
        }
        const { status, text } = await call(body);
        if (status === 400 && jsonMode !== "none" && /response_format|json_schema|json_object|structured/i.test(text)) {
          jsonMode = jsonMode === "schema" ? "object" : "none"; // endpoint doesn't support that mode: fall back and retry
          attempt--;
          continue;
        }
        if (status >= 500 && !retried5xx) {
          retried5xx = true; // overloaded free tiers often recover within a second or two
          await new Promise((r) => setTimeout(r, 1500));
          attempt--;
          continue;
        }
        if ((status >= 500 || status === 404 || status === 429) && spare.length) { // free quotas are per model
          const next = spare.shift()!;
          log("warn", "llm_model_fallback", { provider: presetName, from: m, to: next, status });
          m = model = next;
          retried5xx = false;
          body.model = m;
          attempt--;
          continue;
        }
        if (status === 429) throw new Error(`${preset.label} rate limit reached (free tiers have daily caps)`);
        if (status >= 400) throw new Error(`${preset.label} answered HTTP ${status}: ${text.slice(0, 160)}`);
        const parsed = ChatResponse.safeParse(JSON.parse(text));
        const content = parsed.success ? parsed.data.choices[0].message.content ?? "" : "";
        try {
          const result = schema.safeParse(extractJson(content));
          if (result.success) return result.data;
          // One repair round: show the model what failed validation.
          messages.push({ role: "assistant", content }, { role: "user", content: `That JSON did not match the schema: ${z.prettifyError(result.error).slice(0, 600)}. Reply with corrected JSON only.` });
        } catch (err) {
          messages.push({ role: "assistant", content }, { role: "user", content: `${(err as Error).message}. Reply with the JSON object only.` });
        }
      }
      log("warn", "llm_invalid_json", { provider: presetName, model: m });
      return null;
    },
  };
}

// --- Ollama ---------------------------------------------------------------------

/** Room for an agent's tools and a few pages, as much as the computer can hold. Ollama's own default is only 4k on most. */
const CONTEXT = Number(process.env.OLLAMA_NUM_CTX) || (totalmem() > 48 * 2 ** 30 ? 65_536 : totalmem() > 24 * 2 ** 30 ? 32_768 : 16_384);
export const ollamaUrl = () => (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_CLOUD = "https://ollama.com";
/** Loading a model and reading a long prompt can take minutes on a small computer before the first word. */
export const THINK_TIME = 240_000;

/** Models that have said they can't separate their reasoning. Everything else is asked to, so it stays out of answers. */
const NO_THINKING = new Set<string>();

export interface OllamaReply { message: { content: string; tool_calls: { function: { name: string; arguments: Record<string, unknown> | string } }[] }; done_reason?: string; prompt_eval_count?: number; prompt_eval_cached_count?: number; eval_count?: number }

/** Ollama's own chat API, on this computer or at ollama.com. Unlike its OpenAI route, it can set the context size.
 *  The answer is streamed so a slow computer isn't mistaken for a stuck one: only `idle` ms with no new words gives up. */
export async function ollamaChat(cloud: boolean, body: Record<string, unknown>, idle: number, fetchImpl: typeof fetch = fetch): Promise<OllamaReply> {
  const model = String(body.model);
  try {
    return await ollamaStream(cloud, NO_THINKING.has(model) ? body : { ...body, think: true }, idle, fetchImpl);
  } catch (err) {
    if (NO_THINKING.has(model) || !/does not support thinking/i.test((err as Error).message)) throw err;
    NO_THINKING.add(model);
    return ollamaStream(cloud, body, idle, fetchImpl);
  }
}

async function ollamaStream(cloud: boolean, body: Record<string, unknown>, idle: number, fetchImpl: typeof fetch): Promise<OllamaReply> {
  const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
  const stop = new AbortController();
  let timer = setTimeout(() => stop.abort(), idle);
  const alive = () => { clearTimeout(timer); timer = setTimeout(() => stop.abort(), idle); };
  const stalled = () => fail(504, "The model stopped answering. A smaller model may suit this computer better.");
  try {
    let res: Response;
    try {
      res = await fetchImpl(`${cloud ? OLLAMA_CLOUD : ollamaUrl()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(cloud ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : {}) },
        body: JSON.stringify({ stream: true, ...body, ...(cloud ? {} : { options: { num_ctx: CONTEXT } }) }),
        signal: stop.signal,
      });
    } catch {
      if (stop.signal.aborted) throw stalled();
      throw fail(503, cloud ? "Ollama Cloud can't be reached." : "Ollama isn't running. Open the Ollama app and try again.");
    }
    if (!res.ok) {
      const text = await res.text();
      const error = (() => { try { return String((JSON.parse(text) as { error?: string }).error ?? text); } catch { return text; } })().slice(0, 200);
      if (res.status === 401 || res.status === 403) throw fail(res.status, "Ollama Cloud did not accept the API key.");
      if (res.status === 429) throw fail(429, "You've reached Ollama Cloud's usage limit. See ollama.com/settings/usage.");
      if (res.status === 402) throw fail(402, `${body.model} isn't in Ollama's free plan. Choose a free model such as gemma4:31b-cloud, or add credit at ollama.com/settings.`);
      if (/does not support tools/i.test(error)) throw fail(400, `${body.model} can't use tools, so it can't run agents. Choose a model with tool support, such as qwen3.`);
      if (res.status === 404) throw fail(404, cloud ? `Ollama Cloud doesn't offer ${body.model}.` : `${body.model} isn't on this computer. Run: ollama pull ${body.model}`);
      throw fail(res.status >= 500 ? 502 : res.status, `Ollama answered: ${error}`);
    }
    const reply: OllamaReply = { message: { content: "", tool_calls: [] } };
    const take = (line: string) => {
      if (!line.trim()) return;
      const part = JSON.parse(line) as Partial<Omit<OllamaReply, "message">> & { message?: { content?: string; tool_calls?: OllamaReply["message"]["tool_calls"] }; error?: string };
      if (part.error) throw fail(502, `Ollama answered: ${part.error.slice(0, 200)}`);
      reply.message.content += part.message?.content ?? "";
      reply.message.tool_calls.push(...(part.message?.tool_calls ?? []));
      Object.assign(reply, { done_reason: part.done_reason ?? reply.done_reason, prompt_eval_count: part.prompt_eval_count ?? reply.prompt_eval_count, prompt_eval_cached_count: part.prompt_eval_cached_count ?? reply.prompt_eval_cached_count, eval_count: part.eval_count ?? reply.eval_count });
    };
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let rest = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        alive();
        rest += decoder.decode(value, { stream: true });
        const lines = rest.split("\n");
        rest = lines.pop()!;
        lines.forEach(take);
      }
    } catch (err) {
      if (stop.signal.aborted) throw stalled();
      throw err;
    }
    take(rest);
    return reply;
  } finally { clearTimeout(timer); }
}

const noThink = (text = "") => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

function ollamaBackend(cloud: boolean, fetchImpl: typeof fetch = fetch): ModelBackend {
  const label = cloud ? "Ollama Cloud" : "Ollama";
  const model = process.env.LLM_MODEL ?? "";
  return {
    provider: cloud ? "ollama-cloud" : "ollama",
    free: !cloud,
    vision: false,
    label: () => `${model || "no model chosen"} (${label}${cloud ? "" : ", on this computer"})`,
    async ask(system, history, parts) {
      const text = parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
      const r = await ollamaChat(cloud, { model, messages: [{ role: "system", content: system }, ...history.map((t) => ({ role: t.role, content: t.text })), { role: "user", content: text }] }, THINK_TIME, fetchImpl);
      return noThink(r.message?.content);
    },
    async json(schema, system, user) {
      const r = await ollamaChat(cloud, { model, format: z.toJSONSchema(schema), messages: [{ role: "system", content: `${system}\n\nReply with a single JSON object and nothing else.` }, { role: "user", content: user }] }, THINK_TIME, fetchImpl);
      try {
        const result = schema.safeParse(extractJson(r.message?.content ?? ""));
        if (result.success) return result.data;
      } catch { /* treated as no answer below */ }
      log("warn", "llm_invalid_json", { provider: label, model });
      return null;
    },
  };
}

// --- selection --------------------------------------------------------------------

function select(): ModelBackend | null {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (explicit === "none") return null;
  // Signing in with ChatGPT is a deliberate choice, so it leads unless another provider was chosen.
  if (explicit === "chatgpt" || (!explicit && chatgptReady())) return chatgptReady() ? chatgptBackend(process.env.LLM_MODEL || CHATGPT_DEFAULT) : null;
  if (explicit === "anthropic" || (!explicit && process.env.ANTHROPIC_API_KEY)) {
    return process.env.ANTHROPIC_API_KEY ? anthropicBackend() : null;
  }
  if (explicit === "ollama") return ollamaBackend(false);
  if (explicit === "ollama-cloud") return process.env.OLLAMA_API_KEY ? ollamaBackend(true) : null;
  if (explicit === "lmstudio") return compatBackend("lmstudio", PRESETS.lmstudio, "lmstudio");
  const order = explicit ? [explicit] : ["openai", "openrouter", "groq", "gemini", "moonshot", "custom"];
  for (const name of order) {
    const preset = PRESETS[name];
    if (!preset) {
      log("warn", "llm_unknown_provider", { provider: name });
      return null;
    }
    const key = process.env[preset.keyEnv] || (explicit ? process.env.LLM_API_KEY : undefined);
    if (!key && !(name === "custom" && explicit && process.env.LLM_BASE_URL)) continue;
    if (name === "custom" && !process.env.LLM_BASE_URL) {
      log("warn", "llm_custom_needs_base_url", {});
      return null;
    }
    return compatBackend(name, preset, key || "none");
  }
  return null;
}

let backend: ModelBackend | null | undefined;
export function getBackend(): ModelBackend | null {
  if (backend === undefined) backend = select();
  return backend;
}

/** Settings changed (a key, the provider or the model): choose again on the next request. */
export function resetBackend() { backend = undefined; }

/** The providers a person can connect in Settings, with the key each one needs. */
export const AI_PROVIDERS = [
  { id: "anthropic", label: "Anthropic Claude", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY" },
  { id: "openrouter", label: "OpenRouter", keyEnv: "OPENROUTER_API_KEY" },
  { id: "groq", label: "Groq", keyEnv: "GROQ_API_KEY" },
  { id: "gemini", label: "Google Gemini", keyEnv: "GEMINI_API_KEY" },
  { id: "ollama", label: "Ollama", keyEnv: "" },
  { id: "ollama-cloud", label: "Ollama Cloud", keyEnv: "OLLAMA_API_KEY" },
  { id: "lmstudio", label: "LM Studio", keyEnv: "" },
  { id: "moonshot", label: "Moonshot (Kimi)", keyEnv: "MOONSHOT_API_KEY" },
  { id: "custom", label: "Custom endpoint", keyEnv: "LLM_API_KEY" },
] as const;

const CHAT_MODEL = /^(gpt-|o\d|chatgpt-)/;
const NOT_CHAT = /(audio|realtime|tts|transcribe|image|embedding|search|moderation|instruct|codex|computer-use|dall-e|whisper|-\d{4}-\d{2}-\d{2}$)/;

/** The models this key can use, newest first, for the model picker. Also proves the key works. */
export async function listModels(provider: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<{ id: string; name: string }[]> {
  if (provider === "ollama" || provider === "ollama-cloud") {
    const cloud = provider === "ollama-cloud";
    let res: Response;
    try {
      res = await fetchImpl(`${cloud ? OLLAMA_CLOUD : ollamaUrl()}/api/tags`, { headers: cloud ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(cloud ? 15_000 : 3000) });
    } catch { throw new Error(cloud ? "Ollama Cloud can't be reached" : "Ollama isn't running on this computer"); }
    if (res.status === 401 || res.status === 403) throw new Error("Ollama Cloud did not accept that key");
    if (!res.ok) throw new Error(`Ollama answered HTTP ${res.status}`);
    const body = (await res.json()) as { models?: { name: string }[] };
    return (body.models ?? []).map((m) => ({ id: m.name, name: m.name }));
  }
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey, timeout: 15_000, maxRetries: 0 });
    const out: { id: string; name: string }[] = [];
    try {
      for await (const m of client.models.list()) out.push({ id: m.id, name: m.display_name });
    } catch (err) {
      if (err instanceof Anthropic.APIError && (err.status === 401 || err.status === 403)) throw new Error("Anthropic did not accept that key");
      throw err;
    }
    return out;
  }
  const preset = PRESETS[provider];
  if (!preset) throw new Error(`Unknown provider ${provider}`);
  const res = await fetchImpl(`${(provider === "custom" || provider === "lmstudio" ? process.env.LLM_BASE_URL || preset.baseUrl : preset.baseUrl).replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(provider === "lmstudio" ? 3000 : 15_000) }).catch(() => { throw new Error(provider === "custom" ? "That address can't be reached" : `${preset.label} isn't running on this computer`); });
  if (res.status === 401 || res.status === 403) throw new Error(`${preset.label} did not accept that key`);
  if (!res.ok) throw new Error(`${preset.label} answered HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { id: string; name?: string; created?: number }[] };
  let list = body.data ?? [];
  if (provider === "openai") list = list.filter((m) => CHAT_MODEL.test(m.id) && !NOT_CHAT.test(m.id));
  if (provider === "gemini") list = list.map((m) => ({ ...m, id: m.id.replace(/^models\//, "") })).filter((m) => /gemini/.test(m.id) && !/(embedding|tts|image|aqa|live|robotics|translate|computer-use)/.test(m.id));
  return list.sort((a, b) => (b.created ?? 0) - (a.created ?? 0)).map((m) => ({ id: m.id, name: m.name ?? m.id }));
}
