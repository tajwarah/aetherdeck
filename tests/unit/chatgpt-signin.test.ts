import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { webChatGPT } from "../../server/chatgpt-signin.ts";
import { chatgptReady, setChatGPT } from "../../server/chatgpt.ts";

afterEach(() => { vi.unstubAllGlobals(); setChatGPT(null); });

it("signs in through the local callback and keeps the tokens in a private file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ad-gpt-"));
  const real = globalThis.fetch;
  const id = `x.${Buffer.from(JSON.stringify({ email: "me@example.com" })).toString("base64url")}.y`;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => String(url).includes("/oauth/token")
    ? new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", id_token: id, expires_in: 3600, scope: "openid chatgpt.tokens.use.direct" }))
    : real(url, init));
  const auth = webChatGPT(dir);
  expect(auth.status().signedIn).toBe(false);
  const link = new URL(await auth.begin());
  expect(link.searchParams.get("code_challenge_method")).toBe("S256");
  expect(auth.status().pending).toBe(true);
  const back = new URL(link.searchParams.get("redirect_uri")!);
  back.searchParams.set("code", "abc");
  back.searchParams.set("state", link.searchParams.get("state")!);
  back.searchParams.set("client_id", "client-1");
  await real(back);
  await vi.waitFor(() => expect(auth.status().signedIn).toBe(true));
  expect(auth.status().email).toBe("me@example.com");
  expect(chatgptReady()).toBe(true);
  expect(statSync(join(dir, "chatgpt-signin.json")).mode & 0o077).toBe(0);
  auth.signOut();
  expect(auth.status().signedIn).toBe(false);
  expect(chatgptReady()).toBe(false);
});

it("ignores a callback with the wrong state", async () => {
  const auth = webChatGPT(mkdtempSync(join(tmpdir(), "ad-gpt-")));
  const link = new URL(await auth.begin());
  const back = new URL(link.searchParams.get("redirect_uri")!);
  back.searchParams.set("code", "abc");
  back.searchParams.set("state", "forged");
  await fetch(back);
  await vi.waitFor(() => expect(auth.status().error).toMatch(/didn't match/));
  expect(auth.status().signedIn).toBe(false);
});
