/**
 * Create Challenge premium color tokens — visual system only.
 * Room visibility (public/private) drives the accent theme across steps 1–5.
 * Does not change challenge logic or payloads.
 */

export type RoomVisibilityTheme = "public" | "private";

export type CreateChallengeAccentTheme = {
  key: RoomVisibilityTheme;
  primary: string;
  secondary: string;
  tertiary: string;
  border: string;
  softBackground: string;
  iconBackground: string;
  iconColor: string;
  valueText: string;
  checkBg: string;
  checkIcon: string;
  progressDone: string;
  progressCurrent: string;
  glow: string;
  /** Selected card / progress / CTA fills */
  gradient: readonly [string, string, string];
  /** Selected card border ring */
  gradientBorder: readonly [string, string, string];
  /** Selected room / challenge card surface */
  gradientSelected: readonly [string, string, string];
  /** Icon tile on selected cards */
  gradientIcon: readonly [string, string] | readonly [string, string, string];
  /** Active slider track */
  gradientTrack: readonly [string, string, string];
  /** Primary Continue / Review / Create button */
  gradientCta: readonly [string, string, string];
  valuePillBg: string;
  valuePillBorder: string;
  valuePillText: string;
  pillBorder: string;
  pillText: string;
  pillBg: string;
};

export const ROOM_ACCENT_THEMES: Record<RoomVisibilityTheme, CreateChallengeAccentTheme> = {
  public: {
    key: "public",
    primary: "#166DFF",
    secondary: "#08D7FF",
    tertiary: "#6239D8",
    border: "#13C8FF",
    softBackground: "rgba(10,75,155,0.45)",
    iconBackground: "rgba(7, 90, 140, 0.55)",
    iconColor: "#49E2FF",
    valueText: "#4CDFFF",
    checkBg: "rgba(8, 215, 255, 0.95)",
    checkIcon: "#05111B",
    progressDone: "#166DFF",
    progressCurrent: "#08D7FF",
    glow: "rgba(8, 215, 255, 0.18)",
    gradient: ["#087FD8", "#164FC5", "#6636D6"],
    gradientBorder: ["#13C8FF", "#166DFF", "#6239D8"],
    /** Full-bleed selected room card surface (no nested panel). */
    gradientSelected: ["#086A9A", "#0E4F91", "#3239A7"],
    gradientIcon: ["#075B95", "#164FC5"],
    gradientTrack: ["#08D7FF", "#166DFF", "#6239D8"],
    gradientCta: ["#0A8DDA", "#2455E8", "#673AD7"],
    valuePillBg: "rgba(8, 125, 216, 0.22)",
    valuePillBorder: "#13C8FF",
    valuePillText: "#4CDFFF",
    pillBorder: "#13C8FF",
    pillText: "#6AE8FF",
    pillBg: "rgba(8, 215, 255, 0.12)",
  },
  private: {
    key: "private",
    primary: "#8642FF",
    secondary: "#A93BFF",
    tertiary: "#EA18D8",
    border: "#C53FFF",
    softBackground: "rgba(91,28,150,0.45)",
    iconBackground: "rgba(85, 25, 145, 0.55)",
    iconColor: "#F0A0FF",
    valueText: "#E58BFF",
    checkBg: "rgba(220, 83, 255, 0.95)",
    checkIcon: "#FFF",
    progressDone: "#A93BFF",
    progressCurrent: "#EA18D8",
    glow: "rgba(198, 55, 255, 0.18)",
    gradient: ["#3B48D8", "#8E28D6", "#E01ACC"],
    gradientBorder: ["#C53FFF", "#A93BFF", "#EA18D8"],
    /** Full-bleed selected room card surface (no nested panel). */
    gradientSelected: ["#3D247B", "#7028A7", "#B21AC5"],
    gradientIcon: ["#4B27B7", "#8E28D6", "#E01ACC"],
    gradientTrack: ["#8642FF", "#A93BFF", "#EA18D8"],
    gradientCta: ["#4A48E0", "#9C2DDB", "#E01ACC"],
    valuePillBg: "rgba(161, 44, 220, 0.18)",
    valuePillBorder: "#C53FFF",
    valuePillText: "#E58BFF",
    pillBorder: "#C53FFF",
    pillText: "#E68BFF",
    pillBg: "rgba(195, 62, 255, 0.12)",
  },
} as const;

/** Shared room-card radius — shell, gradient, and border must match. */
export const ROOM_CARD_RADIUS = 22;

/** Selector — single source of truth for Create Challenge accents. */
export function selectCreateChallengeAccentTheme(
  visibility: RoomVisibilityTheme,
): CreateChallengeAccentTheme {
  return ROOM_ACCENT_THEMES[visibility] ?? ROOM_ACCENT_THEMES.public;
}

/**
 * Keep neon gradients for CTAs/selected cards; tune soft fills + text for light surfaces
 * so badges/pills stay readable without changing dark theme.
 */
