import { describe, expect, it } from "vitest";
import { isTrackedTitle } from "../src/Titles.js";

describe("isTrackedTitle", () => {
  it("does not let an empty configured entry match every AMC title", () => {
    expect(isTrackedTitle("An Unrelated Movie", ["", "   "])).toBe(false);
  });
});
