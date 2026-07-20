/**
 * Responsive design utilities for Walk Champ.
 *
 * Values are computed once at module load from Dimensions, which is stable for
 * portrait-only apps and avoids per-render recalculation.
 *
 * Usage in StyleSheet.create():
 *   import { rf, rs, rv, isTablet, MAX_CONTENT_WIDTH } from "@/utils/responsive";
 *   title: { fontSize: rf(24), paddingHorizontal: rs(16) }
 */

import { Dimensions, PixelRatio } from "react-native";

const { width: W, height: H } = Dimensions.get("window");

// ── Device breakpoints ────────────────────────────────────────────────────────
export const isSmallPhone   = W < 360;
export const isPhone        = W >= 360 && W < 768;
export const isTablet       = W >= 768;
export const isLargeTablet  = W >= 1024;

// ── Baseline dimensions (iPhone 14 / Pixel 7 baseline) ───────────────────────
const BASE_W = 390;
const BASE_H = 844;

// ── Scale helpers ─────────────────────────────────────────────────────────────

/** Horizontal scale — proportional to screen width. */
const hScale = W / BASE_W;

/** Vertical scale — proportional to screen height. */
const vScale = H / BASE_H;

/**
 * rs(n) — Responsive spacing / dimension.
 * Scales proportionally with width, capped at 1.6× on large tablets.
 */
export function rs(size: number): number {
  return Math.round(size * Math.min(hScale, 1.6));
}

/**
 * rv(n) — Responsive vertical dimension.
 * Scales proportionally with height, capped at 1.4×.
 */
export function rv(size: number): number {
  return Math.round(size * Math.min(vScale, 1.4));
}

/**
 * rf(n) — Responsive font size.
 * Uses moderateScale so fonts grow on bigger screens but not too aggressively.
 * factor=0.45 keeps text readable without becoming huge on tablets.
 */
export function rf(size: number, factor = 0.45): number {
  const scaled = size * hScale;
  const moderate = size + (scaled - size) * factor;
  // Clamp: never smaller than 0.85× and never larger than 1.5× original
  const clamped = Math.max(size * 0.85, Math.min(moderate, size * 1.5));
  return Math.round(PixelRatio.roundToNearestPixel(clamped));
}

/**
 * MAX_CONTENT_WIDTH — maximum container width for tablet layouts.
 * Content centers inside this on wide screens.
 */
export const MAX_CONTENT_WIDTH = isTablet ? Math.min(W * 0.78, 720) : W;

/**
 * MODAL_MAX_WIDTH — maximum modal width so modals don't span full tablet width.
 */
export const MODAL_MAX_WIDTH = isTablet ? Math.min(W * 0.72, 640) : W;

/**
 * Responsive card width for 2-column grids on tablets, full-width on phones.
 * gap: the gap between columns.
 */
export function cardWidth(columns = 1, gap = 12, horizontalPadding = 32): number {
  const contentW = isTablet ? MAX_CONTENT_WIDTH : W;
  return (contentW - horizontalPadding - gap * (columns - 1)) / columns;
}
