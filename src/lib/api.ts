import type { ActionDraft, ActionDraftRequest, AgentTask, EnvironmentModel, ExploreRequest, StreamEvent } from "../../shared/types.ts";

export interface Health {
  ok: boolean;
  demo: boolean;
  llm: boolean;
  model: { provider: string; label: string; free: boolean } | null;
  vision?: boolean;
  /** Who turns speech into text for the agents (Whisper or Gemini), or null without a key for one. */
  voice?: string | null;
  /** Whether a Claude API key is set, for the Agent Station. */
  claude?: boolean;
  providers: { id: string; label: string; configured: boolean }[];
  sync?: boolean;
  /** Where other devices can reach this AetherDeck (PUBLIC_URL), and this computer's Wi-Fi addresses. */
  publicUrl?: string | null;
  lan?: string[];
}

export async function getHealth(): Promise<Health | null> {
  try {
    const res = await fetch("/api/health");
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Streams progressive EnvironmentModel snapshots (NDJSON) for one exploration. */
export async function exploreStream(req: ExploreRequest, onModel: (m: EnvironmentModel) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch("/api/explore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `The service answered ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === "error") throw new Error(event.message);
      onModel(event.model);
    }
  }
}

export async function geocodePlace(q: string): Promise<{ lat: number; lon: number; label: string }> {
  const res = await fetch(`/api/geocode?${new URLSearchParams({ q })}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Place lookup failed");
  return body;
}

export async function draftAction(req: ActionDraftRequest): Promise<ActionDraft> {
  const res = await fetch("/api/actions/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Could not prepare the request");
  return body;
}

export async function confirmAction(taskId: string, channel: string): Promise<AgentTask> {
  const res = await fetch(`/api/actions/${taskId}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, confirmed: true }) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Could not confirm");
  return body;
}

export interface AssistMaterial { name: string; kind: "text" | "pdf" | "image" | "sheet" | "page"; url?: string; text?: string; mime?: string; data?: string }
export interface AssistTurn { role: "user" | "assistant"; text: string }

/** One question to the person's chosen AI model about a file or page. */
export async function askAssistant(question: string, history: AssistTurn[], material: AssistMaterial | undefined, signal?: AbortSignal): Promise<{ answer: string; model: string; truncated: boolean }> {
  const res = await fetch("/api/assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, history, material }), signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `Cosmonaut's model answered ${res.status}`), { status: res.status });
  return body;
}

/** One recording (base64 WAV) to text, by Whisper or Gemini. */
export async function transcribeAudio(audio: string, signal?: AbortSignal): Promise<{ text: string; by: string }> {
  const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio, language: navigator.language.split("-")[0] }), signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Voice answered ${res.status}`);
  return body;
}

export type AgentName = "scout" | "navigator" | "reader" | "scribe";
export interface AgentStep { agent: AgentName; do: string; query?: string; url?: string; urls?: string[]; match?: string; question?: string; text?: string }
export interface AgentPlan { say: string; steps: AgentStep[]; model: string }

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `The model answered ${res.status}`);
  return out as T;
}

/** One turn of an agent's work, on the model it was given. */
export const crewTurn = (agent: unknown, messages: unknown[], signal?: AbortSignal) => post<{ content: { type: string }[]; stop: string }>("/api/crew/turn", { agent, messages }, signal);
/** A role and plan drafted for a task. */
export const crewPlan = (task: string, role: string, provider: string, model: string) => post<{ role: string; plan: string[] }>("/api/crew/plan", { task, role, provider, model });
export interface Brain { id: string; label: string; cost: "local" | "free" | "paid"; ready: boolean; models: { id: string; name: string }[]; note?: string }
/** What agents can think with right now. */
export async function getBrains(): Promise<Brain[]> {
  const res = await fetch("/api/crew/brains");
  return res.ok ? ((await res.json()) as { brains: Brain[] }).brains : [];
}

/** The agents' plan for one request, given what is on screen. */
export async function planAgents(request: string, context: { windows: { title: string; url: string; front: boolean }[]; map?: string }, signal?: AbortSignal): Promise<AgentPlan> {
  const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request, context }), signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The agents answered ${res.status}`);
  return body;
}
