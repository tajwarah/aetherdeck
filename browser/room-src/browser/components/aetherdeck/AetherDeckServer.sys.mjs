/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// AetherDeck starts its own local AetherDeck server (the home page, AI, research and agents) when none is running.
// The packaged app carries Node and the bundled server in Contents/Resources/aetherdeck/. It listens on 127.0.0.1 only,
// keeps its data in ~/Library/Application Support/AetherDeck/Server, and stops when the browser quits.
// A developer build without that folder uses whatever runs on port 8787 (npm start), or shows the page's own error.
import { Subprocess } from "resource://gre/modules/Subprocess.sys.mjs";
import { setTimeout } from "resource://gre/modules/Timer.sys.mjs";

const PORT = 8787;
let proc = null;
let starting = null;

// `alive` comes from a browser window (it has fetch; this module does not): true when the server answers.
async function launch(alive) {
  const res = Services.dirsvc.get("GreD", Ci.nsIFile).path; // …/AetherDeck.app/Contents/Resources
  const node = PathUtils.join(res, "aetherdeck", "bin", "node");
  const script = PathUtils.join(res, "aetherdeck", "server", "server.mjs");
  if (!(await IOUtils.exists(node)) || !(await IOUtils.exists(script))) return "missing";
  const data = PathUtils.join(Services.dirsvc.get("ULibDir", Ci.nsIFile).path, "Application Support", "AetherDeck", "Server");
  await IOUtils.makeDirectory(data, { createAncestors: true, permissions: 0o700 });
  proc = await Subprocess.call({
    command: node,
    arguments: [script],
    environment: {
      NODE_ENV: "production",
      AETHERDECK_HOST: "127.0.0.1",
      AETHERDECK_API_PORT: String(PORT),
      AETHERDECK_DATA_DIR: data,
      AETHERDECK_PARENT_PID: String(Services.appinfo.processID), // it stops by itself if the browser is gone
      HOME: Services.env.get("HOME"),
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    },
    environmentAppend: false,
    stderr: "stdout",
  });
  // Its output is read and dropped, so a full pipe never stalls it.
  (async () => { try { while (await proc.stdout.readString()) { /* drop */ } } catch (e) { /* ended */ } })();
  proc.wait().then(() => { proc = null; });
  for (let i = 0; i < 60; i++) {
    if (await alive()) return "started";
    if (!proc) return "failed";
    await new Promise((r) => setTimeout(r, 250));
  }
  return "failed";
}

Services.obs.addObserver(() => { try { proc?.kill(); } catch (e) { /* already gone */ } }, "quit-application");

export const AetherDeckServer = {
  /** "running" (already up), "started" (we started it), "missing" (not packaged here) or "failed". */
  ensure(alive) {
    starting ??= (async () => ((await alive()) ? "running" : launch(alive)))().finally(() => { setTimeout(() => { starting = null; }, 0); });
    return starting;
  },
};
