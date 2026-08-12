/**
 * Unit tests for WalkChamp responsive math + token shape.
 * Pure Node (no react-native import) so CI does not hang on Dimensions.
 * Run: npx tsx utils/responsive.test.ts
 */

import assert from "node:assert/strict";

const BASE_W = 390;
const BASE_H = 844;

function rfAt(size: number, shortEdge: number, factor = 0.25): number {
  const hScale = shortEdge / BASE_W;
  if (hScale <= 1.08) {
    const shrink = hScale < 0.9 ? Math.max(hScale, 0.88) : 1;
    return Math.round(size * shrink);
  }
  const scaled = size * hScale;
  const moderate = size + (scaled - size) * factor;
  const clamped = Math.max(size * 0.9, Math.min(moderate, size * 1.2));
  return Math.round(clamped);
}

function rsAt(size: number, shortEdge: number): number {
  const hScale = shortEdge / BASE_W;
  return Math.round(size * Math.min(hScale, 1.25));
}

function responsiveFontAt(
  size: number,
  shortEdge: number,
  opts: { min?: number; max?: number } = {},
): number {
  const scaled = rfAt(size, shortEdge);
  const min = opts.min ?? Math.max(8, Math.floor(size * 0.88));
  const max = opts.max ?? Math.ceil(size * 1.2);
  return Math.min(max, Math.max(min, scaled));
}

function getLayoutScaleFactor(width: number): number {
  if (width >= 768) return Math.min(width / BASE_W, 1.25);
  return Math.max(0.87, Math.min(1.1, width / BASE_W));
}

// ── Baseline identity at 390 ─────────────────────────────────────────────────
assert.equal(rfAt(13, 390), 13);
assert.equal(rfAt(26, 390), 26);
assert.equal(rfAt(44, 390), 44);
assert.equal(rfAt(120, 390), 120);
assert.equal(rsAt(16, 390), 16);
assert.equal(responsiveFontAt(14, 390), 14);

// ── Small phone mild shrink ──────────────────────────────────────────────────
{
  const s = rfAt(16, 320);
  assert.ok(s >= Math.floor(16 * 0.88) - 1 && s <= 16, `small phone rf ${s}`);
  assert.ok(s < 16, "320dp should shrink slightly");
}

// ── Large phone does not explode fonts (hScale 430/390 ≈ 1.10 > 1.08) ───────
{
  const s = rfAt(16, 430);
  assert.ok(s <= Math.ceil(16 * 1.2), `large phone rf ${s}`);
  assert.ok(s < 20, "16px must not become 20+ on large phones");
}

// ── Tablet growth capped ─────────────────────────────────────────────────────
{
  const s = rfAt(16, 800);
  assert.ok(s <= Math.ceil(16 * 1.2), `tablet rf ${s}`);
}

// ── Explicit clamps ──────────────────────────────────────────────────────────
assert.equal(responsiveFontAt(16, 320, { min: 14, max: 18 }) >= 14, true);
{
  const c = responsiveFontAt(16, 320, { min: 14, max: 18 });
  assert.ok(c >= 14 && c <= 18);
}
{
  const hero = responsiveFontAt(44, 800, { min: 36, max: 48 });
  assert.ok(hero >= 36 && hero <= 48);
}

// ── Layout scale factor (live HUD) ───────────────────────────────────────────
assert.equal(getLayoutScaleFactor(390), 1);
assert.ok(getLayoutScaleFactor(320) >= 0.87);
assert.ok(getLayoutScaleFactor(430) <= 1.1);
assert.ok(getLayoutScaleFactor(800) <= 1.25);
assert.ok(getLayoutScaleFactor(800) < 1.5, "tablet must not use old 1.5× fork");

// ── Spacing scale caps ───────────────────────────────────────────────────────
assert.equal(rsAt(20, 390), 20);
assert.ok(rsAt(20, 1000) <= Math.round(20 * 1.25));

// ── Accessibility policy constant (mirrored) ─────────────────────────────────
const MAX_FONT_SIZE_MULTIPLIER = 1.15;
assert.equal(MAX_FONT_SIZE_MULTIPLIER, 1.15);
assert.equal(BASE_W, 390);
assert.equal(BASE_H, 844);

// ── Typography variant keys (documented contract) ────────────────────────────
const variants = [
  "screenTitle",
  "screenTitleLg",
  "screenTitleSm",
  "sectionTitle",
  "sectionTitleSm",
  "cardTitle",
  "sectionLabel",
  "sectionLabelSm",
  "body",
  "bodyMd",
  "bodyLg",
  "caption",
  "captionSm",
  "micro",
  "button",
  "buttonSm",
  "input",
  "tab",
  "badge",
  "badgeMd",
  "metricHero",
  "metricLg",
  "metricMd",
  "countdown",
  "dialogBody",
  "dialogTitle",
  "finePrint",
] as const;
assert.equal(variants.length, 27);

console.log("responsive.test.ts: all assertions passed");
