import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses the fixed AMC target and an overridable state path", () => {
    const config = loadConfig({ MONITOR_STATE_PATH: "var/test-state.json" });
    expect(config).toEqual({
      theaterUrl: "https://www.amctheatres.com/movie-theatres/new-york-city/amc-lincoln-square-13",
      trackedTitles: [
        "The Odyssey",
        "Digger",
        "Dune: Part Three",
        "Dune: Messiah",
        "Avengers: Doomsday",
        "The Legend of Zelda",
      ],
      dailyStatusTitles: [
        "The Odyssey",
        "Digger",
        "Dune: Part Three",
        "Avengers: Doomsday",
        "The Legend of Zelda",
      ],
      timezone: "America/New_York",
      statePath: "var/test-state.json",
      maxAttempts: 3,
    });
  });
});
