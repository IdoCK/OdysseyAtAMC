import { loadEnvFile } from "node:process";
import type { FetchResult, MonitorConfig } from "../domain.js";
import {
  queryAmcApi,
  VERIFIED_AMC_LINCOLN_SQUARE_ID,
  type AmcApiSnapshot,
  type AmcApiDeps,
  type AmcRequest,
} from "./api.js";

export interface ClientDeps extends AmcApiDeps {}

function loadLocalApiKey(): string {
  if (!process.env.AMC_API_KEY?.trim()) {
    try {
      loadEnvFile(".env.local");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw new Error("Unable to load AMC API credentials");
      }
    }
  }
  return process.env.AMC_API_KEY?.trim() ?? "";
}

export function createDefaultClientDeps(): ClientDeps {
  return {
    request: globalThis.fetch as AmcRequest,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
    apiKey: loadLocalApiKey(),
    theatreId: VERIFIED_AMC_LINCOLN_SQUARE_ID,
  };
}

function errorMessage(error: unknown, apiKey: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return apiKey ? message.replaceAll(apiKey, "[REDACTED]") : message;
}

export async function fetchScreenings(config: MonitorConfig, provided?: ClientDeps): Promise<FetchResult> {
  const checkedAt = (provided?.now() ?? new Date()).toISOString();
  let apiKey = provided?.apiKey ?? "";

  try {
    const deps = provided ?? createDefaultClientDeps();
    apiKey = deps.apiKey;
    const snapshot = await queryAmcApi(config, deps);
    return { ok: true, checkedAt, screenings: snapshot.screenings };
  } catch (error) {
    return { ok: false, checkedAt, error: errorMessage(error, apiKey) };
  }
}

export async function inspectOfficialAmcApi(config: MonitorConfig): Promise<AmcApiSnapshot> {
  const deps = createDefaultClientDeps();
  try {
    return await queryAmcApi(config, deps);
  } catch (error) {
    throw new Error(errorMessage(error, deps.apiKey));
  }
}
