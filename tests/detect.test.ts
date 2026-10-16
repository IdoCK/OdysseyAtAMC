import { describe, expect, it } from "vitest";
import { createEmptyState, transition } from "../src/detect.js";
import type { Screening } from "../src/domain.js";

const screening: Screening = {
  id: "143822211",
  title: "The Odyssey",
  startsAt: "2026-09-22T18:00:00-04:00",
  localDate: "2026-09-22",
  localTime: "18:00",
  format: "IMAX 70mm" as const,
  bookingUrl: "https://www.amctheatres.com/showtimes/143822211",
  availability: "bookable" as const,
};
const success = (screenings: Screening[] = [screening]) => ({
  ok: true as const,
  checkedAt: "2026-08-10T12:00:00.000Z",
  screenings,
});

describe("transition", () => {
  it("creates a silent baseline", () =>
    expect(transition(createEmptyState(), success()).kind).toBe("baseline"));

  it("notifies once for a new screening", () => {
    const baseline = transition(createEmptyState(), success([])).state;
    const first = transition(baseline, success());
    expect(first.kind).toBe("notify");
    expect(first.state.lastNewScreeningDate).toBe("2026-08-10");
    expect(transition(first.state, success()).kind).toBe("silent");
  });

  it("warns once on the third consecutive failure", () => {
    const fail = {
      ok: false as const,
      checkedAt: "2026-08-10T12:00:00.000Z",
      error: "blocked",
    };
    const one = transition(createEmptyState(), fail);
    const two = transition(one.state, fail);
    const three = transition(two.state, fail);
    expect([one.kind, two.kind, three.kind]).toEqual([
      "failure-silent",
      "failure-silent",
      "failure-warning",
    ]);
    expect(transition(three.state, fail).kind).toBe("failure-silent");
  });

  it("notifies when a known unavailable screening becomes bookable", () => {
    const unavailable = { ...screening, availability: "unavailable" as const };
    const baseline = transition(createEmptyState(), success([unavailable])).state;
    const result = transition(baseline, success());

    expect(result.kind).toBe("notify");
    expect(result.kind === "notify" && result.screenings).toEqual([screening]);
  });

  it("retains absent screenings and observes their reappearance without duplicate notification", () => {
    const baseline = transition(createEmptyState(), success([screening])).state;
    const absent = transition(baseline, success([]));
    const reappeared = transition(absent.state, success());

    expect(absent.state.screenings).toEqual({ [screening.id]: screening });
    expect(reappeared.kind).toBe("silent");
  });

  it("prunes expired screenings after a successful check while retaining future screenings", () => {
    const expired = { ...screening, id: "expired", startsAt: "2026-08-09T18:00:00-04:00" };
    const baseline = transition(createEmptyState(), success([expired, screening])).state;

    const result = transition(baseline, success([]));

    expect(result.state.screenings).toEqual({ [screening.id]: screening });
  });

  it("retains valid screenings while recording a failed check", () => {
    const baseline = transition(createEmptyState(), success()).state;
    const failure = transition(baseline, {
      ok: false as const,
      checkedAt: "2026-08-10T13:00:00.000Z",
      error: "timeout",
    });

    expect(failure.state.screenings).toEqual({ [screening.id]: screening });
    expect(failure.state.lastSuccessfulCheck).toBe("2026-08-10T12:00:00.000Z");
  });

  it("sorts new notifications by start time", () => {
    const later = { ...screening, id: "later", startsAt: "2026-09-23T18:00:00-04:00" };
    const earlier = { ...screening, id: "earlier", startsAt: "2026-09-21T18:00:00-04:00" };
    const baseline = transition(createEmptyState(), success([])).state;
    const result = transition(baseline, success([later, earlier]));

    expect(result.kind === "notify" && result.screenings.map(({ id }) => id)).toEqual([
      "earlier",
      "later",
    ]);
  });
});
