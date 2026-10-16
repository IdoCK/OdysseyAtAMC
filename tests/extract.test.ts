import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { classifyCandidate } from "../src/amc/classify.js";
import { extractCandidates, normalizeExtractedCandidates } from "../src/amc/extract.js";
import fixture from "./fixtures/amc-candidates.json" with { type: "json" };

it("deduplicates extracted candidates by href and datetime", () => {
  expect(normalizeExtractedCandidates([...fixture, fixture[0]!])).toHaveLength(2);
});

it(
  "associates rendered showtimes with their own date, format, link, disabled state, and auditorium",
  async () => {
    const html = await readFile(new URL("./fixtures/amc-rendered-showtimes.html", import.meta.url), "utf8");
    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext({ timezoneId: "America/New_York" });
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: "domcontentloaded" });

      const candidates = await extractCandidates(page);
      const genericImax = candidates.find((candidate) => candidate.href.endsWith("/143822210"));

      expect(genericImax).toMatchObject({
        movieText: "The Odyssey",
        formatText: "IMAX",
        dateTime: "2026-09-22T22:00:00.000Z",
        href: "https://www.amctheatres.com/showtimes/143822210",
        disabled: false,
        auditorium: "Auditorium 1",
      });
      expect(classifyCandidate(genericImax!, "America/New_York")).toBeNull();
      expect(candidates).toContainEqual({
        movieText: "The Odyssey",
        formatText: "The IMAX 70mm Experience",
        dateTime: "2026-09-22T18:00:00-04:00",
        href: "https://www.amctheatres.com/showtimes/143822211",
        disabled: false,
        auditorium: "Auditorium 2",
      });
      expect(candidates).toContainEqual({
        movieText: "The Odyssey",
        formatText: "IMAX 70mm",
        dateTime: "2026-09-22T21:00:00-04:00",
        href: "",
        disabled: true,
        auditorium: "Auditorium 3",
      });
      expect(candidates).toContainEqual({
        movieText: "Another Movie",
        formatText: "Dolby Cinema",
        dateTime: "2026-09-23T23:15:00.000Z",
        href: "https://www.amctheatres.com/showtimes/143822299",
        disabled: false,
        auditorium: "Auditorium 4",
      });
      expect(candidates).toContainEqual({
        movieText: "The Odyssey",
        formatText: "The IMAX 70mm Experience",
        dateTime: "2026-09-23T20:30:00-04:00",
        href: "https://www.amctheatres.com/showtimes/143822300",
        disabled: false,
        auditorium: "Auditorium 5",
      });
      expect(candidates).toHaveLength(5);
    } finally {
      await browser.close();
    }
  },
  20_000,
);
