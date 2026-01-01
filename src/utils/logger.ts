import { appendFileSync } from "fs";
import path from "path";

const LOG_PATH = process.env.BOT_LOG_PATH || "bot.log";
const resolvedPath = path.resolve(LOG_PATH);

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ error: "meta_stringify_failed" });
  }
};

const writeLine = (level: string, message: string, meta?: unknown): void => {
  const timestamp = new Date().toISOString();
  const suffix = meta ? ` ${safeStringify(meta)}` : "";
  const line = `${timestamp} ${level} ${message}${suffix}\n`;
  appendFileSync(resolvedPath, line);
};

export const logger = {
  info: (message: string, meta?: unknown) => writeLine("INFO", message, meta),
  warn: (message: string, meta?: unknown) => writeLine("WARN", message, meta),
  error: (message: string, meta?: unknown) => writeLine("ERROR", message, meta),
};
