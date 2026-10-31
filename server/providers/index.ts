import type { Provider } from "./types.ts";
import type { ProviderId } from "../../shared/types.ts";
import { wikipedia } from "./wikipedia.ts";
import { arxiv } from "./arxiv.ts";
import { openalex } from "./openalex.ts";
import { gdelt } from "./gdelt.ts";
import { currents } from "./currents.ts";
import { osm } from "./osm.ts";
import { photon } from "./photon.ts";
import { brave } from "./brave.ts";
import { tavily } from "./tavily.ts";
import { searxng } from "./searxng.ts";
import { hackernews } from "./hackernews.ts";
import { stackexchange } from "./stackexchange.ts";
import { demo } from "./demo.ts";

export const PROVIDERS: Record<Exclude<ProviderId, "direct" | "browser">, Provider> = { wikipedia, openalex, arxiv, gdelt, currents, osm, photon, brave, tavily, searxng, hackernews, stackexchange, demo };

export const demoForced = () => process.env.HORUS_DEMO === "1";

export function providerStatus() {
  return Object.values(PROVIDERS)
    .filter((p) => p.id !== "demo")
    .map((p) => ({ id: p.id, label: p.label, configured: p.available(), supports: p.supports }));
}

/** Engines that search the whole web (as opposed to one site or one kind of source). */
export const webEngines = () => [PROVIDERS.brave, PROVIDERS.tavily, PROVIDERS.searxng].filter((p) => p.available());
