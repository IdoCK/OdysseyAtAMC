import { z } from "zod";
import type { MonitorConfig, Screening } from "../domain.js";
import { isTrackedTitle } from "../Titles.js";

const AMC_API_BASE = "https://api.amctheatres.com";
const AMC_THEATRE_NAME = "AMC Lincoln Square 13";
const AMC_THEATRE_SLUG = "amc-lincoln-square-13";
const PAGE_SIZE = 200;
const WINDOW_DAYS = 180;
const CONCURRENCY = 4;
const MAX_PAGES = 10;
const RETRY_DELAYS_MS = [1_000, 3_000] as const;
const REQUEST_TIMEOUT_MS = 15_000;
const IMAX_70MM = /^(?:the\s+)?imax\s*70\s*mm(?:\s+experience)?$/i;

export const VERIFIED_AMC_LINCOLN_SQUARE_ID = 2116;

const attributeSchema = z
  .object({
    code: z.string().optional().default(""),
    name: z.string().optional().default(""),
    description: z.string().optional().default(""),
  })
  .passthrough();

const showtimeSchema = z
  .object({
    id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
    movieName: z.string().optional().default(""),
    sortableMovieName: z.string().optional().default(""),
    showDateTimeUtc: z.string().datetime({ offset: true }),
    sellUntilDateTimeUtc: z.string().datetime({ offset: true }).optional(),
    isSoldOut: z.boolean().optional().default(false),
    isCanceled: z.boolean().optional().default(false),
    purchaseUrl: z.string().optional(),
    auditorium: z.union([z.number(), z.string()]).optional(),
    attributes: z.array(attributeSchema).optional().default([]),
  })
  .passthrough();

const showtimePageSchema = z
  .object({
    pageSize: z.number().int().positive(),
    pageNumber: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    _embedded: z
      .object({ showtimes: z.array(showtimeSchema).optional().default([]) })
      .optional()
      .default({ showtimes: [] }),
  })
  .passthrough();

const theatreSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().optional().default(""),
    longName: z.string().optional().default(""),
    slug: z.string().optional().default(""),
  })
  .passthrough();

type Showtime = z.infer<typeof showtimeSchema>;
type ShowtimePage = z.infer<typeof showtimePageSchema>;
type Theatre = z.infer<typeof theatreSchema>;

export type AmcRequest = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface AmcApiDeps {
  request: AmcRequest;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  apiKey: string;
  theatreId: number;
}

export interface AmcApiSnapshot {
  httpStatus: 200;
  theatre: { id: number; name: string };
  candidateCount: number;
  dateSpan: { from: string; to: string };
  screenings: Screening[];
}

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}

function pageCount(count: number, pageSize: number): number {
  return Math.max(1, Math.ceil(count / pageSize));
}

async function requestJson<T>(
  url: URL,
  schema: z.ZodType<T>,
  config: MonitorConfig,
  deps: AmcApiDeps,
): Promise<T> {
  for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
    try {
      const response = await deps.request(url, {
        method: "GET",
        headers: { "X-AMC-Vendor-Key": deps.apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new ApiRequestError(`AMC API request failed (${response.status})`, retryable, response.status);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ApiRequestError("AMC API returned invalid JSON", false);
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new ApiRequestError("AMC API response validation failed", false);
      return parsed.data;
    } catch (error) {
      const canRetry = !(error instanceof ApiRequestError) || error.retryable;
      if (!canRetry || attempt + 1 >= config.maxAttempts) throw error;
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 3_000;
      await deps.sleep(delay);
    }
  }

  throw new Error("AMC API request failed");
}

function isLincolnSquare(theatre: Theatre): boolean {
  const names = [theatre.name, theatre.longName].map((value) => value.trim().toLowerCase());
  return names.includes(AMC_THEATRE_NAME.toLowerCase()) &&
    theatre.slug.trim().toLowerCase() === AMC_THEATRE_SLUG;
}

async function resolveTheatre(config: MonitorConfig, deps: AmcApiDeps): Promise<Theatre> {
  const theatre = await requestJson(
    new URL(`/v2/theatres/${deps.theatreId}`, AMC_API_BASE),
    theatreSchema,
    config,
    deps,
  );
  if (theatre.id !== deps.theatreId || !isLincolnSquare(theatre)) {
    throw new Error("AMC theatre identity mismatch");
  }
  return theatre;
}

function localDateParts(now: Date, timezone: string): [number, number, number] {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return [value("year"), value("month"), value("day")];
}

function dateWindow(now: Date, timezone: string): Array<{ api: string; iso: string }> {
  const [year, month, day] = localDateParts(now, timezone);
  return Array.from({ length: WINDOW_DAYS + 1 }, (_, offset) => {
    const date = new Date(Date.UTC(year, month - 1, day + offset, 12));
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    return { api: `${m}-${d}-${y}`, iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
  });
}

async function fetchDate(theatreId: number, date: string, config: MonitorConfig, deps: AmcApiDeps): Promise<Showtime[]> {
  const showtimes: Showtime[] = [];
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const url = new URL(`/v2/theatres/${theatreId}/showtimes/${date}`, AMC_API_BASE);
    url.searchParams.set("page-size", String(PAGE_SIZE));
    url.searchParams.set("page-number", String(pageNumber));
    let page: ShowtimePage;
    try {
      page = await requestJson(url, showtimePageSchema, config, deps);
    } catch (error) {
      if (pageNumber === 1 && error instanceof ApiRequestError && error.status === 404) return [];
      throw error;
    }
    showtimes.push(...page._embedded.showtimes);
    const pages = pageCount(page.count, page.pageSize);
    if (pages > MAX_PAGES) throw new Error("AMC API pagination exceeded the safety limit");
    if (pageNumber >= pages) return showtimes;
  }
  return showtimes;
}

async function mapConcurrent<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  });
  await Promise.all(runners);
  return results;
}

