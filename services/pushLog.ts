/** Single tag for push / OneSignal testing — filter terminal with: adb logcat | findstr Push */
import { logger } from "@/utils/logger";

export function pushLog(message: string, extra?: unknown): void {
  // Never pass full push payloads / PII as extra.
  logger.debug("Push", message, typeof extra === "string" || typeof extra === "number" ? extra : undefined);
}

/** Notification routing / tap testing — filter with: adb logcat | findstr Notification */
export function notificationLog(message: string, extra?: unknown): void {
  logger.debug(
    "Notification",
    message,
    typeof extra === "string" || typeof extra === "number" ? extra : undefined,
  );
}
