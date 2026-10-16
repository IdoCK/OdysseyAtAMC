import type { MonitorConfig } from "./domain.js";
import { DAILY_STATUS_TITLES, TRACKED_TITLES } from "./Titles.js";

export function loadConfig(env: NodeJS.ProcessEnv): MonitorConfig {
  return {
    theaterUrl: "https://www.amctheatres.com/movie-theatres/new-york-city/amc-lincoln-square-13",
    trackedTitles: TRACKED_TITLES,
    dailyStatusTitles: DAILY_STATUS_TITLES,
    timezone: "America/New_York",
    statePath: env.MONITOR_STATE_PATH ?? "var/state.json",
    maxAttempts: 3,
  };
}
