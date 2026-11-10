// Builds the Sidekick's pages (the React side panel) into chromium/dist, next to the plain files in chromium/public
// (manifest, background worker, options, home, cookie test), which are copied as they are. Load chromium/dist unpacked.
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Two flavours of the same extension. The normal one has no new-tab override. The Room flavour (SIDEKICK_FLAVOUR=room, built into
// chromium/dist-room) replaces the new-tab page with the Room: a manifest override cannot be switched off at runtime, so it is
// a separate build with its own pinned key (its id is allowed by the server too, see server/extension.ts ROOM_ID).
const ROOM = process.env.SIDEKICK_FLAVOUR === "room";
const ROOM_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxUQCmeQOzj8HBvI43FUZtUYJ14cT2j5xLPrtrmi96bPRrDX+Jp5M+luHgTVkmqAFtyWq6UQxXFi8vxOjxKyCu6tDtT7CmJ/CkGSA2YfoKi3zZfsrUuYLY/t3TsftxBCVl+jjhUHAaPX7qH7lhtxajMSh+qI+/6Ph4EY3YK7vJRqmoZDc6mN/ZsrbiPFyx+tmZXiWEtWdPkQdue2iHP4jTuyaypiGDoVYYlwgrBaiTRvxvUIm0iZjsJ+A3F90rw8/3tH6rDMmt/KP41qDAszGEgRmfOTbSeVJp0zWWUpqwp58qgJbiF61Va/6398JjjuBvHU+xaJcHMMUqEU8vYYvywIDAQAB";
const out = ROOM ? "dist-room" : "dist";
const roomManifest = {
  closeBundle() {
    if (!ROOM) return;
    const file = resolve(import.meta.dirname, out, "manifest.json");
    const m = JSON.parse(readFileSync(file, "utf8"));
    m.name = "AetherDeck Sidekick (Room)";
    m.key = ROOM_KEY;
    m.chrome_url_overrides = { newtab: "room.html" };
    m.permissions = [...m.permissions, "webNavigation"]; // links that open new tabs become panes
    m.optional_permissions = (m.optional_permissions ?? []).filter((p: string) => p !== "webNavigation");
    m.action = { ...m.action, default_title: "Open the AetherDeck Room" };
    writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
  },
};

export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [
    react(),
    { name: "sidekick-room-manifest", ...roomManifest, enforce: "post" as const },
    // The interface's stylesheet names its font as /fonts/…, which on an extension page means the extension's own root.
    { name: "sidekick-fonts", closeBundle() { const from = resolve(import.meta.dirname, "..", "public", "fonts"); if (existsSync(from)) cpSync(from, resolve(import.meta.dirname, out, "fonts"), { recursive: true }); } },
  ],
  build: {
    outDir: out,
    emptyOutDir: true,
    target: "es2022",
    modulePreload: { polyfill: false }, // an extension page may not run inline script
    rollupOptions: { input: { sidepanel: resolve(import.meta.dirname, "sidepanel.html"), panes: resolve(import.meta.dirname, "panes.html"), room: resolve(import.meta.dirname, "room.html") } },
  },
});
