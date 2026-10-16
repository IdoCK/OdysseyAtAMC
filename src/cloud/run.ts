import { transition } from "../detect.js";
import type { FetchResult, MonitorState } from "../domain.js";
import { formatFailureWarning, formatScreeningNotification } from "../notify.js";

export interface CloudRunDependencies {
  readState: () => Promise<MonitorState>;
  writeState: (state: MonitorState) => Promise<void>;
  fetchScreenings: () => Promise<FetchResult>;
  sendNotification: (message: string, options: { loud: boolean }) => Promise<void>;
}

export async function runCloudMonitor(
  deps: CloudRunDependencies,
): Promise<"MONITOR_OK" | "MONITOR_NOTIFY" | "MONITOR_WARNING"> {
  const state = await deps.readState();
  const fetchResult = await deps.fetchScreenings();
  const result = transition(state, fetchResult);

  switch (result.kind) {
    case "notify":
      await deps.sendNotification(formatScreeningNotification(result.screenings), { loud: true });
      await deps.writeState(result.state);
      return "MONITOR_NOTIFY";
    case "failure-warning":
      await deps.sendNotification(formatFailureWarning(result.error), { loud: false });
      await deps.writeState(result.state);
      return "MONITOR_WARNING";
    case "baseline":
    case "silent":
    case "recovered":
    case "failure-silent":
      await deps.writeState(result.state);
      return "MONITOR_OK";
  }
}
