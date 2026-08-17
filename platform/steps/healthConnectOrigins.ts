/**
 * Normalize Health Connect data-origin payloads (strings or SDK objects)
 * into package-id strings we can match against writer apps.
 */

export function normalizeHealthConnectOrigins(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: string[] = [];

  const push = (value: unknown) => {
    if (typeof value === "string") {
      const s = value.trim();
      if (s) out.push(s);
      return;
    }
    if (!value || typeof value !== "object") return;
    const rec = value as Record<string, unknown>;
    if (typeof rec.packageName === "string") push(rec.packageName);
    if (typeof rec.applicationId === "string") push(rec.applicationId);
    if (typeof rec.dataOrigin === "string") push(rec.dataOrigin);
    if (typeof rec.origin === "string") push(rec.origin);
    if (rec.dataOrigin && typeof rec.dataOrigin === "object") push(rec.dataOrigin);
    if (rec.metadata && typeof rec.metadata === "object") push(rec.metadata);
  };

  for (const item of items) push(item);
  return [...new Set(out)];
}

export function originsIncludeWriterPackage(
  origins: string[],
  packageId: string,
): boolean {
  const needle = packageId.trim().toLowerCase();
  if (!needle) return false;
  if (origins.some((origin) => origin.toLowerCase().includes(needle))) {
    return true;
  }
  // Samsung Health records sometimes use a short "shealth" origin string.
  if (needle.includes("shealth")) {
    return origins.some((origin) => origin.toLowerCase().includes("shealth"));
  }
  return false;
}
