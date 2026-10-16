import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchScreenings, type ClientDeps } from "../src/amc/client.js";
import { loadConfig } from "../src/config.js";
import fixture from "./fixtures/amc-api-showtimes.json" with { type: "json" };

const TEST_API_KEY = "unit-test-vendor-key";
const NOW = new Date("2026-08-10T12:00:00Z");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname === "/v2/theatres/999") return jsonResponse(fixture.theatre);
    if (url.pathname.startsWith("/v2/theatres/999/showtimes/")) {
      const date = url.pathname.split("/").at(-1);
      if (date !== "9-22-2026") {
        return jsonResponse({ pageSize: 200, pageNumber: 1, count: 0, _embedded: { showtimes: [] } });
      }
      const page = Number(url.searchParams.get("page-number") ?? "1");
      return jsonResponse(fixture.pages[page - 1]);
    }
    throw new Error(`Unexpected AMC API URL: ${url.pathname}`);
  });
}

function deps(request: ReturnType<typeof vi.fn>, overrides: Partial<ClientDeps> = {}): ClientDeps {
  return {
    request,
    sleep: async () => undefined,
    now: () => NOW,
    apiKey: TEST_API_KEY,
    theatreId: 999,
    ...overrides,
  };
}

describe("official AMC API client", () => {
  it("validates the production theatre id directly without calling the unsupported collection route", async () => {
    // Keep the real-client date window aligned with the saved showtime fixture.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/v2/theatres/2116") {
        return jsonResponse({ ...fixture.theatre, id: 2116 });
      }
      if (url.pathname.startsWith("/v2/theatres/2116/showtimes/")) {
        if (url.pathname.endsWith("/9-22-2026")) {
          return jsonResponse({
            pageSize: 200,
            pageNumber: 1,
            count: 1,
            _embedded: { showtimes: [fixture.pages[1]!._embedded.showtimes[2]!] },
          });
        }
        return jsonResponse({ pageSize: 200, pageNumber: 1, count: 0, _embedded: { showtimes: [] } });
      }
      if (url.pathname === "/v2/theatres") return jsonResponse({ error: "unsupported" }, 404);
      throw new Error(`Unexpected AMC API URL: ${url.pathname}`);
    });
    vi.stubEnv("AMC_API_KEY", TEST_API_KEY);
    vi.stubGlobal("fetch", request);

    const result = await fetchScreenings(loadConfig({}));

    expect(result.ok).toBe(true);
    const paths = request.mock.calls.map(([input]) => new URL(input.toString()).pathname);
    expect(paths[0]).toBe("/v2/theatres/2116");
    expect(paths).not.toContain("/v2/theatres");
  });

  it("sends the vendor auth header without exposing it in the URL", async () => {
    const request = apiFetch();
    const result = await fetchScreenings(loadConfig({}), deps(request));

    expect(result.ok).toBe(true);
    for (const [input, init] of request.mock.calls) {
      expect(new URL(input instanceof Request ? input.url : input.toString()).search).not.toContain(TEST_API_KEY);
      expect(new Headers(init?.headers).get("X-AMC-Vendor-Key")).toBe(TEST_API_KEY);
    }
  });

  it("applies an abort timeout signal to every AMC request", async () => {
    const request = apiFetch();

    const result = await fetchScreenings(loadConfig({}), deps(request));

    expect(result.ok).toBe(true);
    expect(request).toHaveBeenCalled();
    for (const [, init] of request.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("queries today through plus 180 days and follows pagination", async () => {
    const request = apiFetch();
    await fetchScreenings(loadConfig({}), deps(request));

    const showtimeUrls = request.mock.calls
      .map(([input]) => new URL(input instanceof Request ? input.url : input.toString()))
      .filter((url) => url.pathname.includes("/showtimes/"));
    const dates = new Set(showtimeUrls.map((url) => url.pathname.split("/").at(-1)));

    expect(dates.size).toBe(181);
    expect(dates.has("8-10-2026")).toBe(true);
    expect(dates.has("2-6-2027")).toBe(true);
    expect(showtimeUrls.some((url) => url.pathname.endsWith("/9-22-2026") && url.searchParams.get("page-number") === "2")).toBe(true);
  });

  it("treats a missing per-date showtime resource as an empty date and continues the scan", async () => {
    const baseRequest = apiFetch();
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/v2/theatres/999/showtimes/8-11-2026") {
        return jsonResponse({ error: "schedule not published" }, 404);
      }
      return baseRequest(input, init);
    });

    const result = await fetchScreenings(loadConfig({}), deps(request));

    expect(result.ok && result.screenings).toHaveLength(3);
    expect(
      request.mock.calls.some(([input]) => new URL(input.toString()).pathname === "/v2/theatres/999/showtimes/11-8-2026"),
    ).toBe(true);
  });

  it("fails closed when the complete date window has no raw showtime candidates", async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/v2/theatres/999") return jsonResponse(fixture.theatre);
      if (url.pathname.startsWith("/v2/theatres/999/showtimes/")) {
        return jsonResponse({ pageSize: 200, pageNumber: 1, count: 0, _embedded: { showtimes: [] } });
      }
      throw new Error(`Unexpected AMC API URL: ${url.pathname}`);
    });

    const result = await fetchScreenings(loadConfig({}), deps(request));

    expect(result).toMatchObject({ ok: false, error: "AMC API response suspiciously empty" });
  });

  it("keeps a missing theatre resource fatal", async () => {
    const request = vi.fn(async () => jsonResponse({ error: "not found" }, 404));

    const result = await fetchScreenings(loadConfig({}), deps(request));

    expect(result).toMatchObject({ ok: false, error: "AMC API request failed (404)" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("maps tracked Odyssey IMAX 70mm attributes with booking availability semantics", async () => {
    const result = await fetchScreenings(loadConfig({}), deps(apiFetch()));

    expect(result).toEqual({
      ok: true,
      checkedAt: "2026-08-10T12:00:00.000Z",
      screenings: [
        {
          id: "1001",
          title: "The Odyssey",
          startsAt: "2026-09-22T22:00:00Z",
          localDate: "2026-09-22",
          localTime: "18:00",
          format: "IMAX 70mm",
          bookingUrl: "https://www.amctheatres.com/showtimes/all/2026-09-22/lincoln-square/all/1001",
          availability: "bookable",
        },
        {
          id: "1003",
          title: "Odyssey, The",
          startsAt: "2026-09-23T00:00:00Z",
          localDate: "2026-09-22",
          localTime: "20:00",
          format: "IMAX 70mm",
          bookingUrl: "https://www.amctheatres.com/showtimes/all/2026-09-22/lincoln-square/all/1003",
          availability: "unavailable",
        },
        {
          id: "1004",
          title: "The Odyssey",
          startsAt: "2026-09-23T01:00:00Z",
          localDate: "2026-09-22",
          localTime: "21:00",
          format: "IMAX 70mm",
          bookingUrl: "",
          availability: "unavailable",
        },
      ],
    });
  });

  it("matches configured movie titles case-insensitively as partial titles", async () => {
    const baseRequest = apiFetch();
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("/9-22-2026")) {
        return jsonResponse({
          pageSize: 200,
          pageNumber: 1,
          count: 1,
          _embedded: {
            showtimes: [{
              ...fixture.pages[1]!._embedded.showtimes[2]!,
              id: 2001,
              movieName: "DUNE: PART THREE — IMAX 70MM FAN EVENT",
              sortableMovieName: "Dune: Part Three IMAX Fan Event",
            }],
          },
        });
      }
      return baseRequest(input, init);
    });
    const config = { ...loadConfig({}), trackedTitles: ["  dune: part three  "] };

    const result = await fetchScreenings(config, deps(request));

    expect(result).toMatchObject({
      ok: true,
      screenings: [{ id: "2001", title: "DUNE: PART THREE — IMAX 70MM FAN EVENT" }],
    });
  });

  it("fails closed when the API key is missing", async () => {
    const request = apiFetch();
    const result = await fetchScreenings(loadConfig({}), deps(request, { apiKey: "" }));

    expect(request).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: "AMC_API_KEY is required" });
  });

  it("retries a transient API error and succeeds", async () => {
    const request = apiFetch();
    request.mockImplementationOnce(async () => jsonResponse({ error: "temporary" }, 503));

    const result = await fetchScreenings(loadConfig({}), deps(request));

    expect(result.ok).toBe(true);
    expect(request.mock.calls.filter(([input]) => new URL(input.toString()).pathname === "/v2/theatres/999")).toHaveLength(2);
  });

  it("redacts the key from request errors", async () => {
    const request = vi.fn(async () => {
      throw new Error(`network failure containing ${TEST_API_KEY}`);
    });
    const result = await fetchScreenings(loadConfig({}), deps(request));

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).not.toContain(TEST_API_KEY);
    expect(result.ok ? "" : result.error).toContain("[REDACTED]");
  });

  it("fails closed when the configured theatre identity does not match", async () => {
    const request = apiFetch();
    request.mockImplementationOnce(async () =>
      jsonResponse({ ...fixture.theatre, name: "Another Theatre", longName: "Another Theatre" }),
    );

    const result = await fetchScreenings(loadConfig({}), deps(request));

    expect(result).toMatchObject({ ok: false, error: "AMC theatre identity mismatch" });
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
  ])("fails closed when the configured theatre slug is %s", async (_label, slug) => {
    const request = apiFetch();
    const { slug: _fixtureSlug, ...theatreWithoutSlug } = fixture.theatre;
    request.mockImplementationOnce(async () =>
      jsonResponse(slug === undefined ? theatreWithoutSlug : { ...theatreWithoutSlug, slug }),
    );

    const result = await fetchScreenings(loadConfig({}), deps(request));

    expect(result).toMatchObject({ ok: false, error: "AMC theatre identity mismatch" });
  });

});
