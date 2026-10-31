// `npm start` and `npm run dev`: the API (and the built interface) as a standalone server.
import { join } from "node:path";
import { startServer } from "./index.ts";

const root = join(import.meta.dirname, "..");
await startServer({
  port: Number(process.env.HORUS_API_PORT ?? process.env.PORT ?? 8787),
  dist: join(root, "dist"),
  dataDir: process.env.HORUS_DATA_DIR ?? join(root, "data", "sync"),
});
