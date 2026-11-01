import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { brainTurn, callsInText, compact, listBrains, toBlocks, toChat } from "../../server/brains.ts";
import { AgentTurn, toolsFor } from "../../server/claude.ts";

const tools = [{ name: "read_page", description: "Read", input_schema: { type: "object", properties: {} } }] as Anthropic.Tool[];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const talk = [
  { role: "user", content: "Task: read it" },
  { role: "assistant", content: [{ type: "text", text: "Reading" }, { type: "tool_use", id: "c1", name: "read_page", input: { window: "a" } }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "page text" }] },
];

afterEach(() => vi.unstubAllEnvs());

describe("speaking to models other than Claude", () => {
  it("translates a conversation to the OpenAI shape", () => {
    expect(toChat("sys", talk)).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "Task: read it" },
      { role: "assistant", content: "Reading", tool_calls: [{ id: "c1", type: "function", function: { name: "read_page", arguments: '{"window":"a"}' } }] },
      { role: "tool", tool_call_id: "c1", content: "page text" },
    ]);
  });
  it("translates it to Ollama's shape, with arguments as an object", () => {
    const m = toChat("sys", talk, true);
    expect(m[2].tool_calls).toEqual([{ function: { name: "read_page", arguments: { window: "a" } } }]);
    expect(m[3]).toEqual({ role: "tool", tool_name: "read_page", content: "page text" });
  });
  it("leaves Claude's thinking out of what other models see", () => {
    expect(JSON.stringify(toChat("s", [{ role: "assistant", content: [{ type: "thinking", text: "secret" }, { type: "text", text: "Hi" }] }]))).not.toContain("secret");
  });
  it("shortens old tool results but keeps recent ones whole", () => {
    const long = "x".repeat(2000);
    const many = Array.from({ length: 8 }, () => ({ role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: long }] }));
    const out = compact(many) as { content: { content: string }[] }[];
    expect(out[0].content[0].content.length).toBeLessThan(600);
    expect(out[7].content[0].content).toBe(long);
  });
  it("turns a reply into blocks", () => {
    expect(toBlocks("<think>hm</think>Done", [], "stop", tools)).toEqual({ content: [{ type: "text", text: "Done" }], stop: "end_turn" });
    expect(toBlocks("cut", [], "length", tools).stop).toBe("max_tokens");
  });
  it("rescues a tool call a small model wrote as text", () => {
    expect(callsInText('<tool_call>{"name":"read_page","arguments":{"window":"a"}}</tool_call>', tools)[0]).toMatchObject({ name: "read_page", input: { window: "a" } });
    expect(callsInText('{"name":"read_page","parameters":{}}', tools)[0]).toMatchObject({ name: "read_page" });
    expect(callsInText('{"name":"wipe_disk","arguments":{}}', tools)).toEqual([]);
    expect(callsInText("Just words", tools)).toEqual([]);
  });
});

