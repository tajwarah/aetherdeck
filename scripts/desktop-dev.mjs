// The desktop app in development: Vite serves the interface with live reload; Electron runs the server and pages.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const electron = createRequire(import.meta.url)("electron");
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", "5180", "--strictPort"], { stdio: "inherit" });
const app = spawn(electron, ["."], { stdio: "inherit", env: { ...process.env, HORUS_DEV_URL: "http://localhost:5180/", HORUS_API_PORT: "8787" } });
const stop = () => { vite.kill(); app.kill(); process.exit(0); };
app.on("exit", stop);
process.on("SIGINT", stop);
