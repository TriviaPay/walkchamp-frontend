/**
 * Lightweight production-safe logger.
 * - debug/info are no-ops outside __DEV__
 * - never pass tokens, health payloads, or payment secrets
 */

type LogLevel = "debug" | "info" | "warn" | "error";

function emit(level: LogLevel, tag: string, message: string, detail?: unknown): void {
  const prefix = `[${tag}] ${message}`;
  if (level === "error") {
    if (detail !== undefined) console.error(prefix, detail);
    else console.error(prefix);
    return;
  }
  if (level === "warn") {
    if (detail !== undefined) console.warn(prefix, detail);
    else console.warn(prefix);
    return;
  }
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    if (detail !== undefined) console.log(prefix, detail);
    else console.log(prefix);
  }
}

export const logger = {
  debug: (tag: string, message: string, detail?: unknown) => emit("debug", tag, message, detail),
  info: (tag: string, message: string, detail?: unknown) => emit("info", tag, message, detail),
  warn: (tag: string, message: string, detail?: unknown) => emit("warn", tag, message, detail),
  error: (tag: string, message: string, detail?: unknown) => emit("error", tag, message, detail),
};
