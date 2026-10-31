import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { compatBackend, extractJson, pickModel, PRESETS } from "../../server/models.ts";

const Schema = z.object({ topic: z.string(), count: z.number() });

/** A fake OpenAI-compatible endpoint that replays scripted chat replies and records requests. */
function fakeEndpoint(replies: (string | { status: number; body: string })[], models: unknown[] = []) {
  const requests: { url: string; body?: Record<string, unknown> }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, body });
    if (url.endsWith("/models")) return new Response(JSON.stringify({ data: models }));
    const next = replies.shift() ?? "";
    if (typeof next !== "string") return new Response(next.body, { status: next.status });
    return new Response(JSON.stringify({ choices: [{ message: { content: next }, finish_reason: "stop" }] }));
  }) as typeof fetch;
  return { impl, requests };
}

describe("OpenAI-compatible backend", () => {
  it("prefers Kimi among free OpenRouter models, then strong open models", () => {
    const list = [
      { id: "google/gemma-4-31b-it:free", supported_parameters: ["response_format"] },
      { id: "nvidia/nemotron-3.5-content-safety:free" },
      { id: "moonshotai/kimi-k2:free" },
      { id: "moonshotai/kimi-k3" }, // paid: ignored when free-only
    ];
    expect(pickModel(list, true)).toBe("moonshotai/kimi-k2:free");
    expect(pickModel(list.filter((m) => !m.id.includes("kimi")), true)).toBe("google/gemma-4-31b-it:free");
  });

  it("extracts JSON from fenced or reasoning-wrapped replies", () => {
    expect(extractJson('<think>{"no":1}</think>Here:\n```json\n{"topic":"x {y}","count":2}\n```')).toEqual({ topic: "x {y}", count: 2 });
    expect(() => extractJson("no json")).toThrow();
  });

  it("selects a free model automatically and returns schema-valid output", async () => {
    const { impl, requests } = fakeEndpoint(['{"topic":"quantum","count":3}'], [{ id: "moonshotai/kimi-k2:free", supported_parameters: ["structured_outputs"] }]);
    const b = compatBackend("openrouter", PRESETS.openrouter, "test-key", impl);
    expect(await b.json(Schema, "sys", "user", 100)).toEqual({ topic: "quantum", count: 3 });
    const chat = requests.find((r) => r.url.endsWith("/chat/completions"))!;
    expect(chat.body).toMatchObject({ model: "moonshotai/kimi-k2:free", response_format: { type: "json_schema" } });
    expect(b.label()).toMatch(/kimi-k2:free.*free tier/);
  });

  it("falls back when the endpoint rejects structured output modes", async () => {
    const { impl, requests } = fakeEndpoint([
      { status: 400, body: '{"error":"response_format json_schema not supported"}' },
      '{"topic":"t","count":1}',
    ]);
    process.env.LLM_MODEL = "some-model";
    try {
      const b = compatBackend("groq", PRESETS.groq, "k", impl);
      expect(await b.json(Schema, "s", "u", 50)).toEqual({ topic: "t", count: 1 });
      expect(requests.at(-1)!.body!.response_format).toEqual({ type: "json_object" });
    } finally {
      delete process.env.LLM_MODEL;
    }
  });

  it("repairs one invalid reply, then gives up rather than inventing", async () => {
    const ok = fakeEndpoint(['{"topic":"t"}', '{"topic":"t","count":2}']);
    expect(await compatBackend("gemini", PRESETS.gemini, "k", ok.impl).json(Schema, "s", "u", 50)).toEqual({ topic: "t", count: 2 });
    const bad = fakeEndpoint(["nonsense", "still nonsense"]);
    expect(await compatBackend("gemini", PRESETS.gemini, "k", bad.impl).json(Schema, "s", "u", 50)).toBeNull();
  });

  it("moves to a fallback model when one is overloaded or out of quota", async () => {
    const { impl, requests } = fakeEndpoint([{ status: 429, body: "{}" }, '{"topic":"t","count":1}']);
    expect(await compatBackend("gemini", PRESETS.gemini, "k", impl).json(Schema, "s", "u", 50)).toEqual({ topic: "t", count: 1 });
    expect(requests.map((r) => r.body?.model)).toEqual(["gemini-3-flash-preview", "gemini-3.1-flash-lite"]);
  });

  it("reports free-tier rate limits clearly once fallbacks are exhausted", async () => {
    const { impl } = fakeEndpoint([{ status: 429, body: "{}" }, { status: 429, body: "{}" }, { status: 429, body: "{}" }, { status: 429, body: "{}" }]);
    await expect(compatBackend("gemini", PRESETS.gemini, "k", impl).json(Schema, "s", "u", 50)).rejects.toThrow(/rate limit/);
  });
});
