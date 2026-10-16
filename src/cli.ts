import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { fetchScreenings } from "./amc/client.js";
import { sanitizeError } from "./notify.js";
import { runMonitor, type RunOutput } from "./run.js";
import { readState, writeState } from "./state/store.js";

export interface CliDependencies {
  run: () => Promise<RunOutput>;
  write: (text: string) => void;
}

export function emitRunOutput(output: RunOutput, write: (text: string) => void): void {
  write(output.message ? `${output.marker}\n${output.message}\n` : `${output.marker}\n`);
}

export async function runCli(deps: CliDependencies = createDefaultDependencies()): Promise<void> {
  try {
    emitRunOutput(await deps.run(), deps.write);
  } catch (error) {
    emitRunOutput(
      { marker: "MONITOR_WARNING", message: `Monitor failed: ${sanitizeError(error)}` },
      deps.write,
    );
    process.exitCode = 1;
  }
}

function createDefaultDependencies(): CliDependencies {
  const config = loadConfig(process.env);
  return {
    run: () => runMonitor({
      readState: () => readState(config.statePath),
      writeState: (state) => writeState(config.statePath, state),
      fetchScreenings: () => fetchScreenings(config),
    }),
    write: (text) => process.stdout.write(text),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runCli();
}
