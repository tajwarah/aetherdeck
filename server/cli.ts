// `npm start` and `npm run dev`: the API (and the built interface) as a standalone server.
import "../shared/env.ts"; // first: old WARPNAUT_ settings are read as AETHERDECK_ ones
import { join } from "node:path";
import { startServer } from "./index.ts";

const root = join(import.meta.dirname, "..");
await startServer({
  port: Number(process.env.AETHERDECK_API_PORT ?? process.env.PORT ?? 8787),
  dist: join(root, "dist"),
  dataDir: process.env.AETHERDECK_DATA_DIR ?? join(root, "data", "sync"),
});
