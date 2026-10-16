import { describe, expect, it } from "vitest";
import { classifyCandidate } from "../src/amc/classify.js";

const base = {
  movieText: "The Odyssey",
  formatText: "The IMAX 70mm Experience",
  dateTime: "2026-09-22T18:00:00-04:00",
  href: "https://www.amctheatres.com/showtimes/143822211?ref=theater",
  disabled: false,
};

describe("classifyCandidate", () => {
  it("accepts a partial match from a supplied title list and preserves the displayed title", () => {
    const candidate = { ...base, movieText: "Dune: Part Three IMAX Fan Event" };

    expect(classifyCandidate(candidate, "America/New_York", ["dune: part three"])).toMatchObject({
      title: "Dune: Part Three IMAX Fan Event",
    });
  });

  it("normalizes a qualifying screening and strips tracking parameters", () => {
    expect(classifyCandidate(base, "America/New_York")).toEqual({
      id: "143822211",
      title: "The Odyssey",
      startsAt: "2026-09-22T18:00:00-04:00",
      localDate: "2026-09-22",
      localTime: "18:00",
      format: "IMAX 70mm",
      bookingUrl: "https://www.amctheatres.com/showtimes/143822211",
      availability: "bookable",
    });
  });

  it.each(["IMAX", "IMAX with Laser", "70mm", "Dolby Cinema"])(
    "rejects non-qualifying format %s",
    (formatText) => expect(classifyCandidate({ ...base, formatText }, "America/New_York")).toBeNull(),
  );

  it("rejects the wrong movie", () => {
    expect(classifyCandidate({ ...base, movieText: "Another Movie" }, "America/New_York")).toBeNull();
  });

  it("uses a stable fallback identity when no showtime id exists", () => {
    const result = classifyCandidate(
      { ...base, href: "https://www.amctheatres.com/movies/the-odyssey", auditorium: "IMAX" },
      "America/New_York",
    );

    expect(result?.id).toBe("2026-09-22|18:00|IMAX 70mm|IMAX");
    expect(result?.availability).toBe("unavailable");
  });
});
