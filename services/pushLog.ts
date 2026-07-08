/** Single tag for push / OneSignal testing — filter terminal with: adb logcat | findstr Push */
export function pushLog(message: string, extra?: unknown): void {
  if (!__DEV__) return;
  if (extra !== undefined) {
    console.log(`[Push] ${message}`, extra);
  } else {
    console.log(`[Push] ${message}`);
  }
}

/** Notification routing / tap testing — filter with: adb logcat | findstr Notification */
export function notificationLog(message: string, extra?: unknown): void {
  if (!__DEV__) return;
  if (extra !== undefined) {
    console.log(`[Notification] ${message}`, extra);
  } else {
    console.log(`[Notification] ${message}`);
  }
}
