import { describe, expect, it } from "vitest";
import { moveItem, siteItem } from "../../src/lib/dock.ts";

describe("dock", () => {
  it("moves an item to a new position", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 1, 9)).toEqual(["a", "b"].slice(0, 1).concat("b"));
  });
  it("turns an address into a site item and refuses plain words", () => {
    expect(siteItem("github.com")).toEqual({ id: "site:github.com", label: "Github", url: "https://github.com" });
    expect(siteItem("https://www.nytimes.com/section/world", "NYT")?.label).toBe("NYT");
    expect(siteItem("best pizza")).toBeNull();
    expect(siteItem("localhost")).toBeNull();
  });
});
