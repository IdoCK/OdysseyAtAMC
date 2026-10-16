export type Availability = "bookable" | "unavailable";

export interface Screening {
  id: string;
  title: string;
  startsAt: string;
  localDate: string;
  localTime: string;
  format: "IMAX 70mm";
  bookingUrl: string;
  availability: Availability;
}

export interface MonitorState {
  version: 1;
  initialized: boolean;
  screenings: Record<string, Screening>;
  lastSuccessfulCheck: string | null;
  consecutiveFailures: number;
  warnedForFailureEpisode: boolean;
  lastNewScreeningDate: string | null;
  lastDailyStatusDate: string | null;
}

export type FetchResult =
  | { ok: true; checkedAt: string; screenings: Screening[] }
  | { ok: false; checkedAt: string; error: string };

export type TransitionResult =
  | { kind: "baseline" | "silent" | "recovered"; state: MonitorState }
  | { kind: "notify"; state: MonitorState; screenings: Screening[] }
  | { kind: "failure-silent"; state: MonitorState; error: string }
  | { kind: "failure-warning"; state: MonitorState; error: string };

export interface MonitorConfig {
  theaterUrl: string;
  trackedTitles: readonly string[];
  dailyStatusTitles: readonly string[];
  timezone: "America/New_York";
  statePath: string;
  maxAttempts: number;
}
