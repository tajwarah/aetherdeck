import { afterEach, expect, it } from "vitest";
import { listModels } from "../../server/models.ts";

afterEach(() => { delete process.env.LLM_BASE_URL; });

it("lists models from a custom address, with or without a key", async () => {
  process.env.LLM_BASE_URL = "http://box.local:8000/v1/";
  let seen = "";
  const fake = (async (url: string) => { seen = url; return new Response(JSON.stringify({ data: [{ id: "my-model" }] })); }) as unknown as typeof fetch;
  expect(await listModels("custom", "none", fake)).toEqual([{ id: "my-model", name: "my-model" }]);
  expect(seen).toBe("http://box.local:8000/v1/models");
});