export function adaptCreateChallengeAccentForTheme(
  theme: CreateChallengeAccentTheme,
  isDark: boolean,
): CreateChallengeAccentTheme {
  if (isDark) return theme;
  const isPublic = theme.key === "public";
  const ink = isPublic ? "#0B5FFF" : "#6B21A8";
  const soft = isPublic ? "rgba(22, 109, 255, 0.12)" : "rgba(134, 66, 255, 0.12)";
  const iconBg = isPublic ? "rgba(22, 109, 255, 0.16)" : "rgba(134, 66, 255, 0.16)";
  return {
    ...theme,
    softBackground: soft,
    iconBackground: iconBg,
    iconColor: ink,
    valueText: ink,
    pillText: ink,
    valuePillBg: soft,
    valuePillBorder: theme.border,
    valuePillText: ink,
    pillBg: soft,
  };
}

export function useCreateChallengeRoomTheme(
  visibility: RoomVisibilityTheme,
): CreateChallengeAccentTheme {
  return selectCreateChallengeAccentTheme(visibility);
}

/** Shared neutrals — dark defaults (kept for StyleSheet fallbacks / accent-only callers). */
export const CC = {
  bg: "#050714",
  bgSecondary: "#090D1E",
  card: "#0B1022",
  cardElevated: "#0E1429",
  cardEntry: "#090E21",
  cardUnselected: "#0B1022",
  headerBtn: "#0D1226",
  backBtnBg: "#070B18",
  chipBg: "rgba(0,0,0,0.22)",
  surfaceSubtle: "rgba(255,255,255,0.06)",

  cyan: "#14D8FF",
  green: "#25E39A",
  warning: "#FF9F1C",

  text: "#FFFFFF",
  textSecondary: "#B4BBD0",
  textMuted: "#757D96",
  textSubtitle: "#A5ACC1",
  textSection: "#A9AFC2",
  textRange: "#C3C7D5",
  /** Unselected card title/desc — theme-relative translucents */
  unselectedTitle: "rgba(255,255,255,0.78)",
  unselectedDesc: "rgba(180,187,208,0.62)",

  border: "rgba(117, 130, 173, 0.28)",
  borderBtn: "rgba(121, 145, 205, 0.35)",
  borderBack: "rgba(135, 150, 198, 0.55)",
  borderEntry: "rgba(102, 124, 183, 0.30)",
  borderDaily: "rgba(75, 112, 181, 0.30)",

  progressUpcoming: "#48506A",
  connectorInactive: "#343A50",
  trackInactive: "#34394C",

  disabledBtn: "#343A52",
  disabledText: "#777E96",

  unselectedContentOpacity: 0.78,
  unselectedTitleOpacity: 0.78,
  unselectedDescOpacity: 0.62,
  unselectedPillOpacity: 0.6,

  /** Fallback when a room theme is unavailable — prefer selectCreateChallengeAccentTheme. */
  gradientCta: ROOM_ACCENT_THEMES.private.gradientCta,
} as const;

export type CreateChallengeChrome = {
  -readonly [K in keyof typeof CC]: (typeof CC)[K];
};

type ThemePalette = {
  background: string;
  foreground: string;
  card: string;
  muted: string;
  mutedForeground: string;
  border: string;
  warning: string;
  success: string;
  neonBlue: string;
};

/**
 * Map Create Challenge shell/surfaces to the app light/dark palette
 * (same source as Profile theme toggle via useColors).
 * Room neon accents stay in ROOM_ACCENT_THEMES.
 */
export function getCreateChallengeChrome(
  theme: ThemePalette,
  isDark: boolean,
): CreateChallengeChrome {
  if (isDark) {
    return { ...CC };
  }
  return {
    bg: theme.background,
    bgSecondary: theme.muted,
    card: theme.card,
    cardElevated: theme.card,
    cardEntry: theme.card,
    cardUnselected: theme.card,
    headerBtn: theme.muted,
    backBtnBg: theme.muted,
    chipBg: "rgba(10,11,20,0.06)",
    surfaceSubtle: "rgba(10,11,20,0.05)",

    cyan: theme.neonBlue,
    green: theme.success,
    warning: theme.warning,

    text: theme.foreground,
    textSecondary: theme.mutedForeground,
    textMuted: theme.mutedForeground,
    textSubtitle: theme.mutedForeground,
    textSection: theme.mutedForeground,
    textRange: theme.mutedForeground,
    unselectedTitle: "rgba(10,11,20,0.72)",
    unselectedDesc: "rgba(75,85,99,0.78)",

    border: theme.border,
    borderBtn: theme.border,
    borderBack: theme.border,
    borderEntry: theme.border,
    borderDaily: theme.border,

    progressUpcoming: "#B8BCC8",
    connectorInactive: "#C5CAD6",
    trackInactive: "#D0D4DE",

    disabledBtn: "#D8DCE6",
    disabledText: "#8B91A3",

    unselectedContentOpacity: 0.92,
    unselectedTitleOpacity: 0.9,
    unselectedDescOpacity: 0.78,
    unselectedPillOpacity: 0.8,

    gradientCta: ROOM_ACCENT_THEMES.private.gradientCta,
  };
}

export const CREATE_CHALLENGE_TOTAL_STEPS = 5 as const;
