import { describe, expect, it } from "vitest";
import { fetchScreenings, type ClientDeps } from "../src/amc/client.js";
import { loadConfig } from "../src/config.js";
import { createEmptyState } from "../src/detect.js";
import type { FetchResult, MonitorState, Screening } from "../src/domain.js";
import { runMonitor, type RunOutput } from "../src/run.js";

const BASELINE_AT = "2026-08-10T12:00:00.000Z";
const CHANGE_AT = "2026-08-10T12:10:00.000Z";

const primary: Screening = {
  id: "70mm-primary",
  title: "The Odyssey",
  startsAt: "2026-09-22T18:00:00-04:00",
  localDate: "2026-09-22",
  localTime: "18:00",
  format: "IMAX 70mm",
  bookingUrl: "https://www.amctheatres.com/showtimes/7001",
  availability: "bookable",
};

const secondary: Screening = {
  ...primary,
  id: "70mm-secondary",
  startsAt: "2026-09-23T20:00:00-04:00",
  localDate: "2026-09-23",
  localTime: "20:00",
  bookingUrl: "https://www.amctheatres.com/showtimes/7002",
};

const ok = (screenings: Screening[], checkedAt = BASELINE_AT): FetchResult => ({
  ok: true,
  checkedAt,
  screenings,
});

