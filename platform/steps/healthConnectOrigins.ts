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
  // Samsung Health records sometimes use a short "shealth" / "samsung" origin.
  if (needle.includes("shealth") || needle.includes("samsung")) {
    return origins.some((origin) => {
      const o = origin.toLowerCase();
      return o.includes("shealth") || o.includes("samsung");
    });
  }
  return false;
}

/** Step count on a Health Connect Steps record (SDK `count`). */
export function stepCountFromHcRecord(record: unknown): number {
  if (!record || typeof record !== "object") return 0;
  const rec = record as Record<string, unknown>;
  const n = rec.count ?? rec.COUNT_TOTAL;
  if (typeof n === "number" && Number.isFinite(n)) {
    return Math.max(0, Math.floor(n));
  }
  return 0;
}
