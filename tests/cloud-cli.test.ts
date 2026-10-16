import { describe, expect, it } from "vitest";
import { runCloudCli, runCloudCliProcess, type CloudCliDependencies } from "../src/cloud-cli.js";
import { runCloudMonitor as runCloudMonitorTransaction } from "../src/cloud/run.js";
import { createEmptyState } from "../src/detect.js";
import type { MonitorConfig, MonitorState } from "../src/domain.js";

const config: MonitorConfig = {
  theaterUrl: "https://www.amctheatres.com/movie-theatres/new-york-city/amc-lincoln-square-13",
  trackedTitles: ["The Odyssey"],
  dailyStatusTitles: ["The Odyssey"],
  timezone: "America/New_York",
  statePath: "var/state.json",
  maxAttempts: 3,
};

function createDependencies(overrides: Partial<CloudCliDependencies> = {}): CloudCliDependencies {
  return {
    write: () => undefined,
    loadConfig: () => config,
    fetchScreenings: async () => ({
      ok: true,
      checkedAt: "2026-08-13T17:10:00.000Z",
      screenings: [],
    }),
    readState: async () => createEmptyState(),
    writeState: async () => undefined,
    runCloudMonitor: async () => "MONITOR_OK",
    sendTelegramMessages: async () => undefined,
    ...overrides,
  };
}

const configuredEnv: NodeJS.ProcessEnv = {
  AMC_API_KEY: "amc-secret",
  TELEGRAM_BOT_TOKEN: "telegram-secret",
  TELEGRAM_CHAT_ID: "chat-id",
};

