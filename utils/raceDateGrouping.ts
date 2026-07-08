/**
 * Date-grouping helpers for the Live Challenges screen.
 *
 * Races are grouped by their LOCAL calendar date (device timezone) so a race
 * that starts late at night still lands under the correct day. Date keys use
 * the `YYYY-MM-DD` format built from local getFullYear/getMonth/getDate — never
 * from `toISOString()` (which is UTC and would shift the day near midnight).
 */

export interface DateGroup<T> {
  dateKey: string;   // YYYY-MM-DD (local)
  dateLabel: string; // "Today" | "Tomorrow" | "Fri, Jul 31"
  races: T[];
}

/** Local YYYY-MM-DD for an ISO date string (falls back to now on invalid input). */
export function getRaceDateKey(dateIso: string | null | undefined): string {
  const parsed = dateIso ? new Date(dateIso) : new Date();
  const d = isNaN(parsed.getTime()) ? new Date() : parsed;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Human label for a YYYY-MM-DD key using the device's local calendar. */
export function formatRaceDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "1 room" / "2 rooms" */
export function getRoomCountLabel(count: number): string {
  return `${count} room${count === 1 ? "" : "s"}`;
}

/**
 * Group a list of races by their local start/finish date.
 *
 * @param races       source list (already filtered by chip)
 * @param getDateIso  extractor returning the ISO date to group/sort by
 * @param opts.order        order of date sections ("asc" = Today first)
 * @param opts.withinOrder  order of cards inside a date ("asc" = earliest first)
 */
export function groupRacesByDate<T>(
  races: T[],
  getDateIso: (r: T) => string | null | undefined,
  opts?: { order?: "asc" | "desc"; withinOrder?: "asc" | "desc" },
): DateGroup<T>[] {
  const order = opts?.order ?? "asc";
  const withinOrder = opts?.withinOrder ?? "asc";

  const buckets = new Map<string, T[]>();
  for (const race of races) {
    const key = getRaceDateKey(getDateIso(race));
    const arr = buckets.get(key);
    if (arr) arr.push(race);
    else buckets.set(key, [race]);
  }

  const groups: DateGroup<T>[] = [];
  buckets.forEach((arr, dateKey) => {
    arr.sort((a, b) => {
      const ta = new Date(getDateIso(a) ?? 0).getTime();
      const tb = new Date(getDateIso(b) ?? 0).getTime();
      return withinOrder === "asc" ? ta - tb : tb - ta;
    });
    groups.push({ dateKey, dateLabel: formatRaceDateLabel(dateKey), races: arr });
  });

  groups.sort((a, b) =>
    order === "asc" ? a.dateKey.localeCompare(b.dateKey) : b.dateKey.localeCompare(a.dateKey),
  );
  return groups;
}
