// Sample data for running without network access or credentials.
// Everything here is marked freshnessStatus "sample" and shown as such in the interface.
// Local results are deliberately placeholders: Horus never invents real-looking businesses.
import type { Provider } from "./types.ts";
import type { SearchResult } from "../../shared/types.ts";

const at = "2026-01-01T00:00:00.000Z";
const base = { retrievedAt: at, sourceProvider: "demo" as const, freshnessStatus: "sample" as const };

// Real, well-known works — citations curated by hand, not retrieved live.
const QUANTUM: { r: SearchResult; text: string }[] = [
  {
    r: { ...base, id: "demo-shor", title: "Polynomial-Time Algorithms for Prime Factorization and Discrete Logarithms on a Quantum Computer", canonicalUrl: "https://arxiv.org/abs/quant-ph/9508027", domain: "arxiv.org", publisher: "arXiv", authors: ["Peter W. Shor"], contentType: "paper", publicationDate: "1995-08-30T00:00:00Z", snippet: "Shor's factoring algorithm: an efficient quantum algorithm for integer factorization.", limitations: ["Sample citation curated offline — open the link to read the original."] },
    text: "A quantum computer can factor integers and compute discrete logarithms in polynomial time, problems believed to be hard for classical computers.",
  },
  {
    r: { ...base, id: "demo-grover", title: "A fast quantum mechanical algorithm for database search", canonicalUrl: "https://arxiv.org/abs/quant-ph/9605043", domain: "arxiv.org", publisher: "arXiv", authors: ["Lov K. Grover"], contentType: "paper", publicationDate: "1996-05-29T00:00:00Z", snippet: "Grover's algorithm: quadratic speed-up for unstructured search.", limitations: ["Sample citation curated offline — open the link to read the original."] },
    text: "Searching an unsorted list of N items takes on the order of the square root of N steps on a quantum computer.",
  },
  {
    r: { ...base, id: "demo-nisq", title: "Quantum Computing in the NISQ era and beyond", canonicalUrl: "https://arxiv.org/abs/1801.00862", domain: "arxiv.org", publisher: "arXiv", authors: ["John Preskill"], contentType: "paper", publicationDate: "2018-01-02T00:00:00Z", snippet: "Noisy intermediate-scale quantum devices and their limits.", limitations: ["Sample citation curated offline — open the link to read the original."] },
    text: "Noise in quantum gates will limit the size of quantum circuits that can be executed reliably; error correction remains a long-term goal.",
  },
  {
    r: { ...base, id: "demo-supremacy", title: "Quantum supremacy using a programmable superconducting processor", canonicalUrl: "https://arxiv.org/abs/1910.11333", domain: "arxiv.org", publisher: "arXiv", authors: ["Frank Arute", "et al."], contentType: "paper", publicationDate: "2019-10-23T00:00:00Z", snippet: "A 53-qubit processor sampled random circuits faster than a classical simulation was then estimated to.", limitations: ["Sample citation curated offline — open the link to read the original.", "The classical-hardness estimate in this paper was later disputed."] },
    text: "Researchers demonstrated a sampling task on a programmable superconducting processor and estimated that classical simulation would take far longer, a claim later challenged by improved classical methods.",
  },
  {
    r: { ...base, id: "demo-wiki-qc", title: "Quantum computing", canonicalUrl: "https://en.wikipedia.org/wiki/Quantum_computing", domain: "en.wikipedia.org", publisher: "Wikipedia", contentType: "encyclopedia", snippet: "Overview article on quantum computing.", limitations: ["Sample — overview written for this demo, not the live article text."] },
    text: "A quantum computer is a computer that exploits quantum mechanical phenomena such as superposition and entanglement. Its basic unit of information is the qubit. Building reliable qubits is difficult because they lose their quantum state through decoherence.",
  },
];

function placeholderPlaces(kind: "food" | "service", loc: { lat: number; lon: number }): { r: SearchResult; text: string }[] {
  const offsets = [[0.006, 0.004], [-0.009, 0.007], [0.012, -0.01], [-0.004, -0.013]];
  return offsets.map(([dLat, dLon], i) => {
    const lat = loc.lat + dLat;
    const lon = loc.lon + dLon;
    const km = Math.round(Math.hypot(dLat * 111, dLon * 111 * Math.cos((loc.lat * Math.PI) / 180)) * 10) / 10;
    const title = kind === "food" ? `Placeholder restaurant ${String.fromCharCode(65 + i)}` : `Placeholder technician ${String.fromCharCode(65 + i)}`;
    const text = `Illustrative placeholder — not a real business. Shown ${km} km away to demonstrate the layout.`;
    return {
      r: {
        ...base,
        id: `demo-place-${kind}-${i}`,
        title,
        canonicalUrl: `https://sample.invalid/${kind}-${i}`,
        domain: "sample.invalid",
        publisher: "Sample data",
        contentType: "place",
        snippet: text,
        place: { lat, lon, distanceKm: km, category: kind === "food" ? "restaurant (sample)" : "hvac (sample)" },
        limitations: ["Not a real business. Configure network access to see real listings."],
      },
      text,
    };
  });
}

export const demo: Provider = {
  id: "demo",
  label: "Sample data",
  supports: ["paper", "encyclopedia", "place", "news", "web"],
  freshness: () => "stable",
  available: () => true,
  async search(q) {
    let rows: { r: SearchResult; text: string }[] = [];
    if (q.kind === "place" && q.location) rows = placeholderPlaces(q.placeKind === "service" ? "service" : "food", q.location);
    else if (/quantum/i.test(q.topic)) rows = QUANTUM.filter((x) => (q.kind === "paper" ? x.r.contentType === "paper" : x.r.contentType !== "paper"));
    return { results: rows.map((x) => x.r).slice(0, q.limit), texts: Object.fromEntries(rows.map((x) => [x.r.id, x.text])) };
  },
};
