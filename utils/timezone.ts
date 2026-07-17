/**
 * Timezone utilities for WalkChamp.
 *
 * Centralises all device-timezone detection, local date-range computation,
 * and timestamp formatting so every screen uses the same logic.
 *
 * Key principle: UTC timestamps are stored on the server; the client converts
 * them to the user's local timezone for display and for computing "today",
 * "this week", "this month" date-boundary params sent to the backend.
 */

// ── Device timezone ───────────────────────────────────────────────────────────

/**
 * Returns the user's device IANA timezone string (e.g. "America/Chicago").
 * Falls back to "UTC" if detection fails (e.g. old device / unusual RN build).
 */
export function getDeviceTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || "UTC";
  } catch {
    return "UTC";
  }
}

// ── Local date-range helpers (for API params) ─────────────────────────────────

/** Returns a zero-padded YYYY-MM-DD string for the user's local today. */
export function getLocalDateStr(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}

/** Milliseconds until the next local midnight plus optional offset (default 1s). */
export function msUntilNextLocalMidnight(offsetMs = 1_000): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(500, next.getTime() - now.getTime() + offsetMs);
}

/** Local today at 00:00:00.000 — used to detect step snapshots from a prior calendar day. */
export function startOfLocalTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** True when a non-zero step count was last updated before today's local midnight. */
export function isStepSnapshotFromBeforeToday(
  updatedAtMs: number | null | undefined,
  steps: number,
): boolean {
  if (steps <= 0 || !updatedAtMs || updatedAtMs <= 0) return false;
  return updatedAtMs < startOfLocalTodayMs();
}

/**
 * Returns YYYY-MM-DD for the start of the local calendar week (Monday).
 * Monday is used because that is what the server currently computes for "week".
 */
export function getLocalWeekStart(): string {
  const d = new Date();
  const day = d.getDay(); // 0 = Sun … 6 = Sat
  const daysBack = day === 0 ? 6 : day - 1; // days to go back to reach Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() - daysBack);
  return (
    `${monday.getFullYear()}-` +
    `${String(monday.getMonth() + 1).padStart(2, "0")}-` +
    `${String(monday.getDate()).padStart(2, "0")}`
  );
}

/** Returns YYYY-MM-DD for the first day of the local calendar month. */
export function getLocalMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// ── Timestamp formatting ──────────────────────────────────────────────────────

/**
 * Formats a UTC ISO timestamp as a local time string, e.g. "2:45 PM".
 * Uses the device's locale and timezone automatically via toLocaleTimeString.
 */
export function formatLocalTime(utcIso: string): string {
  try {
    return new Date(utcIso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/**
 * Formats a UTC ISO timestamp as a relative label in the user's local timezone:
 *   "Today · 2:45 PM"
 *   "Yesterday · 11:30 PM"
 *   "May 28 · 2:45 PM"
 */
export function formatRelativeTime(utcIso: string): string {
  try {
    const d = new Date(utcIso);
    const now = new Date();

    const toKey = (dt: Date) =>
      `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    const timeStr = d.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });

    if (toKey(d) === toKey(now)) return `Today · ${timeStr}`;
    if (toKey(d) === toKey(yesterday)) return `Yesterday · ${timeStr}`;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${timeStr}`;
  } catch {
    return "";
  }
}

/**
 * Formats a UTC ISO timestamp as a short local date, e.g. "May 28" or "May 28, 2025".
 * Omits the year when it matches the current year.
 */
export function formatLocalDate(utcIso: string): string {
  try {
    const d = new Date(utcIso);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    });
  } catch {
    return "";
  }
}

/**
 * Compact Sponsored Event start→end times for list/detail cards.
 * Converts absolute backend instants to the device local timezone (display only).
 * Dates are omitted — callers already show the event date separately.
 *
 * Same local day:  "Start time 6:30 PM · End time 9:30 PM"
 * Cross midnight:  "Start time 11:30 PM · End time Jul 19 · 1:30 AM"
 */
export function formatSponsoredEventWindow(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string {
  if (!startIso) return "";
  try {
    const start = new Date(startIso);
    if (Number.isNaN(start.getTime())) return "";
    const startTime = formatLocalTime(startIso);
    if (!endIso) return `Start time ${startTime}`;

    const end = new Date(endIso);
    if (Number.isNaN(end.getTime())) return `Start time ${startTime}`;

    const sameLocalDay =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();

    const endTime = formatLocalTime(endIso);
    if (sameLocalDay) return `Start time ${startTime} · End time ${endTime}`;
    return `Start time ${startTime} · End time ${formatLocalDate(endIso)} · ${endTime}`;
  } catch {
    return "";
  }
}

/** Inclusive start / exclusive end against canonical backend instants. */
export function isWithinEventWindow(
  timestampMs: number,
  startIso: string,
  endIso: string,
): boolean {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return timestampMs >= start && timestampMs < end;
}
