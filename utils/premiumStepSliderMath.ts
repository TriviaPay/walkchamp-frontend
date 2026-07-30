/** Pure discrete-slider math — shared by PremiumStepSlider and unit tests. */

export function indexOfDiscreteValue<T>(values: readonly T[], value: T): number {
  const idx = values.indexOf(value);
  return idx >= 0 ? idx : 0;
}

export function snapIndexFromRatio(ratio: number, count: number): number {
  if (count <= 1) return 0;
  const clamped = Math.max(0, Math.min(1, ratio));
  return Math.round(clamped * (count - 1));
}

export function ratioFromIndex(index: number, count: number): number {
  if (count <= 1) return 0;
  const clamped = Math.max(0, Math.min(count - 1, index));
  return clamped / (count - 1);
}
