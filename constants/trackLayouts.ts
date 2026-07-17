/**
 * Bundled track theme fallbacks for rollout.
 * Only `bg` and `daylightStadium` ship in the binary — all other themes load from R2.
 */

export const LOCAL_TRACK_FALLBACKS = {
  bg: require("@/assets/images/bg.jpeg"),
  daylightStadium: require("@/assets/images/daylightStadium.jpeg"),
} as const;

export type LocalTrackFallbackId = keyof typeof LOCAL_TRACK_FALLBACKS;

/** Display labels for free / fallback themes (API name preferred when available). */
export const TRACK_THEME_LABELS: Record<string, string> = {
  bg: "Neon Finish",
  daylightStadium: "Daylight Stadium",
};

/**
 * Minimal local options used when Redux themes have not hydrated yet.
 * Premium themes come from GET /api/track-themes (remote imageSet).
 */
export const TRACK_LAYOUT_OPTIONS = [
  {
    id: "bg" as const,
    label: TRACK_THEME_LABELS.bg,
    source: LOCAL_TRACK_FALLBACKS.bg,
  },
  {
    id: "daylightStadium" as const,
    label: TRACK_THEME_LABELS.daylightStadium,
    source: LOCAL_TRACK_FALLBACKS.daylightStadium,
  },
] as const;

/** @deprecated Prefer string theme codes from the API. Kept for gradual typing migration. */
export type TrackLayoutId = string;

/** Local-only background map (fallback assets). */
export const TRACK_BACKGROUNDS: Record<string, number> = {
  bg: LOCAL_TRACK_FALLBACKS.bg,
  daylightStadium: LOCAL_TRACK_FALLBACKS.daylightStadium,
};

export const FREE_TRACK_CODES = new Set<string>(["bg", "daylightStadium"]);

/** True when `code` is a usable theme id (API owns the catalog). */
export function isTrackLayoutId(code: string | null | undefined): code is string {
  return typeof code === "string" && code.trim().length > 0;
}

/** Resolve a bundled fallback asset; unknown codes → bg. */
export function getTrackBackground(id: string | null | undefined): number {
  const key = (id ?? "bg").trim();
  return TRACK_BACKGROUNDS[key] ?? TRACK_BACKGROUNDS.bg;
}

export function getTrackThemeLabel(code: string, apiName?: string | null): string {
  if (apiName?.trim()) return apiName.trim();
  return TRACK_THEME_LABELS[code] ?? code;
}
