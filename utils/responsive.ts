/**
 * Responsive design utilities for WalkChamp.
 *
 * Values are computed once at module load from Dimensions, which is stable for
 * portrait-only apps and avoids per-render recalculation.
 *
 * Baseline: 390 × 844 (iPhone 14 / Pixel 7 class). On that width, rf(n) / rs(n)
 * return the design size unchanged — preserving the existing UI look.
 *
 * Usage in StyleSheet.create():
 *   import { rf, rs, rv, isTablet, MAX_CONTENT_WIDTH } from "@/utils/responsive";
 *   title: { fontSize: rf(24), paddingHorizontal: rs(16) }
 *
 * Prefer semantic tokens from `@/constants/typography` and `@/constants/spacing`
 * when a role is clear; otherwise keep rf(n) / rs(n) with the existing design size.
 */

import { Dimensions, PixelRatio } from "react-native";

const { width: WIN_W, height: WIN_H } = Dimensions.get("window");

/** Portrait-safe edges — never treat landscape height as "width". */
export const SHORT = Math.min(WIN_W, WIN_H);
export const LONG = Math.max(WIN_W, WIN_H);

// ── Device breakpoints (short edge = phone width in portrait) ────────────────
export const isSmallPhone = SHORT < 360;
export const isPhone = SHORT >= 360 && SHORT < 768;
export const isTablet = SHORT >= 768;
export const isLargeTablet = SHORT >= 1024;

// ── Baseline dimensions (iPhone 14 / Pixel 7 baseline) ───────────────────────
export const BASE_W = 390;
export const BASE_H = 844;

// ── Scale helpers ─────────────────────────────────────────────────────────────

/** Horizontal scale — short edge vs design width (portrait-safe). */
const hScale = SHORT / BASE_W;

/** Vertical scale — long edge vs design height. */
const vScale = LONG / BASE_H;

export const horizontalScaleFactor = hScale;
export const verticalScaleFactor = vScale;

/**
 * rs(n) — Responsive spacing / dimension (horizontalScale).
 * Scales with short edge; capped so tablets don't inflate spacing.
 */
export function rs(size: number): number {
  return Math.round(size * Math.min(hScale, 1.25));
}

/** Alias for rs — horizontal scale. */
export const horizontalScale = rs;

/**
 * rv(n) — Responsive vertical dimension (verticalScale).
 * Scales proportionally with height, capped at 1.25×.
 */
export function rv(size: number): number {
  return Math.round(size * Math.min(vScale, 1.25));
}

/** Alias for rv — vertical scale. */
export const verticalScale = rv;

/**
 * moderateScale(n, factor?) — gentler horizontal scale for spacing that
 * should not stretch as aggressively as full rs() on large phones.
 * factor 0 = no scale (design size); 1 = full hScale (capped).
 */
export function moderateScale(size: number, factor = 0.5): number {
  const capped = Math.min(hScale, 1.15);
  return Math.round(size + (size * capped - size) * factor);
}

/** Alias used by some call sites / docs. */
export const scale = rs;

/**
 * rf(n) — Responsive font size.
 *
 * Phones (~390dp width): returns the design size unchanged — matches the
 * previous fixed `fontSize: n` look across the app.
 * Small phones: slight shrink. Tablets: mild growth, max +20%.
 */
export function rf(size: number, factor = 0.25): number {
  // Normal / large phones — keep exact design tokens (previous app look).
  if (hScale <= 1.08) {
    const shrink = hScale < 0.9 ? Math.max(hScale, 0.88) : 1;
    return Math.round(PixelRatio.roundToNearestPixel(size * shrink));
  }

  const scaled = size * hScale;
  const moderate = size + (scaled - size) * factor;
  // Tablets only: never more than 1.2× design size
  const clamped = Math.max(size * 0.9, Math.min(moderate, size * 1.2));
  return Math.round(PixelRatio.roundToNearestPixel(clamped));
}

export type ResponsiveFontOptions = {
  /** Absolute minimum size after scaling (default: ~88% of design, floor 8). */
  min?: number;
  /** Absolute maximum size after scaling (default: ~120% of design). */
  max?: number;
  /** Passed to rf() for tablet moderate scaling. */
  factor?: number;
};

/**
 * responsiveFont(size, { min, max }) — rf() with explicit clamps.
 * Use for critical text that must stay readable without becoming oversized.
 *
 * On the baseline phone this equals `size` (same visual as before).
 */
export function responsiveFont(size: number, options: ResponsiveFontOptions = {}): number {
  const scaled = rf(size, options.factor);
  const min = options.min ?? Math.max(8, Math.floor(size * 0.88));
  const max = options.max ?? Math.ceil(size * 1.2);
  return Math.min(max, Math.max(min, scaled));
}

/** Alias for responsiveFont. */
export const responsiveFontSize = responsiveFont;

/**
 * responsiveSpacing(n) — spacing with gentler growth than rs on large phones.
 * Prefer rs() for gutters that already use it; use this for optional tightening.
 */
export function responsiveSpacing(size: number): number {
  return moderateScale(size, 0.5);
}

/**
 * MAX_CONTENT_WIDTH — maximum container width for tablet layouts.
 * Content centers inside this on wide screens.
 */
export const MAX_CONTENT_WIDTH = isTablet ? Math.min(SHORT * 0.78, 720) : SHORT;

/**
 * MODAL_MAX_WIDTH — maximum modal width so modals don't span full tablet width.
 */
export const MODAL_MAX_WIDTH = isTablet ? Math.min(SHORT * 0.72, 640) : SHORT;

/**
 * Responsive card width for 2-column grids on tablets, full-width on phones.
 * gap: the gap between columns.
 */
export function cardWidth(columns = 1, gap = 12, horizontalPadding = 32): number {
  const contentW = isTablet ? MAX_CONTENT_WIDTH : SHORT;
  return (contentW - horizontalPadding - gap * (columns - 1)) / columns;
}

/**
 * Layout scale factor used by live race HUD / track overlays.
 * Phones: same historical clamp (0.87–1.1× vs 390). Tablets: align with rs() (≤1.25×).
 * Pass the current window width when available (useWindowDimensions).
 */
export function getLayoutScaleFactor(width: number = SHORT): number {
  if (width >= 768) {
    return Math.min(width / BASE_W, 1.25);
  }
  return Math.max(0.87, Math.min(1.1, width / BASE_W));
}

/**
 * Scale a layout value with getLayoutScaleFactor (phone-safe race HUD sizing).
 * Prefer rs() for general UI; use this when matching live-detail / live-track.
 */
export function layoutScale(size: number, width: number = SHORT): number {
  return Math.round(size * getLayoutScaleFactor(width));
}
