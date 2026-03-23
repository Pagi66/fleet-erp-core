import { resolve } from "path";

interface AppConfig {
  port: number;
  persistenceFilePath: string;
  eventDebounceWindowMs: number;
  logLevel: string;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function readString(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed === "" ? fallback : trimmed;
}

export const config: AppConfig = {
  port: readNumber(process.env.PORT, 3000),
  persistenceFilePath: resolve(
    process.cwd(),
    readString(process.env.PERSISTENCE_FILE_PATH, "data/store-state.json"),
  ),
  eventDebounceWindowMs: readNumber(process.env.EVENT_DEBOUNCE_WINDOW_MS, 50),
  logLevel: readString(process.env.LOG_LEVEL, "info"),
};
