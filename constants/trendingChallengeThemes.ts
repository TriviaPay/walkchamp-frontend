/**
 * Trending Challenges — themes & deterministic artwork keys.
 * Pure tokens; no Math.random().
 */

export const TRENDING_THEME_KEYS = [
  "neon_blue",
  "neon_pink",
  "neon_amber",
  "neon_emerald",
  "neon_violet",
  "neon_cyan",
  "neon_red",
  "neon_indigo",
  "neon_lime",
  "neon_teal",
] as const;

export type TrendingThemeKey = (typeof TRENDING_THEME_KEYS)[number];

export const TRENDING_ARTWORK_KEYS = [
  "city",
  "sunset",
  "mountain",
  "forest",
  "stadium",
  "shoe",
  "trophy",
  "lightning",
  "night_track",
  "future_city",
] as const;

export type TrendingArtworkKey = (typeof TRENDING_ARTWORK_KEYS)[number];

export type TrendingThemeTokens = {
  key: TrendingThemeKey;
  border: string;
  glow: string;
  badgeBg: string;
  badgeText: string;
  gradient: readonly [string, string, string];
  accent: string;
  icon: string;
};

export const TRENDING_THEMES: Record<TrendingThemeKey, TrendingThemeTokens> = {
  neon_blue: {
    key: "neon_blue",
    border: "#22D3EE",
    glow: "rgba(34, 211, 238, 0.45)",
    badgeBg: "rgba(34, 211, 238, 0.22)",
    badgeText: "#67E8F9",
    gradient: ["#042F4A", "#0B4F78", "#155E9A"],
    accent: "#22D3EE",
    icon: "#67E8F9",
  },
  neon_pink: {
    key: "neon_pink",
    border: "#F472B6",
    glow: "rgba(244, 114, 182, 0.45)",
    badgeBg: "rgba(244, 114, 182, 0.22)",
    badgeText: "#F9A8D4",
    gradient: ["#3B0A2E", "#6B1D4A", "#9D174D"],
    accent: "#F472B6",
    icon: "#F9A8D4",
  },
  neon_amber: {
    key: "neon_amber",
    border: "#FBBF24",
    glow: "rgba(251, 191, 36, 0.4)",
    badgeBg: "rgba(251, 191, 36, 0.2)",
    badgeText: "#FDE68A",
    gradient: ["#3B2A08", "#78350F", "#92400E"],
    accent: "#FBBF24",
    icon: "#FDE68A",
  },
  neon_emerald: {
    key: "neon_emerald",
    border: "#34D399",
    glow: "rgba(52, 211, 153, 0.4)",
    badgeBg: "rgba(52, 211, 153, 0.2)",
    badgeText: "#6EE7B7",
    gradient: ["#052E1C", "#065F46", "#047857"],
    accent: "#34D399",
    icon: "#6EE7B7",
  },
  neon_violet: {
    key: "neon_violet",
    border: "#A78BFA",
    glow: "rgba(167, 139, 250, 0.45)",
    badgeBg: "rgba(167, 139, 250, 0.22)",
    badgeText: "#C4B5FD",
    gradient: ["#1E1035", "#4C1D95", "#5B21B6"],
    accent: "#A78BFA",
    icon: "#C4B5FD",
  },
  neon_cyan: {
    key: "neon_cyan",
    border: "#2DD4BF",
    glow: "rgba(45, 212, 191, 0.4)",
    badgeBg: "rgba(45, 212, 191, 0.2)",
    badgeText: "#5EEAD4",
    gradient: ["#042F2E", "#115E59", "#0F766E"],
    accent: "#2DD4BF",
    icon: "#5EEAD4",
  },
  neon_red: {
    key: "neon_red",
    border: "#F87171",
    glow: "rgba(248, 113, 113, 0.4)",
    badgeBg: "rgba(248, 113, 113, 0.2)",
    badgeText: "#FCA5A5",
    gradient: ["#3B0A0A", "#7F1D1D", "#991B1B"],
    accent: "#F87171",
    icon: "#FCA5A5",
  },
  neon_indigo: {
    key: "neon_indigo",
    border: "#818CF8",
    glow: "rgba(129, 140, 248, 0.4)",
    badgeBg: "rgba(129, 140, 248, 0.2)",
    badgeText: "#A5B4FC",
    gradient: ["#12143A", "#312E81", "#3730A3"],
    accent: "#818CF8",
    icon: "#A5B4FC",
  },
  neon_lime: {
    key: "neon_lime",
    border: "#A3E635",
    glow: "rgba(163, 230, 53, 0.35)",
    badgeBg: "rgba(163, 230, 53, 0.18)",
    badgeText: "#BEF264",
    gradient: ["#1A2E05", "#3F6212", "#4D7C0F"],
    accent: "#A3E635",
    icon: "#BEF264",
  },
  neon_teal: {
    key: "neon_teal",
    border: "#14B8A6",
    glow: "rgba(20, 184, 166, 0.4)",
    badgeBg: "rgba(20, 184, 166, 0.2)",
    badgeText: "#5EEAD4",
    gradient: ["#042F2E", "#0F766E", "#0D9488"],
    accent: "#14B8A6",
    icon: "#5EEAD4",
  },
};

export function getTrendingTheme(key: TrendingThemeKey): TrendingThemeTokens {
  return TRENDING_THEMES[key] ?? TRENDING_THEMES.neon_blue;
}
