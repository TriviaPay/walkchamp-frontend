/**
 * WalkChamp accessibility / system font-scaling policy.
 *
 * Allow OS font scaling (allowFontScaling defaults to true) so users with
 * mild accessibility preferences still get larger text, but hard-cap growth
 * so fixed interactive layouts (tab bar, race HUD, cards, modals) do not break.
 *
 * Applied globally via Text / TextInput defaultProps in app/_layout.tsx.
 * Prefer per-component maxFontSizeMultiplier only for dense fixed HUD chrome
 * that cannot reflow (e.g. live race overlays) — do not disable scaling globally.
 */
export const MAX_FONT_SIZE_MULTIPLIER = 1.15;

/** Font scale at which onboarding / dense screens should prefer scroll over fixed layout. */
export const ACCESSIBILITY_SCROLL_FONT_SCALE = 1.35;

/**
 * Tab bar, pills, chips, and card CTAs — lock to design size so OS font scaling
 * cannot clip or reflow fixed layouts. Visual appearance at default OS font
 * is unchanged.
 */
export const FIXED_CHROME_TEXT_PROPS = {
  maxFontSizeMultiplier: 1,
} as const;

/** Tight pills/buttons (Host, View, Explore) — shrink slightly before clipping. */
export const FIXED_PILL_TEXT_PROPS = {
  maxFontSizeMultiplier: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.72,
  numberOfLines: 1 as const,
} as const;
