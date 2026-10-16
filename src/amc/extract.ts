import type { Locator, Page } from "playwright";
import type { CandidateListing } from "./classify.js";

const SHOWTIME_LINK_SELECTOR = 'a[href*="/showtimes/"]';
const CANDIDATE_SELECTOR = `${SHOWTIME_LINK_SELECTOR}, button:disabled, [role="button"][aria-disabled="true"]`;
const DATE_CONTROL_SELECTOR = [
  '[data-testid*="date" i] button',
  '[data-testid*="date" i] [role="tab"]',
  '[class*="date" i] button',
  '[class*="date" i] [role="tab"]',
  'button[data-date]',
  '[role="tab"][data-date]',
  '[role="tab"][aria-label]',
].join(", ");

export function normalizeExtractedCandidates(candidates: CandidateListing[]): CandidateListing[] {
  const unique = new Map<string, CandidateListing>();

  for (const candidate of candidates) {
    const key = `${candidate.href}|${candidate.dateTime}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }

  return [...unique.values()];
}

async function dismissCookieDialog(page: Page): Promise<void> {
  const accept = page
    .getByRole("button", { name: /^(?:accept(?: all)?(?: cookies)?|allow all|i agree)$/i })
    .first();

  if (await accept.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await accept.click({ timeout: 2_000 }).catch(() => undefined);
  }
}

async function dateControlLabel(control: Locator): Promise<string> {
  return control.evaluate((element) => {
    const attributes = [
      element.getAttribute("data-date"),
      element.getAttribute("datetime"),
      element.getAttribute("aria-label"),
      element.textContent,
    ];
    return attributes.find((value) => value?.trim())?.trim() ?? "";
  });
}

async function isDateControl(control: Locator): Promise<boolean> {
  return control.evaluate((element) => {
    if (element.hasAttribute("data-date") || element.hasAttribute("datetime")) return true;

    const text = `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`;
    return (
      /\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/i.test(text) ||
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i.test(text) ||
      /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(text)
    );
  });
}

async function collectVisibleCandidates(page: Page, selectedDate: string): Promise<CandidateListing[]> {
  const raw = await page.locator(CANDIDATE_SELECTOR).evaluateAll((elements, dateLabel) => {
    const timePattern = /\b(?:1[0-2]|0?\d):[0-5]\d\s*(?:a\.?m\.?|p\.?m\.?)\b/i;
    const helpers = {
      clean(value: string | null | undefined): string {
        return (value ?? "").replace(/\s+/g, " ").trim();
      },
      shortest(items: string[]): string {
        return items.sort((a, b) => a.length - b.length)[0] ?? "";
      },
      nearestHeading(element: Element, card: Element): string {
        const localHeading = card.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']");
        if (localHeading) return helpers.clean(localHeading.textContent).split(" | ")[0] ?? "";

        const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading']"));
        const preceding = headings.filter(
          (heading) => Boolean(heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING),
        );
        return helpers.clean(preceding.at(-1)?.textContent).split(" | ")[0] ?? "";
      },
      showtimeScope(element: Element): Element {
        return (
          element.closest(
            "[data-testid*='showtime' i], [class*='showtime' i], [class*='time-slot' i], [class*='session' i]",
          ) ??
          element.parentElement?.closest("[data-showtime]") ??
          element.parentElement ??
          element
        );
      },
      formatFrom(element: Element, showtime: Element): string {
        const formatAttributes = ["data-format", "data-experience", "data-presentation"];
        const values = [
          ...formatAttributes.map((attribute) => helpers.clean(element.getAttribute(attribute))),
          ...formatAttributes.map((attribute) => helpers.clean(showtime.getAttribute(attribute))),
          ...Array.from(
            showtime.querySelectorAll(
              "[data-format], [data-experience], [data-presentation], [data-testid*='format' i], [class*='format' i]",
            ),
          ).flatMap((node) => [
            ...formatAttributes.map((attribute) => helpers.clean(node.getAttribute(attribute))),
            helpers.clean(node.getAttribute("aria-label")),
            helpers.clean(node.textContent),
          ]),
        ].filter(
          (value, index, all) =>
            value.length > 0 &&
            value.length <= 120 &&
            /\b(?:imax|70\s*mm|dolby|digital|prime|laser)\b/i.test(value) &&
            all.indexOf(value) === index,
        );

        return helpers.shortest(values);
      },
      auditoriumFrom(element: Element, showtime: Element): string {
        const attributed = helpers.clean(
          element.getAttribute("data-auditorium") ?? showtime.getAttribute("data-auditorium"),
        );
        if (attributed) return attributed;

        const label = showtime.querySelector(
          "[data-auditorium], [data-testid*='auditorium' i], [class*='auditorium' i], [aria-label*='auditorium' i]",
        );
        return helpers.clean(label?.getAttribute("data-auditorium") ?? label?.getAttribute("aria-label") ?? label?.textContent);
      },
      machineDateTime(element: Element, card: Element): string {
        const wrapper =
          element.closest("[data-datetime], [data-date-time], [data-showtime], time") ?? element.parentElement;
        const timeElement = element.matches("time") ? element : wrapper?.querySelector("time[datetime]");
        const possible = [
          element.getAttribute("datetime"),
          element.getAttribute("data-datetime"),
          element.getAttribute("data-date-time"),
          element.getAttribute("data-showtime"),
          element.getAttribute("data-start-time"),
          wrapper?.getAttribute("datetime"),
          wrapper?.getAttribute("data-datetime"),
          wrapper?.getAttribute("data-date-time"),
          wrapper?.getAttribute("data-showtime"),
          timeElement?.getAttribute("datetime"),
        ].map(helpers.clean);

        for (const value of possible) {
          if (!value) continue;
          if (/^\d{10,13}$/.test(value)) {
            const milliseconds = value.length === 10 ? Number(value) * 1_000 : Number(value);
            return new Date(milliseconds).toISOString();
          }
          if (!Number.isNaN(Date.parse(value)) && /\d/.test(value)) return value;
        }

        const visible = helpers.clean(
          element.getAttribute("aria-label") ?? element.textContent ?? wrapper?.textContent ?? card.textContent,
        );
        const visibleTime = visible.match(timePattern)?.[0];
        if (!visibleTime || !dateLabel) return "";

        const parsed = new Date(`${dateLabel} ${visibleTime}`);
        if (Number.isNaN(parsed.valueOf())) return "";

        const now = new Date();
        if (!/\b\d{4}\b/.test(dateLabel) && parsed.valueOf() < now.valueOf() - 31 * 24 * 60 * 60 * 1_000) {
          parsed.setFullYear(parsed.getFullYear() + 1);
        }
        return parsed.toISOString();
      },
    };

    return elements.flatMap((element) => {
      if (element.closest("[hidden], [aria-hidden='true']")) return [];
      if (element instanceof HTMLElement) {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return [];
      }

      const link = element.closest("a[href]") ?? element.querySelector("a[href]");
      const hrefValue = link?.getAttribute("href") ?? "";
      const isShowtimeLink = hrefValue.includes("/showtimes/");
      const disabled =
        !isShowtimeLink ||
        element.matches(":disabled") ||
        element.getAttribute("aria-disabled") === "true" ||
        link?.getAttribute("aria-disabled") === "true";
      const visible = helpers.clean(element.getAttribute("aria-label") ?? element.textContent);

      if (!isShowtimeLink && (!disabled || !timePattern.test(visible))) return [];

      const showtime = helpers.showtimeScope(element);
      const card =
        element.closest(
          "article, [data-testid*='movie' i], [class*='movie-card' i], [class*='film-card' i]",
        ) ?? showtime;
      const candidate = {
        movieText: helpers.nearestHeading(element, card),
        formatText: helpers.formatFrom(element, showtime),
        dateTime: helpers.machineDateTime(element, showtime),
        href: hrefValue ? new URL(hrefValue, location.href).href : "",
        disabled,
        auditorium: helpers.auditoriumFrom(element, showtime),
      };

      return [candidate];
    });
  }, selectedDate);

  return raw.map((candidate) => {
    const base: CandidateListing = {
      movieText: candidate.movieText,
      formatText: candidate.formatText,
      dateTime: candidate.dateTime,
      href: candidate.href,
      disabled: candidate.disabled,
    };
    return candidate.auditorium ? { ...base, auditorium: candidate.auditorium } : base;
  });
}

export async function extractCandidates(page: Page): Promise<CandidateListing[]> {
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  await dismissCookieDialog(page);

  const controls = await page.locator(DATE_CONTROL_SELECTOR).all();
  const dates: Array<{ control: Locator; label: string }> = [];
  const seenLabels = new Set<string>();

  for (const control of controls) {
    if (!(await control.isVisible().catch(() => false))) continue;
    if (!(await control.isEnabled().catch(() => false))) continue;
    if (!(await isDateControl(control).catch(() => false))) continue;
    const label = await dateControlLabel(control).catch(() => "");
    if (!label || seenLabels.has(label)) continue;
    seenLabels.add(label);
    dates.push({ control, label });
  }

  if (dates.length === 0) return normalizeExtractedCandidates(await collectVisibleCandidates(page, ""));

  const candidates: CandidateListing[] = [];
  for (const { control, label } of dates) {
    await control.click({ timeout: 5_000 });
    await page.locator(SHOWTIME_LINK_SELECTOR).first().waitFor({ state: "attached", timeout: 5_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    candidates.push(...(await collectVisibleCandidates(page, label)));
  }

  return normalizeExtractedCandidates(candidates);
}