function isTrackedMovie(showtime: Showtime, trackedTitles: readonly string[]): boolean {
  return [showtime.movieName, showtime.sortableMovieName]
    .some((title) => isTrackedTitle(title, trackedTitles));
}

function hasExplicitImax70mm(showtime: Showtime): boolean {
  return showtime.attributes.some((attribute) =>
    [attribute.code, attribute.name, attribute.description].some((value) => IMAX_70MM.test(value.trim())),
  );
}

function bookingUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/(?:^|\.)amctheatres\.com$/i.test(url.hostname)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function toScreening(
  showtime: Showtime,
  now: Date,
  timezone: string,
  trackedTitles: readonly string[],
): Screening | null {
  const starts = new Date(showtime.showDateTimeUtc);
  if (showtime.isCanceled || starts.valueOf() <= now.valueOf()) return null;
  if (!isTrackedMovie(showtime, trackedTitles) || !hasExplicitImax70mm(showtime)) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(starts);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const purchaseUrl = bookingUrl(showtime.purchaseUrl);
  const sellUntil = showtime.sellUntilDateTimeUtc ? new Date(showtime.sellUntilDateTimeUtc) : null;
  const unavailable = showtime.isSoldOut || !purchaseUrl || (sellUntil !== null && sellUntil.valueOf() <= now.valueOf());

  return {
    id: String(showtime.id),
    title: showtime.movieName.trim() || showtime.sortableMovieName.trim(),
    startsAt: showtime.showDateTimeUtc,
    localDate: `${value("year")}-${value("month")}-${value("day")}`,
    localTime: `${value("hour")}:${value("minute")}`,
    format: "IMAX 70mm",
    bookingUrl: purchaseUrl,
    availability: unavailable ? "unavailable" : "bookable",
  };
}

export async function queryAmcApi(config: MonitorConfig, deps: AmcApiDeps): Promise<AmcApiSnapshot> {
  if (!deps.apiKey.trim()) throw new Error("AMC_API_KEY is required");
  const now = deps.now();
  const theatre = await resolveTheatre(config, deps);
  const dates = dateWindow(now, config.timezone);
  const pages = await mapConcurrent(dates, CONCURRENCY, (date) => fetchDate(theatre.id, date.api, config, deps));
  const unique = new Map<string, Showtime>();
  for (const showtime of pages.flat()) unique.set(String(showtime.id), showtime);
  if (unique.size === 0) throw new Error("AMC API response suspiciously empty");
  const screenings = [...unique.values()]
    .map((showtime) => toScreening(showtime, now, config.timezone, config.trackedTitles))
    .filter((screening): screening is Screening => screening !== null)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id));

  return {
    httpStatus: 200,
    theatre: { id: theatre.id, name: theatre.longName || theatre.name },
    candidateCount: unique.size,
    dateSpan: { from: dates[0]!.iso, to: dates.at(-1)!.iso },
    screenings,
  };
}
