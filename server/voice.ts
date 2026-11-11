// Speech to text for the agent's one-sentence start: Whisper (OpenAI or Groq), or Gemini, whichever key the
// person has. The recording is sent to that service for this one transcription and kept nowhere.
import { z } from "zod/v4";

export const TranscribeRequest = z.object({
  /** Base64 of a 16 kHz mono WAV recording (the interface converts whatever the microphone gives). */
  audio: z.string().min(100).max(14_000_000),
  language: z.string().max(12).optional(),
});
export type TranscribeRequest = z.infer<typeof TranscribeRequest>;

type Service = "openai" | "groq" | "gemini";
const SERVICES: Record<Service, { label: string; key: string }> = {
  openai: { label: "Whisper (OpenAI)", key: "OPENAI_API_KEY" },
  groq: { label: "Whisper (Groq)", key: "GROQ_API_KEY" },
  gemini: { label: "Gemini", key: "GEMINI_API_KEY" },
};

/** The service that will listen: the one chosen in Settings, else the first with a key. */
export function voiceService(): { id: Service; label: string } | null {
  const chosen = process.env.AETHERDECK_VOICE as Service | undefined;
  // Fastest first: Groq's Whisper answers in well under a second, OpenAI's in about one, Gemini (a chat model) in a few.
  const order: Service[] = chosen && chosen in SERVICES ? [chosen] : ["groq", "openai", "gemini"];
  const id = order.find((s) => process.env[SERVICES[s].key]);
  return id ? { id, label: SERVICES[id].label } : null;
}

export async function transcribe(req: TranscribeRequest, fetchImpl: typeof fetch = fetch): Promise<{ text: string; by: string }> {
  const service = voiceService();
  if (!service) throw Object.assign(new Error("Voice needs an OpenAI, Groq or Gemini key. Add one in Settings, or dictate with an app such as OpenWhispr."), { status: 503 });
  const key = process.env[SERVICES[service.id].key]!;
  const signal = AbortSignal.timeout(45_000);
  if (service.id === "gemini") {
    const res = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.AETHERDECK_VOICE_MODEL || "gemini-flash-lite-latest",
        messages: [{ role: "user", content: [
          { type: "text", text: "Transcribe this speech exactly, in the language spoken. Reply with the words only, nothing else." },
          { type: "input_audio", input_audio: { data: req.audio, format: "wav" } },
        ] }],
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
    if (!res.ok) throw Object.assign(new Error(`Gemini couldn't transcribe: ${body.error?.message ?? res.status}`), { status: 502 });
    return { text: (body.choices?.[0]?.message?.content ?? "").trim(), by: service.label };
  }
  const form = new FormData();
  form.append("file", new Blob([Buffer.from(req.audio, "base64")], { type: "audio/wav" }), "speech.wav");
  form.append("model", process.env.AETHERDECK_VOICE_MODEL || (service.id === "groq" ? "whisper-large-v3-turbo" : "gpt-4o-mini-transcribe"));
  if (req.language) form.append("language", req.language);
  const base = service.id === "groq" ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1";
  const res = await fetchImpl(`${base}/audio/transcriptions`, { method: "POST", signal, headers: { Authorization: `Bearer ${key}` }, body: form });
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
  if (!res.ok) throw Object.assign(new Error(`${service.label} couldn't transcribe: ${body.error?.message ?? res.status}`), { status: 502 });
  return { text: (body.text ?? "").trim(), by: service.label };
}
