import { afterEach, describe, expect, it } from "vitest";
import { Plan } from "../../server/agent.ts";
import { transcribe, voiceService } from "../../server/voice.ts";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe("agents", () => {
  it("accepts only the crew's own actions", () => {
    expect(Plan.parse({ say: "ok", steps: [{ agent: "scout", do: "search", query: "jazz" }] }).steps).toHaveLength(1);
    expect(() => Plan.parse({ steps: [{ agent: "scout", do: "buy", query: "x" }] })).toThrow();
    expect(() => Plan.parse({ steps: [{ agent: "hacker", do: "open", url: "https://a.b" }] })).toThrow();
  });
});

describe("voice", () => {
  it("listens with the first service that has a key, or the one chosen", () => {
    delete process.env.OPENAI_API_KEY; delete process.env.GROQ_API_KEY; delete process.env.AETHERDECK_VOICE;
    process.env.GEMINI_API_KEY = "g";
    expect(voiceService()?.id).toBe("gemini");
    process.env.GROQ_API_KEY = "q";
    expect(voiceService()?.id).toBe("groq");
    process.env.AETHERDECK_VOICE = "gemini";
    expect(voiceService()?.id).toBe("gemini");
  });

  it("sends a recording to Whisper and returns its words", async () => {
    delete process.env.AETHERDECK_VOICE; delete process.env.GEMINI_API_KEY; delete process.env.GROQ_API_KEY;
    process.env.OPENAI_API_KEY = "k";
    let seen = "";
    const fake = (async (url: string, init: RequestInit) => {
      seen = `${url} ${(init.body as FormData).get("model")}`;
      return new Response(JSON.stringify({ text: " open youtube " }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await transcribe({ audio: "A".repeat(200) }, fake);
    expect(r).toEqual({ text: "open youtube", by: "Whisper (OpenAI)" });
    expect(seen).toBe("https://api.openai.com/v1/audio/transcriptions gpt-4o-mini-transcribe");
  });

  it("says what to do when no service has a key", async () => {
    delete process.env.OPENAI_API_KEY; delete process.env.GROQ_API_KEY; delete process.env.GEMINI_API_KEY; delete process.env.AETHERDECK_VOICE;
    await expect(transcribe({ audio: "A".repeat(200) })).rejects.toThrow(/OpenWhispr/);
  });
});
