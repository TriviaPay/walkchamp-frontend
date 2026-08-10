/**
 * Global spacing tokens for Walk Champ.
 *
 * Values match the existing UI rhythm (common 4 / 8 / 12 / 16 / 20 / 24 patterns).
 * Use rs() so spacing tracks short-edge width with the same caps as the rest of the app.
 * Do not collapse distinct sizes (e.g. 10 vs 12) into one token — they are intentional.
 */

import { rs, rv } from "@/utils/responsive";

export const spacing = {
  /** 2 — hairline gaps, icon nudges */
  xxs: rs(2),
  /** 4 */
  xs: rs(4),
  /** 6 */
  sm: rs(6),
  /** 8 */
  md: rs(8),
  /** 10 — common chip / compact padding (kept distinct from 8 and 12) */
  mdPlus: rs(10),
  /** 12 */
  lg: rs(12),
  /** 14 */
  lgPlus: rs(14),
  /** 16 — default screen / card padding */
  xl: rs(16),
  /** 18 */
  xlPlus: rs(18),
  /** 20 — walk / primary content gutter */
  xxl: rs(20),
  /** 24 — auth / form gutter */
  xxxl: rs(24),
  /** 32 */
  huge: rs(32),
  /** 40 — common scroll bottom breathing room (before safe insets) */
  scrollExtra: rs(40),
} as const;

/** Vertical-only tokens (height-aware). Prefer spacing.* for most layout. */
export const spacingY = {
  xs: rv(4),
  sm: rv(8),
  md: rv(12),
  lg: rv(16),
  xl: rv(24),
  xxl: rv(28),
} as const;

export type SpacingToken = keyof typeof spacing;
