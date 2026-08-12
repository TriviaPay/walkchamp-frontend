/**
 * WalkChamp typography tokens.
 *
 * These encode the EXISTING de-facto type scale found across the app.
 * Multiple sizes for the same "role" are intentional (screens differ) —
 * pick the variant that matches the current screen, do not normalize away
 * intentional differences.
 *
 * Font family: system default (SF / Roboto). Inter is loaded in _layout but
 * is not applied via fontFamily anywhere in production UI — do not introduce
 * Inter here (would change appearance).
 */

import { TextStyle } from "react-native";
import { rf, responsiveFont } from "@/utils/responsive";

type TypeStyle = Pick<
  TextStyle,
  | "fontSize"
  | "fontWeight"
  | "lineHeight"
  | "letterSpacing"
  | "textTransform"
  | "fontVariant"
>;

/** Build a clamped responsive size that stays near the design token. */
function fs(size: number, min?: number, max?: number): number {
  return responsiveFont(size, { min, max });
}

/**
 * Semantic typography variants matching current WalkChamp usage.
 * Values are design-baseline sizes (390×844); rf/responsiveFont keep them
 * stable on phones and mildly adjust at extremes.
 */
export const typography = {
  /** Auth / leaderboard style screen titles (~26) */
  screenTitle: {
    fontSize: fs(26, 22, 28),
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  /** App name / large screen titles (~28) */
  screenTitleLg: {
    fontSize: fs(28, 24, 30),
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  /** Secondary screen titles (~22) */
  screenTitleSm: {
    fontSize: fs(22, 19, 24),
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  /** Section headers (~18) */
  sectionTitle: {
    fontSize: fs(18, 16, 20),
    fontWeight: "700",
  },
  /** Compact section headers (~16) */
  sectionTitleSm: {
    fontSize: fs(16, 14, 18),
    fontWeight: "700",
  },
  /** Card / alert titles (~17) */
  cardTitle: {
    fontSize: fs(17, 15, 19),
    fontWeight: "700",
  },
  /** Uppercase section labels (~11) */
  sectionLabel: {
    fontSize: fs(11, 10, 12),
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  /** Dense uppercase labels (~9–10) */
  sectionLabelSm: {
    fontSize: fs(10, 9, 11),
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  /** Default body (~13) — most common size in the app */
  body: {
    fontSize: fs(13, 12, 15),
    lineHeight: rf(18),
  },
  /** Medium body / subtitles (~14) */
  bodyMd: {
    fontSize: fs(14, 12, 16),
    lineHeight: rf(20),
  },
  /** Larger body / chat bubbles / CTAs companion (~15) */
  bodyLg: {
    fontSize: fs(15, 13, 17),
    lineHeight: rf(20),
  },
  /** Muted captions (~11) */
  caption: {
    fontSize: fs(11, 10, 13),
    lineHeight: rf(15),
  },
  /** Small captions / meta (~10) */
  captionSm: {
    fontSize: fs(10, 9, 12),
  },
  /** Micro labels / dense chips (~9) */
  micro: {
    fontSize: fs(9, 8, 11),
  },
  /** Primary button labels (~15 / 800–900) */
  button: {
    fontSize: fs(15, 13, 17),
    fontWeight: "800",
  },
  /** Secondary / compact button labels (~13) */
  buttonSm: {
    fontSize: fs(13, 12, 15),
    fontWeight: "700",
  },
  /** Text inputs (~16) */
  input: {
    fontSize: fs(16, 14, 18),
  },
  /** Tab bar labels */
  tab: {
    fontSize: fs(10, 9, 11),
    fontWeight: "600",
  },
  /** Badge / pill text (~10) */
  badge: {
    fontSize: fs(10, 9, 12),
    fontWeight: "800",
  },
  /** Badge medium (~12) */
  badgeMd: {
    fontSize: fs(12, 10, 14),
    fontWeight: "800",
  },
  /** Large step / hero metrics (~44) */
  metricHero: {
    fontSize: fs(44, 36, 48),
    fontWeight: "800",
    letterSpacing: -2,
    fontVariant: ["tabular-nums"],
    lineHeight: rf(56),
  },
  /** Large numeric displays (~28–32) */
  metricLg: {
    fontSize: fs(28, 24, 32),
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  /** Mid metrics / ranks (~20) */
  metricMd: {
    fontSize: fs(20, 17, 22),
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  /** Live race countdown digits — keep dramatic, clamp extremes */
  countdown: {
    fontSize: fs(120, 72, 132),
    fontWeight: "800",
    lineHeight: rf(130),
    fontVariant: ["tabular-nums"],
  },
  /** Dialog / alert message (~14) */
  dialogBody: {
    fontSize: fs(14, 12, 16),
    lineHeight: rf(20),
  },
  /** Dialog title (~17) */
  dialogTitle: {
    fontSize: fs(17, 15, 19),
    fontWeight: "700",
  },
  /** Fine print / legal (~10–12) */
  finePrint: {
    fontSize: fs(11, 10, 13),
    lineHeight: rf(16),
  },
} as const satisfies Record<string, TypeStyle>;

export type TypographyVariant = keyof typeof typography;

/** Convenience: resolve a variant to a TextStyle object. */
export function getTypography(variant: TypographyVariant): TypeStyle {
  return typography[variant];
}
