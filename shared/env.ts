// AetherDeck was called Warpnaut. Settings written under the old name (WARPNAUT_VOICE in a .env, say) still work:
// each one is read as its AETHERDECK_ name unless that is set too.
export function legacyEnv(env: NodeJS.ProcessEnv = process.env) {
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith("WARPNAUT_")) continue;
    const name = `AETHERDECK_${k.slice("WARPNAUT_".length)}`;
    if (env[name] === undefined) env[name] = v;
  }
}
legacyEnv();
