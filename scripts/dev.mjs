// Runs the API server and the Vite client together; Ctrl+C stops both.
import { spawn } from "node:child_process";

const procs = [
  spawn("node", ["--watch", "--env-file-if-exists=.env", "server/cli.ts"], { stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", ...process.argv.slice(2)], { stdio: "inherit" }),
];
const stop = () => { for (const p of procs) p.kill("SIGTERM"); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => { if (code) stop(); });
