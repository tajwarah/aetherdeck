// The assistant behind file analysis and "ask about this page": one question about material the person handed
// over, answered by their chosen model. The material is sent only with the question, never kept here.
import { z } from "zod/v4";
import { getBackend, type Part } from "./models.ts";

export const AssistRequest = z.object({
  question: z.string().trim().min(1).max(4000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(20_000) })).max(16).default([]),
  material: z.object({
    name: z.string().max(300),
    /** "page" is a web page's text; the rest are files the person dropped or chose. */
    kind: z.enum(["text", "pdf", "image", "sheet", "page"]),
    url: z.string().max(4000).optional(),
    text: z.string().max(2_000_000).optional(),
    mime: z.string().max(100).optional(),
    /** Base64 of the file itself, for images and for PDFs whose text could not be read. */
    data: z.string().max(22_000_000).optional(),
  }).optional(),
});
export type AssistRequest = z.infer<typeof AssistRequest>;

const TEXT_LIMIT = 180_000; // characters of material per question, roughly 45k tokens

const SYSTEM =
  "You are the assistant inside Horus, a web browser. The person may attach a file or a web page. " +
  "When the question is about the attached material, answer from that material only, and say plainly when it does not contain the answer. " +
  "Never invent quotes, numbers, sources or links. When you quote, quote exactly. " +
  "Write for a busy reader: a one-line answer first, then short sections or bullet points in Markdown. Keep it under 350 words unless asked for more.";

export async function assist(req: AssistRequest): Promise<{ answer: string; model: string; truncated: boolean }> {
  const b = getBackend();
  if (!b) throw Object.assign(new Error("No AI model is connected. Connect one in Settings."), { status: 503 });
  const parts: Part[] = [];
  let truncated = false;
  const m = req.material;
  if (m) {
    if (m.data && b.vision && m.kind === "image" && m.mime) parts.push({ type: "image", mime: m.mime, data: m.data });
    if (m.data && b.vision && m.kind === "pdf") parts.push({ type: "pdf", name: m.name, data: m.data });
    if (m.text) {
      truncated = m.text.length > TEXT_LIMIT;
      const label = m.kind === "page" ? `Web page “${m.name}”${m.url ? ` (${m.url})` : ""}` : `File “${m.name}”`;
      parts.push({ type: "text", text: `<material>\n${label}${truncated ? " — only the first part is included" : ""}:\n\n${m.text.slice(0, TEXT_LIMIT)}\n</material>` });
    }
    if (!m.text && !(m.data && b.vision)) {
      throw Object.assign(new Error(m.kind === "image" ? "The connected model can't look at images. Choose a model that can in Settings." : "No readable text was found in this file."), { status: 422 });
    }
  }
  parts.push({ type: "text", text: req.question });
  const answer = await b.ask(SYSTEM, req.history, parts, 3000);
  return { answer: answer || "The model returned an empty answer. Try asking again.", model: b.label(), truncated };
}