const failed = (error: string, checkedAt = CHANGE_AT): FetchResult => ({
  ok: false,
  checkedAt,
  error,
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function officialApiScan(showtimes: unknown[]): () => Promise<FetchResult> {
  const deps: ClientDeps = {
    request: async (input) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      if (path === "/v2/theatres/2116") {
        return jsonResponse({
          id: 2116,
          name: "AMC Lincoln Square 13",
          longName: "AMC Lincoln Square 13",
          slug: "amc-lincoln-square-13",
        });
      }
      if (path.endsWith("/showtimes/9-22-2026")) {
        return jsonResponse({
          pageSize: 200,
          pageNumber: 1,
          count: showtimes.length,
          _embedded: { showtimes },
        });
      }
      if (path.includes("/showtimes/")) {
        return jsonResponse({ pageSize: 200, pageNumber: 1, count: 0, _embedded: { showtimes: [] } });
      }
      throw new Error(`Unexpected AMC API path: ${path}`);
    },
    sleep: async () => undefined,
    now: () => new Date("2026-08-10T12:10:00.000Z"),
    apiKey: "integration-test-vendor-key",
    theatreId: 2116,
  };

  return () => fetchScreenings(loadConfig({}), deps);
}

type ScriptedFetch = FetchResult | (() => Promise<FetchResult>);

interface Scenario {
  name: string;
  fetches: ScriptedFetch[];
  outputs: RunOutput[];
  assertState: (state: MonitorState) => void;
}

async function runScenario(fetches: ScriptedFetch[]): Promise<{ outputs: RunOutput[]; state: MonitorState }> {
  let state = createEmptyState();
  const script = [...fetches];
  const outputs: RunOutput[] = [];

  for (const _fetch of fetches) {
    outputs.push(await runMonitor({
      readState: async () => state,
      writeState: async (nextState) => {
        state = nextState;
      },
      fetchScreenings: async () => {
        const next = script.shift();
        if (!next) throw new Error("Scripted fetch sequence exhausted");
        return typeof next === "function" ? next() : next;
      },
    }));
  }

  return { outputs, state };
}

const silent: RunOutput = { marker: "MONITOR_OK", message: "" };
const primaryNotification: RunOutput = {
  marker: "MONITOR_NOTIFY",
  message:
    "New IMAX 70mm screening is available:\n" +
    "- The Odyssey — Tue, Sep 22 — 6:00 PM — [Book](https://www.amctheatres.com/showtimes/7001)",
};

const scenarios: Scenario[] = [
  {
    name: "establishes a baseline without alerting",
    fetches: [ok([primary])],
    outputs: [silent],
    assertState: (state) => {
      expect(state.initialized).toBe(true);
      expect(state.screenings).toEqual({ [primary.id]: primary });
    },
  },
  {
    name: "alerts when a new IMAX 70mm screening appears",
    fetches: [ok([]), ok([primary], CHANGE_AT)],
    outputs: [silent, primaryNotification],
    assertState: (state) => expect(state.screenings).toEqual({ [primary.id]: primary }),
  },
  {
    name: "filters a digital IMAX candidate before detection",
    fetches: [
      ok([]),
      officialApiScan([
        {
          id: 7999,
          movieName: "The Odyssey",
          sortableMovieName: "Odyssey, The",
          showDateTimeUtc: "2026-09-22T22:00:00Z",
          sellUntilDateTimeUtc: "2026-09-22T22:10:00Z",
          isSoldOut: false,
          isCanceled: false,
          purchaseUrl: "https://www.amctheatres.com/showtimes/7999",
          auditorium: 1,
          attributes: [{ code: "IMAX", name: "IMAX with Laser", description: "Digital IMAX" }],
        },
      ]),
    ],
    outputs: [silent, silent],
    assertState: (state) => expect(state.screenings).toEqual({}),
  },
  {
    name: "alerts when an unavailable screening becomes bookable",
    fetches: [ok([{ ...primary, availability: "unavailable" }]), ok([primary], CHANGE_AT)],
    outputs: [silent, primaryNotification],
    assertState: (state) => expect(state.screenings[primary.id]?.availability).toBe("bookable"),
  },
  {
    name: "includes two distinct booking links when two screenings appear",
    fetches: [ok([]), ok([secondary, primary], CHANGE_AT)],
    outputs: [
      silent,
      {
        marker: "MONITOR_NOTIFY",
        message:
          "New IMAX 70mm screenings are available:\n" +
          "- The Odyssey — Tue, Sep 22 — 6:00 PM — [Book](https://www.amctheatres.com/showtimes/7001)\n" +
          "- The Odyssey — Wed, Sep 23 — 8:00 PM — [Book](https://www.amctheatres.com/showtimes/7002)",
      },
    ],
    assertState: (state) => expect(Object.keys(state.screenings).sort()).toEqual([primary.id, secondary.id]),
  },
  {
    name: "does not alert again when a removed screening is restored unchanged",
    fetches: [ok([primary]), ok([], CHANGE_AT), ok([primary], "2026-08-10T12:20:00.000Z")],
    outputs: [silent, silent, silent],
    assertState: (state) => expect(state.screenings).toEqual({ [primary.id]: primary }),
  },
  {
    name: "preserves state after a suspicious empty response",
    fetches: [ok([primary]), officialApiScan([])],
    outputs: [silent, silent],
    assertState: (state) => {
      expect(state.screenings).toEqual({ [primary.id]: primary });
      expect(state.lastSuccessfulCheck).toBe(BASELINE_AT);
      expect(state.consecutiveFailures).toBe(1);
    },
  },
  {
    name: "warns once after three failures and recovers on success",
    fetches: [
      ok([primary]),
      failed("first failure", "2026-08-10T12:10:00.000Z"),
      failed("second failure", "2026-08-10T12:20:00.000Z"),
      failed("third failure", "2026-08-10T12:30:00.000Z"),
      ok([primary], "2026-08-10T12:40:00.000Z"),
    ],
    outputs: [
      silent,
      silent,
      silent,
      { marker: "MONITOR_WARNING", message: "AMC checks failed three times. Last error: third failure" },
      silent,
    ],
    assertState: (state) => {
      expect(state.consecutiveFailures).toBe(0);
      expect(state.warnedForFailureEpisode).toBe(false);
      expect(state.lastSuccessfulCheck).toBe("2026-08-10T12:40:00.000Z");
    },
  },
];

describe("monitor lifecycle", () => {
  it.each(scenarios)("$name", async ({ fetches, outputs, assertState }) => {
    const result = await runScenario(fetches);

    expect(result.outputs).toEqual(outputs);
    assertState(result.state);
  });
});
