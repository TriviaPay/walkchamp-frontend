import { getTodayKey } from "@/utils/format";

/** GET /api/profile/me with local calendar day so todaySteps matches walk sync. */
export function profileMePath(): string {
  return `/api/profile/me?localDate=${encodeURIComponent(getTodayKey())}`;
}

/** Local YYYY-MM-DD for `offset` days from today (0 = today, -1 = yesterday). */
export function localDateKeyOffset(offsetFromToday: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetFromToday);
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}
