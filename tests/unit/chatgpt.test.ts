import { describe, expect, it } from "vitest";
import { chatgptTurn, setChatGPT, toItems } from "../../server/chatgpt.ts";

describe("ChatGPT plan", () => {
  it("turns an agent's conversation into Responses items", () => {
    const items = toItems([
      { role: "user", content: "Task: find it" },
      { role: "assistant", content: [{ type: "text", text: "Looking" }, { type: "tool_use", id: "c1", name: "fetch_page", input: { url: "https://a.test" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "page text" }] },
    ]);
    expect(items.map((i) => i.type)).toEqual(["message", "message", "function_call", "function_call_output"]);
    expect(items[2]).toMatchObject({ call_id: "c1", name: "fetch_page", arguments: '{"url":"https://a.test"}' });
    expect(items[3]).toMatchObject({ call_id: "c1", output: "page text" });
  });

  it("sends store false and stream true, and reads tool calls from the finished stream", async () => {
    setChatGPT({ ready: () => true, token: async () => "tok" });
    let sent: Record<string, unknown> = {};
    const done = { type: "response.completed", response: { output: [{ type: "function_call", call_id: "x9", name: "think", arguments: '{"thought":"hm"}' }], usage: { input_tokens: 10, output_tokens: 3, input_tokens_details: { cached_tokens: 4 } } } };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(`event: response.created\ndata: {"type":"response.created"}\n\nevent: response.completed\ndata: ${JSON.stringify(done)}\n\n`, { status: 200 });
    }) as unknown as typeof fetch;
    const r = await chatgptTurn("gpt-6.1-sol", "sys", [{ name: "think", description: "d", input_schema: { type: "object", properties: {} } }], [{ role: "user", content: "hi" }], fetchImpl);
    expect(sent).toMatchObject({ store: false, stream: true, instructions: "sys" });
    expect(sent).not.toHaveProperty("temperature");
    expect(r.stop).toBe("tool_use");
    expect(r.content[0]).toMatchObject({ type: "tool_use", id: "x9", name: "think", input: { thought: "hm" } });
    expect(r.usage).toMatchObject({ input: 6, output: 3, cached: 4 });
    setChatGPT(null);
  });

  it("explains a reached plan limit", async () => {
    setChatGPT({ ready: () => true, token: async () => "tok" });
    const fetchImpl = (async () => new Response('{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}', { status: 429 })) as unknown as typeof fetch;
    await expect(chatgptTurn("m", "s", [], [{ role: "user", content: "hi" }], fetchImpl)).rejects.toThrow(/share of your ChatGPT plan/);
    setChatGPT(null);
  });
});
