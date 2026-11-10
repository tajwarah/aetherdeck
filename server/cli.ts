// `npm start` and `npm run dev`: the API (and the built interface) as a standalone server.
import { join } from "node:path";
import { startServer } from "./index.ts";

const root = join(import.meta.dirname, "..");
await startServer({
  port: Number(process.env.AETHERDECK_API_PORT ?? process.env.PORT ?? 8787),
  host: process.env.AETHERDECK_HOST || undefined, // 127.0.0.1 keeps it to this computer (the packaged browser sets it)
  dist: join(root, "dist"),
  dataDir: process.env.AETHERDECK_DATA_DIR ?? join(root, "data", "sync"),
});

// Started by AetherDeck for Mac: stop when that browser is gone, even if it was force-quit or crashed.
const parent = Number(process.env.AETHERDECK_PARENT_PID);
if (parent > 0) setInterval(() => { try { process.kill(parent, 0); } catch { process.exit(0); } }, 5000).unref();
