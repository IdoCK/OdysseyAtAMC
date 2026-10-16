import type { Screening } from "../domain.js";
import { isTrackedTitle, TRACKED_TITLES } from "../Titles.js";

export interface CandidateListing {
  movieText: string;
  formatText: string;
  dateTime: string;
  href: string;
  disabled: boolean;
  auditorium?: string;
}

const FORMAT = /^(?:the\s+)?imax\s*70\s*mm(?:\s+experience)?$/i;

export function classifyCandidate(
  candidate: CandidateListing,
  timezone: string,
  trackedTitles: readonly string[] = TRACKED_TITLES,
): Screening | null {
  if (!isTrackedTitle(candidate.movieText, trackedTitles) || !FORMAT.test(candidate.formatText.trim())) {
    return null;
  }

  const date = new Date(candidate.dateTime);
  if (Number.isNaN(date.valueOf())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const localDate = `${value("year")}-${value("month")}-${value("day")}`;
  const localTime = `${value("hour")}:${value("minute")}`;
  const url = new URL(candidate.href, "https://www.amctheatres.com");
  const match = url.pathname.match(/^\/showtimes\/(\d+)/);
  const id = match?.[1] ?? `${localDate}|${localTime}|IMAX 70mm|${candidate.auditorium ?? ""}`;
  const bookingUrl = match ? `https://www.amctheatres.com/showtimes/${id}` : url.origin + url.pathname;

  return {
    id,
    title: candidate.movieText.trim(),
    startsAt: candidate.dateTime,
    localDate,
    localTime,
    format: "IMAX 70mm",
    bookingUrl,
    availability: !candidate.disabled && Boolean(match) ? "bookable" : "unavailable",
  };
}
