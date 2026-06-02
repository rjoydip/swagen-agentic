/**
 * utils/logger.ts — structured logging with levels and contexts.
 * Outputs to stderr in human-readable format (or JSON when LOG_FORMAT=json).
 */

import { ansi } from "./fmt.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_COLOR: Record<LogLevel, (s: string) => string> = {
  debug: ansi.gray,
  info: ansi.cyan,
  warn: ansi.yellow,
  error: ansi.red,
};

const LEVEL_PAD: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
};

// Read per-call to allow mid-process switching (e.g., during tests)
const isJson = () => process.env["LOG_FORMAT"] === "json";

function log(level: LogLevel, context: string, message: string, data?: unknown): void {
  const ts = new Date().toISOString();
  if (isJson()) {
    const entry = { ts, level, context, message, ...(data ? { data } : {}) };
    process.stderr.write(JSON.stringify(entry) + "\n");
  } else {
    const color = LEVEL_COLOR[level];
    const tag = `${color(LEVEL_PAD[level])} ${ansi.bold(`[${context}]`)}`;
    const extra = data ? ansi.gray(" " + JSON.stringify(data)) : "";
    process.stderr.write(`${tag} ${message}${extra}\n`);
  }
}

export const logger = {
  debug: (ctx: string, msg: string, data?: unknown) => log("debug", ctx, msg, data),
  info: (ctx: string, msg: string, data?: unknown) => log("info", ctx, msg, data),
  warn: (ctx: string, msg: string, data?: unknown) => log("warn", ctx, msg, data),
  error: (ctx: string, msg: string, data?: unknown) => log("error", ctx, msg, data),
};
