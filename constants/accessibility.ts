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