describe("Ollama", () => {
  it("runs a turn with room for an agent's context", async () => {
    const f = vi.fn(async () => json({ message: { content: "", tool_calls: [{ function: { name: "read_page", arguments: { window: "a" } } }] }, done_reason: "stop", prompt_eval_count: 50, prompt_eval_cached_count: 10, eval_count: 7 }));
    const r = await brainTurn("ollama", "qwen3", "sys", tools, talk, 1000, f as never);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "qwen3", stream: true, think: true });
    expect(body.options.num_ctx).toBeGreaterThanOrEqual(16_000);
    expect(r.stop).toBe("tool_use");
    expect(r.content[0]).toMatchObject({ type: "tool_use", name: "read_page", input: { window: "a" } });
    expect(r.usage).toEqual({ input: 40, output: 7, cached: 10, written: 0 });
  });
  it("joins a streamed answer and its token counts", async () => {
    const lines = [{ message: { content: "Hel" } }, { message: { content: "lo" } }, { message: { content: "" }, done_reason: "stop", prompt_eval_count: 9, eval_count: 2 }];
    const f = async () => new Response(`${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    const r = await brainTurn("ollama", "m", "s", [], talk, 1, f as never);
    expect(r.content).toEqual([{ type: "text", text: "Hello" }]);
    expect(r.usage).toMatchObject({ input: 9, output: 2 });
  });
  it("keeps reasoning out of the answer, and copes with models that can't separate it", async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => (JSON.parse(init.body as string).think ? json({ error: "plain does not support thinking" }, 400) : json({ message: { content: "Hi" } })));
    const r = await brainTurn("ollama", "plain", "s", [], talk, 1, f as never);
    expect(r.content).toEqual([{ type: "text", text: "Hi" }]);
    expect(f).toHaveBeenCalledTimes(2);
    await brainTurn("ollama", "plain", "s", [], talk, 1, f as never);
    expect(f).toHaveBeenCalledTimes(3); // it's only asked once
    const t = await brainTurn("ollama", "deep", "s", [], talk, 1, (async () => json({ message: { thinking: "private", content: "Answer" } })) as never);
    expect(t.content).toEqual([{ type: "text", text: "Answer" }]);
  });
  it("does a repeated call once, but keeps different ones", async () => {
    const twice = { function: { name: "read_page", arguments: { window: "a" } } };
    const f = async () => json({ message: { tool_calls: [twice, twice, { function: { name: "read_page", arguments: { window: "b" } } }] } });
    const r = await brainTurn("ollama", "m", "s", tools, talk, 1, f as never);
    expect(r.content).toHaveLength(2);
  });
  it("reports an error that arrives mid-answer", async () => {
    await expect(brainTurn("ollama", "m", "s", [], talk, 1, (async () => new Response('{"error":"out of memory"}\n')) as never)).rejects.toThrow(/out of memory/);
  });
  it("gives each tool call its own id across turns", async () => {
    const f = async () => json({ message: { tool_calls: [{ function: { name: "read_page", arguments: {} } }] } });
    const [a, b] = await Promise.all([brainTurn("ollama", "m", "s", tools, talk, 1, f as never), brainTurn("ollama", "m", "s", tools, talk, 1, f as never)]);
    expect(a.content[0].id).not.toBe(b.content[0].id);
  });
  it("uses the key and ollama.com for cloud models", async () => {
    vi.stubEnv("OLLAMA_API_KEY", "k");
    const f = vi.fn(async () => json({ message: { content: "Hi" }, done_reason: "stop" }));
    await brainTurn("ollama-cloud", "gemma4:31b", "s", [], talk, 1, f as never);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ollama.com/api/chat");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string).options).toBeUndefined();
  });
  it("explains the usual failures in plain words", async () => {
    const run = (f: unknown, p = "ollama") => brainTurn(p, "tiny", "s", tools, talk, 1, f as never);
    await expect(run(async () => { throw new TypeError("refused"); })).rejects.toThrow(/isn't running/);
    await expect(run(async () => json({ error: "tiny does not support tools" }, 400))).rejects.toThrow(/can't use tools/);
    await expect(run(async () => json({ error: "model not found" }, 404))).rejects.toThrow(/ollama pull tiny/);
    vi.stubEnv("OLLAMA_API_KEY", "k");
    await expect(run(async () => json({ error: "no" }, 401), "ollama-cloud")).rejects.toThrow(/did not accept/);
    await expect(run(async () => json({ error: "no" }, 429), "ollama-cloud")).rejects.toThrow(/usage limit/);
    await expect(run(async () => json({ error: "no" }, 402))).rejects.toThrow(/free plan/);
  });
});

describe("OpenAI-style providers", () => {
  it("runs a turn and counts cached tokens", async () => {
    vi.stubEnv("GROQ_API_KEY", "k");
    const f = vi.fn(async () => json({ choices: [{ message: { content: null, tool_calls: [{ id: "x1", function: { name: "read_page", arguments: '{"window":"a"}' } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 30, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 10 } } }));
    const r = await brainTurn("groq", "m", "s", tools, talk, 1000, f as never);
    expect(r.content[0]).toMatchObject({ id: "x1", input: { window: "a" } });
    expect(r.usage).toEqual({ input: 20, output: 4, cached: 10, written: 0 });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).tools[0].function.name).toBe("read_page");
  });
  it("asks for a key that isn't there", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    await expect(brainTurn("groq", "m", "s", tools, talk, 1)).rejects.toThrow(/Add your Groq key/);
  });
  it("gives every skill's tools to any model in a valid shape", () => {
    expect(toolsFor({ access: "auto", skills: ["harvest", "mail", "video", "build"] }).length).toBeGreaterThan(15);
    expect(AgentTurn.parse({ agent: { name: "A", task: "t", provider: "ollama", model: "qwen3" }, messages: [{ role: "user", content: "x" }] }).agent.provider).toBe("ollama");
    expect(() => AgentTurn.parse({ agent: { name: "A", task: "t", provider: "http://evil.test", model: "m" }, messages: [{ role: "user", content: "x" }] })).toThrow();
  });
});

describe("listing what agents can think with", () => {
  it("offers only tool-capable local models, and says how to connect the rest", async () => {
    for (const k of ["OLLAMA_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) vi.stubEnv(k, "");
    const f = async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/tags")) return json({ models: [{ name: "qwen3" }, { name: "embed" }] });
      if (url.endsWith("/api/show")) return json({ capabilities: JSON.parse(init!.body as string).model === "qwen3" ? ["completion", "tools"] : ["embedding"] });
      throw new Error("offline");
    };
    const brains = await listBrains(f as never);
    expect(brains[0]).toMatchObject({ id: "ollama", cost: "local", ready: true, models: [{ id: "qwen3" }] });
    expect(brains.find((b) => b.id === "anthropic")).toMatchObject({ ready: false, cost: "paid" });
    expect(brains.find((b) => b.id === "ollama-cloud")?.note).toMatch(/Add an Ollama key/);
  });
  it("labels a cloud model the local Ollama offers", async () => {
    const f = async (url: string) => (url.endsWith("/api/tags") ? json({ models: [{ name: "gemma4:31b-cloud" }] }) : url.endsWith("/api/show") ? json({ capabilities: ["tools"] }) : Promise.reject(new Error("offline")));
    expect((await listBrains(f as never))[0].models[0].name).toMatch(/Ollama's cloud/);
  });
  it("says how to start when Ollama isn't installed", async () => {
    const brains = await listBrains((async () => { throw new Error("no"); }) as never);
    expect(brains[0]).toMatchObject({ ready: false });
    expect(brains[0].note).toMatch(/Install Ollama/);
  });
});
