// Agent-oriented action preparation. AetherDeck prepares; the person commits.
// Nothing is sent from the server: confirmed actions hand off to the user's own phone, mail app or browser.
import { randomUUID } from "node:crypto";
import type { ActionDraft, ActionDraftRequest, AgentTask } from "../shared/types.ts";
import { draftMessage } from "./llm.ts";

const tasks = new Map<string, AgentTask>(); // in-memory, short-lived: no personal data is persisted

const sentence = (t: string) => (t && !/[.!?]$/.test(t.trim()) ? `${t.trim()}.` : t.trim());

function templateDraft(req: ActionDraftRequest) {
  const { kind, source } = req;
  const details = { ...req.details, need: sentence(req.details.need) };
  const name = details.name?.trim() || "[Your name]";
  if (kind === "prepare_reservation") {
    return {
      subject: `Table request${details.when ? ` — ${details.when}` : ""}`,
      body: `Hello ${source.title},\n\nI'd like to reserve a table for ${details.partySize ?? 2}${details.when ? ` on ${details.when}` : ""}. ${details.need ? `${details.need}\n\n` : ""}Could you let me know if that's possible?\n\nThank you,\n${name}`,
    };
  }
  return {
    subject: `Service request${details.need ? `: ${details.need.slice(0, 50)}` : ""}`,
    body: `Hello ${source.title},\n\n${details.need || "I need help with a repair."}${details.when ? `\n\nI'm hoping for a visit ${details.when}.` : ""}\n\nCould you tell me your availability and an estimate of the cost?\n\nThank you,\n${name}`,
  };
}

export async function prepareAction(req: ActionDraftRequest): Promise<ActionDraft> {
  const { source, details, kind } = req;
  const task: AgentTask = {
    id: randomUUID(),
    status: "awaiting_confirmation",
    objective: `${kind === "prepare_reservation" ? "Request a table at" : "Contact"} ${source.title}`,
    steps: [
      { id: "gather", label: "Gather contact options", status: "done" },
      { id: "draft", label: "Draft message", status: "done" },
      { id: "confirm", label: "Your confirmation", status: "pending" },
      { id: "handoff", label: "Hand off to your device", status: "pending" },
    ],
    toolCalls: [],
    requiresConfirmation: true,
  };

  const ai = await draftMessage(kind, source.title, details.need, details.when, details.partySize, details.name);
  const draft = ai ?? templateDraft(req);
  const p = source.place;
  const channels: ActionDraft["channels"] = [];
  if (p?.phone) {
    const first = p.phone.split(/[;,]/)[0].trim();
    channels.push({ kind: "phone", label: `Call ${first}`, href: `tel:${first.replace(/[^\d+]/g, "")}` });
  }
  if (p?.email) {
    channels.push({ kind: "email", label: `Email ${p.email}`, href: `mailto:${p.email}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}` });
  }
  const site = p?.website ?? (source.domain !== "openstreetmap.org" ? source.canonicalUrl : undefined);
  if (site) channels.push({ kind: "website", label: `Open ${new URL(site.startsWith("http") ? site : `https://${site}`).hostname.replace(/^www\./, "")}`, href: site.startsWith("http") ? site : `https://${site}` });
  if (p) channels.push({ kind: "map", label: "View listing on OpenStreetMap", href: p.osmUrl ?? `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}` });

  const missing = [
    !p?.phone && "phone number",
    !p?.email && "email",
    !p?.website && "website",
    !p?.openingHours && "opening hours",
  ].filter(Boolean) as string[];

  tasks.set(task.id, task);
  setTimeout(() => tasks.delete(task.id), 30 * 60 * 1000).unref();
  return { taskId: task.id, subject: draft.subject, body: draft.body, channels, missing, draftedBy: ai ? "llm" : "template", task };
}

/** Records the person's explicit confirmation. The hand-off happens on their device; we never claim it was sent. */
export function confirmAction(taskId: string, channel: string): AgentTask | null {
  const task = tasks.get(taskId);
  if (!task) return null;
  task.steps = task.steps.map((s) => (s.id === "confirm" ? { ...s, status: "done" } : s.id === "handoff" ? { ...s, status: "done", detail: `Opened ${channel} on your device` } : s));
  task.status = "handed_off";
  task.result = `Handed off via ${channel}. Not sent by AetherDeck — check your ${channel === "phone" ? "call" : channel === "email" ? "mail app" : "browser"} to complete it.`;
  return task;
}
