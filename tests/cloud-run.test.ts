import { describe, expect, it } from "vitest";
import { runCloudMonitor } from "../src/cloud/run.js";
import { createEmptyState } from "../src/detect.js";
import type { FetchResult, MonitorState, Screening } from "../src/domain.js";

const screening: Screening = {
  id: "showtime-1",
  title: "The Odyssey",
  startsAt: "2026-09-22T18:00:00-04:00",
  localDate: "2026-09-22",
  localTime: "18:00",
  format: "IMAX 70mm",
  bookingUrl: "https://www.amctheatres.com/showtimes/1",
  availability: "bookable",
};

const successfulEmptyFetch: FetchResult = {
  ok: true,
  checkedAt: "2026-08-13T12:00:00.000Z",
  screenings: [],
};

describe("runCloudMonitor", () => {
  it.each([
    ["baseline", createEmptyState(), successfulEmptyFetch],
    ["silent", { ...createEmptyState(), initialized: true }, successfulEmptyFetch],
    ["recovered", { ...createEmptyState(), initialized: true, consecutiveFailures: 1 }, successfulEmptyFetch],
    ["failure-silent", createEmptyState(), { ok: false, checkedAt: "2026-08-13T12:00:00.000Z", error: "blocked" }],
  ] as const)("writes state without sending and returns OK for a %s transition", async (_kind, state, fetchResult) => {
    const events: string[] = [];

    const result = await runCloudMonitor({
      readState: async () => state,
      fetchScreenings: async () => fetchResult,
      sendNotification: async () => {
        events.push("send");
      },
      writeState: async () => {
        events.push("write");
      },
    });

    expect(result).toBe("MONITOR_OK");
    expect(events).toEqual(["write"]);
  });

  it("sends a new-screening notification before writing state and returns its marker", async () => {
    const events: string[] = [];
    const messages: string[] = [];

    const result = await runCloudMonitor({
      readState: async () => ({ ...createEmptyState(), initialized: true }),
      fetchScreenings: async () => ({
        ok: true,
        checkedAt: "2026-08-13T12:00:00.000Z",
        screenings: [screening],
      }),
      sendNotification: async (message, options) => {
        events.push("send");
        messages.push(`${String(options.loud)}:${message}`);
      },
      writeState: async () => {
        events.push("write");
      },
    });

    expect(result).toBe("MONITOR_NOTIFY");
    expect(events).toEqual(["send", "write"]);
    expect(messages).toEqual([
      "true:New IMAX 70mm screening is available:\n- The Odyssey \u2014 Tue, Sep 22 \u2014 6:00 PM \u2014 [Book](https://www.amctheatres.com/showtimes/1)",
    ]);
  });

  it("sends a third-failure warning before writing state and returns its marker", async () => {
    const events: string[] = [];
    const messages: string[] = [];

    const result = await runCloudMonitor({
      readState: async () => ({ ...createEmptyState(), consecutiveFailures: 2 }),
      fetchScreenings: async () => ({
        ok: false,
        checkedAt: "2026-08-13T12:00:00.000Z",
        error: "blocked\ninternal details",
      }),
      sendNotification: async (message, options) => {
        events.push("send");
        messages.push(`${String(options.loud)}:${message}`);
      },
      writeState: async () => {
        events.push("write");
      },
    });

    expect(result).toBe("MONITOR_WARNING");
    expect(events).toEqual(["send", "write"]);
    expect(messages).toEqual(["false:AMC checks failed three times. Last error: blocked"]);
  });

  it("does not write state when notification delivery rejects", async () => {
    const events: string[] = [];

    await expect(runCloudMonitor({
      readState: async (): Promise<MonitorState> => ({ ...createEmptyState(), initialized: true }),
      fetchScreenings: async () => ({
        ok: true,
        checkedAt: "2026-08-13T12:00:00.000Z",
        screenings: [screening],
      }),
      sendNotification: async () => {
        events.push("send");
        throw new Error("Telegram delivery failed (503)");
      },
      writeState: async () => {
        events.push("write");
      },
    })).rejects.toThrow("Telegram delivery failed (503)");

    expect(events).toEqual(["send"]);
  });

  it("resends a notification after delivery succeeds but state persistence fails", async () => {
    let state: MonitorState = { ...createEmptyState(), initialized: true };
    let rejectWrite = true;
    const messages: string[] = [];
    const dependencies = {
      readState: async () => state,
      fetchScreenings: async (): Promise<FetchResult> => ({
        ok: true,
        checkedAt: "2026-08-13T12:00:00.000Z",
        screenings: [screening],
      }),
      sendNotification: async (message: string) => {
        messages.push(message);
      },
      writeState: async (nextState: MonitorState) => {
        if (rejectWrite) throw new Error("State persistence failed");
        state = nextState;
      },
    };

    await expect(runCloudMonitor(dependencies)).rejects.toThrow("State persistence failed");
    expect(state.screenings).toEqual({});
    expect(messages).toHaveLength(1);

    rejectWrite = false;
    await expect(runCloudMonitor(dependencies)).resolves.toBe("MONITOR_NOTIFY");
    expect(messages).toHaveLength(2);
    expect(messages[1]).toBe(messages[0]);
    expect(state.screenings).toEqual({ [screening.id]: screening });
  });
});
