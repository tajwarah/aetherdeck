import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { getSettings, loadSettings, sameOriginOnly, saveSettings } from "../../server/settings.ts";

const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;
afterEach(() => { delete process.env.GROQ_API_KEY; delete process.env.LLM_PROVIDER; });

it("saves keys privately, applies them, and never hands them back", () => {
  const dir = mkdtempSync(join(tmpdir(), "ad-"));
  const out = saveSettings(dir, { keys: { GROQ_API_KEY: "gsk_secret", NOT_ALLOWED: "x" }, config: { LLM_PROVIDER: "groq" } });
  expect(out.keys.GROQ_API_KEY).toBe(true);
  expect(JSON.stringify(out)).not.toContain("gsk_secret");
  expect(process.env.GROQ_API_KEY).toBe("gsk_secret");
  expect(process.env.NOT_ALLOWED).toBeUndefined();
  expect(statSync(join(dir, "ai-settings.json")).mode & 0o077).toBe(0);
  delete process.env.GROQ_API_KEY;
  loadSettings(dir);
  expect(process.env.GROQ_API_KEY).toBe("gsk_secret");
  saveSettings(dir, { keys: { GROQ_API_KEY: "" } });
  expect(readFileSync(join(dir, "ai-settings.json"), "utf8")).not.toContain("gsk_secret");
  expect(getSettings(dir).keys.GROQ_API_KEY).toBe(false);
});

it("accepts only the page this server serves", () => {
  const ok = { host: "127.0.0.1:8787", origin: "http://127.0.0.1:8787", "x-aetherdeck-settings": "1" };
  expect(sameOriginOnly(req(ok))).toBe(true);
  expect(sameOriginOnly(req({ ...ok, origin: "https://evil.example" }))).toBe(false);
  expect(sameOriginOnly(req({ ...ok, host: "evil.example" }))).toBe(false);
  expect(sameOriginOnly(req({ host: ok.host }))).toBe(false);
});
