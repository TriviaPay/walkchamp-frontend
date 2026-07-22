/**
 * Responsive design utilities for Walk Champ.
 *
 * Values are computed once at module load from Dimensions, which is stable for
 * portrait-only apps and avoids per-render recalculation.
 *
 * Usage in StyleSheet.create():
 *   import { rf, rs, rv, isTablet, MAX_CONTENT_WIDTH } from "@/utils/responsive";
 *   title: { fontSize: rf(24), paddingHorizontal: rs(16) }
 *
 * Fonts: on normal phones `rf(n)` returns the design size `n` (same as the
 * pre-responsive fixed fontSize look). Only very small phones shrink slightly;
 * tablets grow mildly and are hard-capped.
 */

import { Dimensions, PixelRatio } from "react-native";

const { width: WIN_W, height: WIN_H } = Dimensions.get("window");

/** Portrait-safe edges — never treat landscape height as "width". */
const SHORT = Math.min(WIN_W, WIN_H);
const LONG = Math.max(WIN_W, WIN_H);

// ── Device breakpoints (short edge = phone width in portrait) ────────────────
export const isSmallPhone = SHORT < 360;
export const isPhone = SHORT >= 360 && SHORT < 768;
export const isTablet = SHORT >= 768;
export const isLargeTablet = SHORT >= 1024;

// ── Baseline dimensions (iPhone 14 / Pixel 7 baseline) ───────────────────────
const BASE_W = 390;
const BASE_H = 844;

// ── Scale helpers ─────────────────────────────────────────────────────────────

/** Horizontal scale — short edge vs design width (portrait-safe). */
const hScale = SHORT / BASE_W;

/** Vertical scale — long edge vs design height. */
const vScale = LONG / BASE_H;

/**
 * rs(n) — Responsive spacing / dimension.
 * Scales with short edge; capped so tablets don't inflate spacing.
 */
export function rs(size: number): number {
  return Math.round(size * Math.min(hScale, 1.25));
}

/**
 * rv(n) — Responsive vertical dimension.
 * Scales proportionally with height, capped at 1.25×.
 */
export function rv(size: number): number {
  return Math.round(size * Math.min(vScale, 1.25));
}

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
