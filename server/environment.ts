// Turns sources + evidence into information nodes and offered actions for a visualization.
// Positions are left to the client; nodes carry structure (parents, relations, groups, time, coordinates).
import type { ActionOffer, Evidence, InformationNode, SearchIntent, SearchResult, VisualizationKind } from "../shared/types.ts";

const CONTENT_GROUP: Record<string, string> = {
  encyclopedia: "Reference",
  paper: "Research papers",
  web: "Across the web",
  news: "Reporting",
  place: "Places",
  image: "Images",
  video: "Video",
};

export function chooseVisualization(intent: SearchIntent, sources: SearchResult[]): VisualizationKind {
  if (intent.expectedOutput === "map" || intent.expectedOutput === "comparison") {
    return sources.some((s) => s.place) || intent.locationContext.needed ? intent.expectedOutput : "clusters";
  }
  if (intent.expectedOutput === "timeline" && sources.filter((s) => s.publicationDate).length < 2) return "clusters";
  if (intent.expectedOutput === "media" && !sources.some((s) => s.thumbnail)) return "clusters";
  return intent.expectedOutput;
}

export function buildNodes(intent: SearchIntent, viz: VisualizationKind, sources: SearchResult[], evidence: Evidence[]): InformationNode[] {
  const root: InformationNode = {
    id: "root",
    title: intent.constraints.topic || intent.query,
    nodeType: "intent",
    parentId: null,
    relatedNodeIds: [],
    sourceIds: [],
    summary: intent.query,
    visualizationHints: { weight: 1 },
  };
  const nodes: InformationNode[] = [root];

  const sourceNode = (s: SearchResult, parentId: string, i: number): InformationNode => ({
    id: `src:${s.id}`,
    title: s.title,
    nodeType: s.place ? "place" : s.contentType === "news" ? "event" : "source",
    parentId,
    relatedNodeIds: [],
    sourceIds: [s.id],
    summary: s.snippet,
    visualizationHints: {
      weight: Math.max(0.25, 1 - i * 0.08),
      group: CONTENT_GROUP[s.contentType] ?? "Sources",
      time: s.publicationDate,
      lat: s.place?.lat,
      lon: s.place?.lon,
    },
  });

  if (viz === "evidence") {
    const subtopics = [...new Set(evidence.map((e) => e.subtopic).filter(Boolean))] as string[];
    subtopics.forEach((q, qi) => {
      const subId = `sub:${qi}`;
      nodes.push({ id: subId, title: q, nodeType: "subtopic", parentId: "root", relatedNodeIds: [], sourceIds: [], visualizationHints: { weight: 0.8, group: q } });
      evidence.filter((e) => e.subtopic === q).forEach((e) => {
        nodes.push({
          id: `ev:${e.id}`,
          title: e.claim,
          nodeType: e.evidenceType === "gap" ? "gap" : "finding",
          parentId: subId,
          relatedNodeIds: e.sourceIds.map((id) => `src:${id}`),
          sourceIds: e.sourceIds,
          summary: e.confidenceOrLimitations,
          visualizationHints: { weight: e.evidenceType === "gap" ? 0.3 : 0.6, group: e.evidenceType },
        });
      });
    });
    sources.forEach((s, i) => {
      const n = sourceNode(s, "root", i);
      n.relatedNodeIds = nodes.filter((x) => x.sourceIds.includes(s.id) && x.id !== n.id).map((x) => x.id);
      nodes.push(n);
    });
    return nodes;
  }

  sources.forEach((s, i) => nodes.push(sourceNode(s, "root", i)));
  // Lightweight relations: same publisher/domain, so the canvas can draw quiet threads between them.
  const byDomain = new Map<string, InformationNode[]>();
  for (const n of nodes.slice(1)) {
    const d = sources.find((s) => s.id === n.sourceIds[0])?.domain ?? "";
    byDomain.set(d, [...(byDomain.get(d) ?? []), n]);
  }
  for (const group of byDomain.values()) {
    if (group.length < 2) continue;
    for (const n of group) n.relatedNodeIds = group.filter((g) => g !== n).map((g) => g.id).slice(0, 3);
  }
  return nodes;
}

export function buildActions(intent: SearchIntent, sources: SearchResult[]): ActionOffer[] {
  const actions: ActionOffer[] = [];
  for (const s of sources.slice(0, 12)) {
    actions.push({ id: `open:${s.id}`, kind: "open_source", label: "Open original", targetSourceId: s.id, requiresConfirmation: false });
    if (s.place && s.freshnessStatus !== "sample") {
      if (intent.intentType === "local_service") {
        actions.push({ id: `contact:${s.id}`, kind: "contact_provider", label: "Prepare a request", targetSourceId: s.id, requiresConfirmation: true });
      } else {
        actions.push({ id: `reserve:${s.id}`, kind: "prepare_reservation", label: "Prepare a booking request", targetSourceId: s.id, requiresConfirmation: true });
      }
      actions.push({ id: `dir:${s.id}`, kind: "directions", label: "Directions", targetSourceId: s.id, requiresConfirmation: false });
    }
    actions.push({ id: `save:${s.id}`, kind: "save", label: "Keep", targetSourceId: s.id, requiresConfirmation: false });
  }
  return actions;
}
