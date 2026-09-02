import { storageGet, storageSet } from "@/utils/storage";

function storageKey(userId: string): string {
  return `walkchamp_unlimited_tz_last_observed_v1:${userId}`;
}

/** Last device IANA timezone we observed for this user (travel detection baseline). */
export async function loadLastObservedDeviceTimezone(
  userId: string,
): Promise<string | null> {
  const value = await storageGet<string>(storageKey(userId));
  const tz = typeof value === "string" ? value.trim() : "";
  return tz || null;
}

export async function saveLastObservedDeviceTimezone(
  userId: string,
  timezone: string,
): Promise<void> {
  const tz = timezone.trim();
  if (!tz) return;
  await storageSet(storageKey(userId), tz);
}
