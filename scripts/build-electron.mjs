// Bundles the desktop app's main process (with the AetherDeck server inside it) and its preload.
import { build } from "esbuild";

// Minified (names kept, so stack traces stay readable with the source map, which is not shipped).
// The blocker looks up its cosmetic-filtering preload when it loads. Shields block on the network only and never use
// it, and it wouldn't exist in the packaged app: the lookup there would stop the app from starting.
const noPreload = { name: "no-preload", setup(b) { b.onLoad({ filter: /adblocker-electron[\\/].*preload_path\.js$/ }, () => ({ contents: "export default ''; export const PRELOAD_PATH = '';", loader: "js" })); } };

const common = { bundle: true, platform: "node", target: "node22", external: ["electron"], sourcemap: true, minify: true, keepNames: true, logLevel: "warning", plugins: [noPreload] };
await build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist-electron/main.js", format: "esm",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
await build({ ...common, entryPoints: ["electron/preload.ts"], outfile: "dist-electron/preload.cjs", format: "cjs" });
// Its function is copied into extensions by its source text, so it must stand alone: no minifying, no name helpers.
await build({ bundle: true, platform: "node", target: "node22", external: ["electron"], logLevel: "warning", entryPoints: ["electron/extension-shim.ts"], outfile: "dist-electron/extension-shim.cjs", format: "cjs" });
