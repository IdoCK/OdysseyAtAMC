import type { Screening } from "./domain.js";

const timezone = "America/New_York";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: timezone,
  weekday: "short",
  month: "short",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: timezone,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatScreeningNotification(screenings: Screening[]): string {
  const heading = screenings.length === 1
    ? "New IMAX 70mm screening is available:"
    : "New IMAX 70mm screenings are available:";
  const lines = screenings
    .map((screening, index) => ({ screening, index }))
    .sort((left, right) => {
      const chronologicalOrder = new Date(left.screening.startsAt).valueOf() - new Date(right.screening.startsAt).valueOf();
      return chronologicalOrder || left.index - right.index;
    })
    .map(({ screening }) => {
      const startsAt = new Date(screening.startsAt);
      return `- ${screening.title} — ${dateFormatter.format(startsAt)} — ${timeFormatter.format(startsAt)} — [Book](${screening.bookingUrl})`;
    });

  return [heading, ...lines].join("\n");
}

export function formatFailureWarning(error: string): string {
  return `AMC checks failed three times. Last error: ${sanitizeError(error)}`;
}

export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim();
  return firstLine || "Unknown error";
}
