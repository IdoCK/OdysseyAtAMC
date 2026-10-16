import { expect, it, vi } from "vitest";
import { createEmptyState } from "../src/detect.js";
import { emitRunOutput, runCli } from "../src/cli.js";
import { runMonitor } from "../src/run.js";

const screening = {
  id: "1",
  title: "The Odyssey",
  startsAt: "2026-09-22T18:00:00-04:00",
  localDate: "2026-09-22",
  localTime: "18:00",
  format: "IMAX 70mm" as const,
  bookingUrl: "https://www.amctheatres.com/showtimes/1",
  availability: "bookable" as const,
};

it("persists state and returns a stable notification envelope", async () => {
  const writeState = vi.fn();

  const result = await runMonitor({
    readState: async () => ({ ...createEmptyState(), initialized: true }),
    writeState,
    fetchScreenings: async () => ({ ok: true, checkedAt: "2026-08-10T12:00:00.000Z", screenings: [screening] }),
  });

  expect(result).toMatchObject({ marker: "MONITOR_NOTIFY" });
  expect(writeState).toHaveBeenCalledOnce();
});

it("maps a third failed AMC check to a warning envelope and persists it", async () => {
  const writeState = vi.fn();
  const result = await runMonitor({
    readState: async () => ({ ...createEmptyState(), consecutiveFailures: 2 }),
    writeState,
    fetchScreenings: async () => ({ ok: false, checkedAt: "2026-08-10T12:00:00.000Z", error: "blocked" }),
  });

  expect(result).toMatchObject({ marker: "MONITOR_WARNING", message: expect.stringContaining("blocked") });
  expect(writeState).toHaveBeenCalledWith(expect.objectContaining({ consecutiveFailures: 3 }));
});

it("emits a marker alone for successful silent runs", () => {
  const emitted: string[] = [];

  emitRunOutput({ marker: "MONITOR_OK", message: "" }, (text) => emitted.push(text));

  expect(emitted).toEqual(["MONITOR_OK\n"]);
});

it("prints a warning and sets a failure exit code for unexpected CLI errors", async () => {
  const emitted: string[] = [];
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;

  await runCli({
    run: async () => {
      throw new Error("state JSON is corrupt\n    at parse (store.ts:1:1)");
    },
    write: (text) => emitted.push(text),
  });

  expect(emitted).toEqual(["MONITOR_WARNING\nMonitor failed: state JSON is corrupt\n"]);
  expect(process.exitCode).toBe(1);
  process.exitCode = originalExitCode;
});
