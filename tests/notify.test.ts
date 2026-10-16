import { describe, expect, it } from "vitest";
import { formatFailureWarning, formatScreeningNotification } from "../src/notify.js";

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

describe("formatScreeningNotification", () => {
  it("gives every screening its own direct link and omits the theater name", () => {
    const message = formatScreeningNotification([
      screening,
      {
        ...screening,
        id: "2",
        startsAt: "2026-09-22T22:00:00-04:00",
        localTime: "22:00",
        bookingUrl: "https://www.amctheatres.com/showtimes/2",
      },
    ]);

    expect(message).toContain("- The Odyssey — Tue, Sep 22 — 6:00 PM — [Book](https://www.amctheatres.com/showtimes/1)");
    expect(message).toContain("- The Odyssey — Tue, Sep 22 — 10:00 PM — [Book](https://www.amctheatres.com/showtimes/2)");
    expect(message).not.toContain("Lincoln Square");
  });

  it("uses the singular heading and orders lines by start time", () => {
    const one = formatScreeningNotification([screening]);
    const ordered = formatScreeningNotification([
      { ...screening, id: "late", startsAt: "2026-09-22T22:00:00-04:00", bookingUrl: "https://example.test/late" },
      { ...screening, id: "early", bookingUrl: "https://example.test/early" },
    ]);

    expect(one).toMatch(/^New IMAX 70mm screening is available:/);
    expect(ordered.indexOf("https://example.test/early")).toBeLessThan(ordered.indexOf("https://example.test/late"));
  });

  it("orders repeated fall DST-hour screenings by their absolute start time", () => {
    const message = formatScreeningNotification([
      {
        ...screening,
        id: "later-est",
        startsAt: "2026-11-01T01:30:00-05:00",
        bookingUrl: "https://example.test/later-est",
      },
      {
        ...screening,
        id: "earlier-edt",
        startsAt: "2026-11-01T01:45:00-04:00",
        bookingUrl: "https://example.test/earlier-edt",
      },
    ]);

    expect(message.indexOf("https://example.test/earlier-edt")).toBeLessThan(message.indexOf("https://example.test/later-est"));
  });
});

it("keeps only the concise error text in a failure warning", () => {
  const warning = formatFailureWarning("AMC request blocked\n    at request (client.ts:42:9)");

  expect(warning).toContain("AMC checks failed three times");
  expect(warning).toContain("AMC request blocked");
  expect(warning).not.toContain("at request");
});
