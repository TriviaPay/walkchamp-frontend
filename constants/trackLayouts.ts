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

/**
 * Resolve track theme code from room list / race payloads.
 * APIs mix `theme_code`, `trackLayout`, and `selected_track_theme_id`.
 */
export function resolveRoomTrackCode(room: {
  selected_track_theme_id?: string | null;
  theme_code?: string | null;
  trackLayout?: string | null;
  track_layout?: string | null;
  theme_name?: string | null;
} | null | undefined): string {
  if (!room) return "bg";
  const direct = [
    room.selected_track_theme_id,
    room.theme_code,
    room.trackLayout,
    room.track_layout,
  ];
  for (const candidate of direct) {
    const trimmed = typeof candidate === "string" ? candidate.trim() : "";
    if (trimmed) return trimmed;
  }
  const name = room.theme_name?.trim();
  if (!name) return "bg";
  const byLabel = TRACK_LAYOUT_OPTIONS.find(
    (t) => t.label.toLowerCase() === name.toLowerCase(),
  );
  if (byLabel) return byLabel.id;
  // Backend may emit the raw code when TRACK_NAMES omits daylightStadium.
  if (!/\s/.test(name)) return name;
  return "bg";
}
