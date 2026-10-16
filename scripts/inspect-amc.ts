import { chromium } from "playwright";
import { extractCandidates } from "../src/amc/extract.js";
import { loadConfig } from "../src/config.js";

const config = loadConfig(process.env);
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    timezoneId: config.timezone,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(config.theaterUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const candidates = await extractCandidates(page);

  console.log(
    JSON.stringify(
      candidates.map((candidate) => ({
        movieText: candidate.movieText,
        formatText: candidate.formatText,
        dateTime: candidate.dateTime,
        pathname: candidate.href ? new URL(candidate.href, config.theaterUrl).pathname : "",
        disabled: candidate.disabled,
        auditorium: candidate.auditorium ?? "",
      })),
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