describe("runCloudCli", () => {
  it("sends a silent daily-status smoke test without reading state or fetching AMC", async () => {
    const events: string[] = [];

    const result = await runCloudCli(
      {
        TELEGRAM_BOT_TOKEN: "telegram-secret",
        TELEGRAM_CHAT_ID: "chat-id",
        DAILY_STATUS_TEST_ONLY: "true",
        CLOUD_NOW: "2026-08-21T02:00:00.000Z",
      },
      createDependencies({
        loadConfig: () => ({
          ...config,
          dailyStatusTitles: ["The Odyssey", "Dune: Part Three"],
        }),
        readState: async () => {
          events.push("read");
          return createEmptyState();
        },
        fetchScreenings: async () => {
          events.push("fetch");
          return { ok: true, checkedAt: "", screenings: [] };
        },
        sendTelegramMessages: async (_telegramConfig, message, options) => {
          events.push(`send:${String(options?.silent)}:${message}`);
        },
      }),
    );

    expect(result).toBe("DAILY_STATUS_TEST_OK");
    expect(events).toEqual([
      "send:true:20/08/26 - No new screenings detected for all movies in movie list - The Odyssey, Dune: Part Three",
    ]);
  });

  it("sends one silent 10 PM status without fetching AMC when no screening alert was sent today", async () => {
    const events: string[] = [];
    let state: MonitorState = { ...createEmptyState(), initialized: true };

    const env = {
      TELEGRAM_BOT_TOKEN: "telegram-secret",
      TELEGRAM_CHAT_ID: "chat-id",
      DAILY_STATUS_ONLY: "true",
      CLOUD_NOW: "2026-08-21T02:00:00.000Z",
    };
    const dependencies = createDependencies({
      loadConfig: () => ({
        ...config,
        trackedTitles: ["The Odyssey", "Dune: Part Three", "Dune: Messiah"],
        dailyStatusTitles: ["The Odyssey", "Dune: Part Three"],
      }),
      readState: async () => {
        events.push("read");
        return state;
      },
      writeState: async (_path, nextState) => {
        events.push("write");
        state = nextState;
      },
      fetchScreenings: async () => {
        events.push("fetch");
        throw new Error("daily status must not call AMC");
      },
      runCloudMonitor: async () => {
        events.push("monitor");
        throw new Error("daily status must not run the monitor");
      },
      sendTelegramMessages: async (_telegramConfig, message, options) => {
        events.push(`send:${String(options?.silent)}:${message}`);
      },
    });

    const result = await runCloudCli(
      env,
      dependencies,
    );
    const retryResult = await runCloudCli(
      env,
      dependencies,
    );

    expect(result).toBe("MONITOR_DAILY_STATUS");
    expect(retryResult).toBe("MONITOR_OK");
    expect(events).toEqual([
      "read",
      "send:true:20/08/26 - No new screenings detected for all movies in movie list - The Odyssey, Dune: Part Three",
      "write",
      "read",
    ]);
    expect(state.lastDailyStatusDate).toBe("2026-08-20");
  });

  it("does not send a daily status when a new-screening alert was sent today", async () => {
    const events: string[] = [];
    const state: MonitorState = {
      ...createEmptyState(),
      initialized: true,
      lastNewScreeningDate: "2026-08-20",
    };

    const result = await runCloudCli(
      {
        TELEGRAM_BOT_TOKEN: "telegram-secret",
        TELEGRAM_CHAT_ID: "chat-id",
        DAILY_STATUS_ONLY: "true",
        CLOUD_NOW: "2026-08-21T02:00:00.000Z",
      },
      createDependencies({
        readState: async () => state,
        fetchScreenings: async () => {
          events.push("fetch");
          return { ok: true, checkedAt: "", screenings: [] };
        },
        sendTelegramMessages: async () => {
          events.push("send");
        },
      }),
    );

    expect(result).toBe("MONITOR_OK");
    expect(events).toEqual([]);
  });

  it("does not claim there were no new screenings when monitor state is missing", async () => {
    const events: string[] = [];

    const result = await runCloudCli(
      {
        TELEGRAM_BOT_TOKEN: "telegram-secret",
        TELEGRAM_CHAT_ID: "chat-id",
        DAILY_STATUS_ONLY: "true",
        CLOUD_NOW: "2026-08-21T02:00:00.000Z",
      },
      createDependencies({
        readState: async () => createEmptyState(),
        sendTelegramMessages: async () => {
          events.push("send");
        },
      }),
    );

    expect(result).toBe("MONITOR_OK");
    expect(events).toEqual([]);
  });

  it("runs a scheduled check when GitHub starts it after the intended minute", async () => {
    const output: string[] = [];
    const events: string[] = [];

    const result = await runCloudCli(
      {
        ...configuredEnv,
        GITHUB_EVENT_NAME: "schedule",
        CLOUD_NOW: "2026-08-13T17:07:00.000Z",
      },
      createDependencies({
        write: (text) => output.push(text),
        runCloudMonitor: async ({ fetchScreenings }) => {
          events.push("run");
          await fetchScreenings();
          return "MONITOR_OK";
        },
        fetchScreenings: async () => {
          events.push("fetch");
          return { ok: true, checkedAt: "2026-08-13T17:07:00.000Z", screenings: [] };
        },
      }),
    );

    expect(result).toBe("MONITOR_OK");
    expect(output).toEqual(["MONITOR_OK\n"]);
    expect(events).toEqual(["run", "fetch"]);
  });

  it("runs a manual dispatch", async () => {
    const output: string[] = [];
    const events: string[] = [];

    const result = await runCloudCli(
      { ...configuredEnv, GITHUB_EVENT_NAME: "workflow_dispatch", CLOUD_NOW: "2026-08-13T17:10:00.000Z" },
      createDependencies({
        write: (text) => output.push(text),
        runCloudMonitor: async ({ fetchScreenings }) => {
          events.push("run");
          await fetchScreenings();
          return "MONITOR_OK";
        },
        fetchScreenings: async () => {
          events.push("fetch");
          return { ok: true, checkedAt: "2026-08-13T17:10:00.000Z", screenings: [] };
        },
      }),
    );

    expect(result).toBe("MONITOR_OK");
    expect(output).toEqual(["MONITOR_OK\n"]);
    expect(events).toEqual(["run", "fetch"]);
  });

  it("exits nonzero for missing Telegram configuration without initializing AMC", async () => {
    const output: string[] = [];
    let initializedAmc = false;

    const exitCode = await runCloudCliProcess(
      { AMC_API_KEY: "amc-secret", TELEGRAM_BOT_TOKEN: "", GITHUB_EVENT_NAME: "workflow_dispatch" },
      createDependencies({
        write: (text) => output.push(text),
        loadConfig: () => {
          initializedAmc = true;
          throw new Error("amc-secret");
        },
      }),
    );

    expect(exitCode).toBe(1);
    expect(output).toEqual(["MONITOR_WARNING\nCloud monitor failed: Telegram configuration is required\n"]);
    expect(initializedAmc).toBe(false);
    expect(output.join("")).not.toContain("amc-secret");
  });

  it("exits nonzero for sanitized monitor configuration failures", async () => {
    const output: string[] = [];

    const exitCode = await runCloudCliProcess(
      configuredEnv,
      createDependencies({
        write: (text) => output.push(text),
        loadConfig: () => {
          throw new Error("Invalid monitor configuration\nsecret details");
        },
      }),
    );

    expect(exitCode).toBe(1);
    expect(output).toEqual(["MONITOR_WARNING\nCloud monitor failed: Invalid monitor configuration\n"]);
  });

  it("exits nonzero for sanitized Telegram delivery failures", async () => {
    const output: string[] = [];

    const exitCode = await runCloudCliProcess(
      {
        TELEGRAM_BOT_TOKEN: "telegram-secret",
        TELEGRAM_CHAT_ID: "chat-id",
        TELEGRAM_TEST_ONLY: "true",
      },
      createDependencies({
        write: (text) => output.push(text),
        sendTelegramMessages: async () => {
          throw new Error("Telegram delivery rejected\nprivate response");
        },
      }),
    );

    expect(exitCode).toBe(1);
    expect(output).toEqual(["MONITOR_WARNING\nCloud monitor failed: Telegram delivery rejected\n"]);
  });

  it("exits nonzero for sanitized runtime failures", async () => {
    const output: string[] = [];

    const exitCode = await runCloudCliProcess(
      configuredEnv,
      createDependencies({
        write: (text) => output.push(text),
        runCloudMonitor: async () => {
          throw new Error("State save failed\nfilesystem details");
        },
      }),
    );

    expect(exitCode).toBe(1);
    expect(output).toEqual(["MONITOR_WARNING\nCloud monitor failed: State save failed\n"]);
  });

  it("sends only the Telegram smoke-test message without touching the monitor", async () => {
    const output: string[] = [];
    const events: string[] = [];
    let telegramMessage = "";

    const result = await runCloudCli(
      {
        TELEGRAM_BOT_TOKEN: "telegram-secret",
        TELEGRAM_CHAT_ID: "chat-id",
        TELEGRAM_TEST_ONLY: "true",
      },
      createDependencies({
        write: (text) => output.push(text),
        loadConfig: () => {
          events.push("config");
          return config;
        },
        fetchScreenings: async () => {
          events.push("fetch");
          return { ok: true, checkedAt: "2026-08-13T17:10:00.000Z", screenings: [] };
        },
        readState: async () => {
          events.push("read");
          return createEmptyState();
        },
        writeState: async () => {
          events.push("write");
        },
        sendTelegramMessages: async (telegramConfig, message) => {
          events.push(`${telegramConfig.botToken}:${telegramConfig.chatId}`);
          telegramMessage = message;
        },
      }),
    );

    expect(result).toBe("TELEGRAM_TEST_OK");
    expect(output).toEqual(["TELEGRAM_TEST_OK\n"]);
    expect(events).toEqual(["telegram-secret:chat-id"]);
    expect(telegramMessage).toBe(`AMC monitor test ${String.fromCodePoint(0x2014)} Telegram delivery is working.`);
  });

  it("prints exactly the cloud monitor marker on a normal successful run", async () => {
    const output: string[] = [];
    const notificationModes: Array<boolean | undefined> = [];

    const result = await runCloudCli(
      { ...configuredEnv, GITHUB_EVENT_NAME: "workflow_dispatch" },
      createDependencies({
        write: (text) => output.push(text),
        runCloudMonitor: async ({ sendNotification }) => {
          await sendNotification("New screening", { loud: true });
          return "MONITOR_NOTIFY";
        },
        sendTelegramMessages: async (_telegramConfig, _message, options) => {
          notificationModes.push(options?.silent);
        },
      }),
    );

    expect(result).toBe("MONITOR_NOTIFY");
    expect(output).toEqual(["MONITOR_NOTIFY\n"]);
    expect(notificationModes).toEqual([false]);
  });

  it("exits successfully after persisting a delivered third-failure warning and does not repeat it", async () => {
    const output: string[] = [];
    const messages: string[] = [];
    let state: MonitorState = { ...createEmptyState(), consecutiveFailures: 2 };
    const dependencies = createDependencies({
      write: (text) => output.push(text),
      readState: async () => state,
      writeState: async (_path, nextState) => {
        state = nextState;
      },
      fetchScreenings: async () => ({
        ok: false,
        checkedAt: "2026-08-13T17:07:00.000Z",
        error: "AMC unavailable",
      }),
      runCloudMonitor: runCloudMonitorTransaction,
      sendTelegramMessages: async (_telegramConfig, message, options) => {
        messages.push(`${String(options?.silent)}:${message}`);
      },
    });

    const thirdFailureExitCode = await runCloudCliProcess(configuredEnv, dependencies);
    expect(thirdFailureExitCode).toBe(0);
    expect(state).toMatchObject({ consecutiveFailures: 3, warnedForFailureEpisode: true });
    expect(messages).toEqual(["true:AMC checks failed three times. Last error: AMC unavailable"]);

    const fourthFailureExitCode = await runCloudCliProcess(configuredEnv, dependencies);
    expect(fourthFailureExitCode).toBe(0);
    expect(state).toMatchObject({ consecutiveFailures: 4, warnedForFailureEpisode: true });
    expect(messages).toHaveLength(1);
    expect(output).toEqual(["MONITOR_WARNING\n", "MONITOR_OK\n"]);
  });
});
