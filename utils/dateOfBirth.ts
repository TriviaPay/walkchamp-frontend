/**
 * Date-of-birth helpers for Create Account / Complete Profile.
 * Accepts single-digit or zero-padded day/month; emits ISO YYYY-MM-DD.
 * Avoids locale-dependent Date string parsing.
 */

export type DobParseResult =
  | { ok: true; iso: string; day: number; month: number; year: number }
  | { ok: false; reason: "incomplete" | "invalid_format" | "invalid_range" | "invalid_calendar" };

/** Digits only; preserves empty while editing. */
export function normalizeDayInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 2);
}

export function normalizeMonthInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 2);
}

export function normalizeYearInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

function daysInMonth(year: number, month: number): number {
  // Date(year, month, 0) → last day of previous month; month is 1-based here.
  return new Date(year, month, 0).getDate();
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Parse day/month/year strings (e.g. "5","05","8","08","1993").
 * Empty fields → incomplete. Definitely impossible values → invalid_*.
 */
export function parseDateOfBirth(
  dayRaw: string,
  monthRaw: string,
  yearRaw: string,
): DobParseResult {
  const dayStr = normalizeDayInput(dayRaw.trim());
  const monthStr = normalizeMonthInput(monthRaw.trim());
  const yearStr = normalizeYearInput(yearRaw.trim());

  if (!dayStr || !monthStr || yearStr.length !== 4) {
    return { ok: false, reason: "incomplete" };
  }

  if (!/^\d{1,2}$/.test(dayStr) || !/^\d{1,2}$/.test(monthStr) || !/^\d{4}$/.test(yearStr)) {
    return { ok: false, reason: "invalid_format" };
  }

  const day = Number(dayStr);
  const month = Number(monthStr);
  const year = Number(yearStr);

  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return { ok: false, reason: "invalid_format" };
  }

  // Reject 0 / 00 and out-of-range before calendar checks.
  if (month < 1 || month > 12) {
    return { ok: false, reason: "invalid_range" };
  }
  if (day < 1 || day > 31) {
    return { ok: false, reason: "invalid_range" };
  }

  const maxDay = daysInMonth(year, month);
  if (day > maxDay) {
    return { ok: false, reason: "invalid_calendar" };
  }
  if (month === 2 && day === 29 && !isLeapYear(year)) {
    return { ok: false, reason: "invalid_calendar" };
  }

  return {
    ok: true,
    iso: formatDateOfBirthPayload(day, month, year),
    day,
    month,
    year,
  };
}

export function formatDateOfBirthPayload(day: number, month: number, year: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type DobValidateOptions = {
  minAge?: number;
  maxAge?: number;
  /** Reject dates strictly after local today. Default true. */
  rejectFuture?: boolean;
};

export type DobValidateResult =
  | { valid: true; iso: string; age: number }
  | { valid: false; error: string };

function calcAgeFromParts(day: number, month: number, year: number, today = new Date()): number {
  let age = today.getFullYear() - year;
  const m = today.getMonth() + 1 - month;
  if (m < 0 || (m === 0 && today.getDate() < day)) age--;
  return age;
}

/**
 * Full validation for blur / submit. Does not treat mid-edit incomplete as a hard error message
 * unless callers choose to — returns incomplete as invalid with a required message.
 */
export function validateDateOfBirth(
  dayRaw: string,
  monthRaw: string,
  yearRaw: string,
  options: DobValidateOptions = {},
): DobValidateResult {
  const { minAge = 13, maxAge, rejectFuture = true } = options;
  const parsed = parseDateOfBirth(dayRaw, monthRaw, yearRaw);
  if (!parsed.ok) {
    if (parsed.reason === "incomplete") {
      return { valid: false, error: "Date of birth is required." };
    }
    return { valid: false, error: "Please enter a valid date of birth." };
  }

  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth() + 1;
  const todayD = today.getDate();

  if (rejectFuture) {
    const future =
      parsed.year > todayY ||
      (parsed.year === todayY && parsed.month > todayM) ||
      (parsed.year === todayY && parsed.month === todayM && parsed.day > todayD);
    if (future) {
      return { valid: false, error: "Date of birth cannot be in the future." };
    }
  }

  const age = calcAgeFromParts(parsed.day, parsed.month, parsed.year, today);
  if (age < minAge) {
    return {
      valid: false,
      error: `You must be at least ${minAge} years old to register.`,
    };
  }
  if (typeof maxAge === "number" && age > maxAge) {
    return { valid: false, error: "Please enter a valid date of birth." };
  }

  return { valid: true, iso: parsed.iso, age };
}

/** True when month/day are complete enough to show the checkmark (1–2 digits, in range). */
export function isDobFieldsFilled(year: string, month: string, day: string): boolean {
  return parseDateOfBirth(day, month, year).ok;
}
