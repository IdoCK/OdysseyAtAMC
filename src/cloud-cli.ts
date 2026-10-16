import { fileURLToPath } from "node:url";
import { fetchScreenings } from "./amc/client.js";
import { runCloudMonitor, type CloudRunDependencies } from "./cloud/run.js";
import { sendTelegramMessages } from "./cloud/telegram.js";
import { loadConfig } from "./config.js";
import type { FetchResult, MonitorConfig, MonitorState } from "./domain.js";
import { displayDate, easternIsoDate } from "./eastern-date.js";
import { sanitizeError } from "./notify.js";
import { readState, writeState } from "./state/store.js";

type CloudMonitorMarker = "MONITOR_OK" | "MONITOR_NOTIFY" | "MONITOR_WARNING";
export type CloudCliMarker =
  | "TELEGRAM_TEST_OK"
  | "DAILY_STATUS_TEST_OK"
  | "MONITOR_DAILY_STATUS"
  | CloudMonitorMarker;

export interface CloudCliDependencies {
  write: (text: string) => void;
  loadConfig: (env: NodeJS.ProcessEnv) => MonitorConfig;
  fetchScreenings: (config: MonitorConfig) => Promise<FetchResult>;
  readState: (path: string) => Promise<MonitorState>;
  writeState: (path: string, state: MonitorState) => Promise<void>;
  runCloudMonitor: (deps: CloudRunDependencies) => Promise<CloudMonitorMarker>;
  sendTelegramMessages: (
    config: { botToken: string; chatId: string },
    text: string,
    options?: { silent?: boolean },
  ) => Promise<void>;
}

const telegramTestMessage = "AMC monitor test \u2014 Telegram delivery is working.";

export async function runCloudCli(
  env: NodeJS.ProcessEnv = process.env,
  deps: CloudCliDependencies = createDefaultDependencies(),
): Promise<CloudCliMarker> {
  if (env.TELEGRAM_TEST_ONLY === "true") {
    const telegramConfig = readTelegramConfig(env);
    await deps.sendTelegramMessages(telegramConfig, telegramTestMessage);
    return emit("TELEGRAM_TEST_OK", deps.write);
  }

  const telegramConfig = readTelegramConfig(env);
  if (env.DAILY_STATUS_TEST_ONLY === "true") {
    const config = deps.loadConfig(env);
    const today = easternIsoDate(env.CLOUD_NOW ?? new Date());
    await deps.sendTelegramMessages(telegramConfig, formatDailyStatus(today, config.dailyStatusTitles), { silent: true });
    return emit("DAILY_STATUS_TEST_OK", deps.write);
  }

  if (env.DAILY_STATUS_ONLY === "true") {
    const config = deps.loadConfig(env);
    const state = await deps.readState(config.statePath);
    const today = easternIsoDate(env.CLOUD_NOW ?? new Date());
    if (
      !state.initialized ||
      state.lastNewScreeningDate === today ||
      state.lastDailyStatusDate === today
    ) {
      return emit("MONITOR_OK", deps.write);
    }

    await deps.sendTelegramMessages(
      telegramConfig,
      formatDailyStatus(today, config.dailyStatusTitles),
      { silent: true },
    );
    await deps.writeState(config.statePath, { ...state, lastDailyStatusDate: today });
    return emit("MONITOR_DAILY_STATUS", deps.write);
  }

  if (!env.AMC_API_KEY?.trim()) {
    throw new Error("AMC API configuration is required");
  }

  const config = deps.loadConfig(env);
  const marker = await deps.runCloudMonitor({
    readState: () => deps.readState(config.statePath),
    writeState: (state) => deps.writeState(config.statePath, state),
    fetchScreenings: () => deps.fetchScreenings(config),
    sendNotification: (message, options) => deps.sendTelegramMessages(
      telegramConfig,
      message,
      { silent: !options.loud },
    ),
  });
  return emit(marker, deps.write);
}

function formatDailyStatus(date: string, titles: readonly string[]): string {
  return `${displayDate(date)} - No new screenings detected for all movies in movie list - ${titles.join(", ")}`;
}

export async function runCloudCliProcess(
  env: NodeJS.ProcessEnv = process.env,
  deps: CloudCliDependencies = createDefaultDependencies(),
): Promise<0 | 1> {
  try {
    await runCloudCli(env, deps);
    return 0;
  } catch (error) {
    deps.write(`MONITOR_WARNING\nCloud monitor failed: ${sanitizeError(error)}\n`);
    return 1;
  }
}

function readTelegramConfig(env: NodeJS.ProcessEnv): { botToken: string; chatId: string } {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = env.TELEGRAM_CHAT_ID?.trim() ?? "";
  if (!botToken || !chatId) throw new Error("Telegram configuration is required");
  return { botToken, chatId };
}

function emit(marker: CloudCliMarker, write: (text: string) => void): CloudCliMarker {
  write(`${marker}\n`);
  return marker;
}

function createDefaultDependencies(): CloudCliDependencies {
  return {
    write: (text) => process.stdout.write(text),
    loadConfig,
    fetchScreenings,
    readState,
    writeState,
    runCloudMonitor,
    sendTelegramMessages: (config, text, options) => sendTelegramMessages(config, text, fetch, options),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runCloudCliProcess().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
