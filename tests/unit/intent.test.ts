import { describe, expect, it } from "vitest";
import { classify, extractPlaceHint, planIntent } from "../../server/intent.ts";

describe("intent planner", () => {
  it("routes the three demo scenarios", () => {
    const research = planIntent("Explain quantum computing and show me the original sources.");
    expect(research.intentType).toBe("research");
    expect(research.constraints.topic).toBe("quantum computing");
    expect(research.expectedOutput).toBe("evidence");
    expect(research.providers).toContain("openalex");

    const service = planIntent("Find an AC repair technician near me today.");
    expect(service.intentType).toBe("local_service");
    expect(service.mode).toBe("act");
    expect(service.constraints.topic).toBe("ac repair");
    expect(service.constraints.time).toBe("today");
    expect(service.locationContext).toMatchObject({ needed: true, source: "none" });

    const food = planIntent("Find restaurants near me that serve kacchi biryani and compare them.");
    expect(food.intentType).toBe("local_place");
    expect(food.constraints.topic).toBe("kacchi biryani");
    expect(food.expectedOutput).toBe("comparison");
  });

  it("treats recent-events questions as news and keeps the place in the topic", () => {
    const news = planIntent("What's happening in Bangladesh today?");
    expect(news.intentType).toBe("news");
    expect(news.constraints.topic).toBe("bangladesh");
    expect(news.constraints.time).toBe("today");
    expect(news.expectedOutput).toBe("timeline");
    expect(planIntent("What is happening in Bangladesh this week?").constraints.topic).toBe("bangladesh");
  });

  it("never asks for location when the request names a place", () => {
    const i = planIntent("AC repair technician in Gulshan, Dhaka");
    expect(i.constraints.placeHint).toBe("Gulshan, Dhaka");
    expect(i.locationContext.needed).toBe(false);
    expect(i.constraints.topic).toBe("ac repair");
  });

  it("uses a supplied location without inventing one", () => {
    const i = planIntent("pizza near me", { lat: 1, lon: 2, label: "Here", source: "device" });
    expect(i.locationContext).toMatchObject({ source: "device", lat: 1, lon: 2 });
    expect(planIntent("pizza near me").locationContext.lat).toBeUndefined();
  });

  it("recognises addresses, media and general exploration", () => {
    expect(classify("example.com/about")).toBe("url");
    expect(classify("photos of the aurora")).toBe("media");
    expect(classify("history of the printing press")).toBe("explore");
    expect(extractPlaceHint("cafes near me")).toBeNull();
  });
});
