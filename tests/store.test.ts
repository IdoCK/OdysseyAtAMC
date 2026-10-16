import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createEmptyState } from "../src/detect.js";
import { readState, writeState } from "../src/state/store.js";

it("round-trips valid state without leaving a temp file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "odyssey-monitor-"));
  const path = join(dir, "state.json");
  await writeState(path, createEmptyState());
  expect(await readState(path)).toEqual(createEmptyState());
  expect(JSON.parse(await readFile(path, "utf8")).version).toBe(1);
});

it("returns a fresh state for a missing state file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "odyssey-monitor-"));

  await expect(readState(join(dir, "missing.json"))).resolves.toEqual(createEmptyState());
});

it("adds the Odyssey title when reading legacy state that predates screening titles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "odyssey-monitor-"));
  const path = join(dir, "state.json");
  await writeFile(path, JSON.stringify({
    ...createEmptyState(),
    initialized: true,
    screenings: {
      "1": {
        id: "1",
        startsAt: "2026-09-22T22:00:00Z",
        localDate: "2026-09-22",
        localTime: "18:00",
        format: "IMAX 70mm",
        bookingUrl: "https://www.amctheatres.com/showtimes/1",
        availability: "bookable",
      },
    },
  }), "utf8");

  await expect(readState(path)).resolves.toMatchObject({
    screenings: { "1": { title: "The Odyssey" } },
  });
});

it("rejects a corrupt existing state file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "odyssey-monitor-"));
  const path = join(dir, "state.json");
  await writeFile(path, "{not json", "utf8");

  await expect(readState(path)).rejects.toThrow();
});
