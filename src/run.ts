import { transition } from "./detect.js";
import type { FetchResult, MonitorState } from "./domain.js";
import { formatFailureWarning, formatScreeningNotification } from "./notify.js";

export type RunOutput =
  | { marker: "MONITOR_OK"; message: "" }
  | { marker: "MONITOR_NOTIFY"; message: string }
  | { marker: "MONITOR_WARNING"; message: string };

export interface RunDependencies {
  readState: () => Promise<MonitorState>;
  writeState: (state: MonitorState) => Promise<void>;
  fetchScreenings: () => Promise<FetchResult>;
}

export async function runMonitor(deps: RunDependencies): Promise<RunOutput> {
  const state = await deps.readState();
  const fetchResult = await deps.fetchScreenings();
  const result = transition(state, fetchResult);
  await deps.writeState(result.state);

  switch (result.kind) {
    case "notify":
      return { marker: "MONITOR_NOTIFY", message: formatScreeningNotification(result.screenings) };
    case "failure-warning":
      return { marker: "MONITOR_WARNING", message: formatFailureWarning(result.error) };
    case "baseline":
    case "silent":
    case "recovered":
    case "failure-silent":
      return { marker: "MONITOR_OK", message: "" };
  }
}
