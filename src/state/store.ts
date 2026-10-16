import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { MonitorState } from "../domain.js";
import { createEmptyState } from "../detect.js";

const screeningSchema = z.object({
  id: z.string(),
  title: z.string().default("The Odyssey"),
  startsAt: z.string(),
  localDate: z.string(),
  localTime: z.string(),
  format: z.literal("IMAX 70mm"),
  bookingUrl: z.string(),
  availability: z.union([z.literal("bookable"), z.literal("unavailable")]),
});

const stateSchema = z.object({
  version: z.literal(1),
  initialized: z.boolean(),
  screenings: z.record(z.string(), screeningSchema),
  lastSuccessfulCheck: z.string().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  warnedForFailureEpisode: z.boolean(),
  lastNewScreeningDate: z.string().nullable().default(null),
  lastDailyStatusDate: z.string().nullable().default(null),
});

export async function readState(path: string): Promise<MonitorState> {
  try {
    const json = await readFile(path, "utf8");
    return stateSchema.parse(JSON.parse(json));
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return createEmptyState();
    }
    throw error;
  }
}

export async function writeState(path: string, state: MonitorState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(state, null, 2), "utf8");
  await rename(`${path}.tmp`, path);
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
