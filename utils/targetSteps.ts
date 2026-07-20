export type TargetStepDuration = "daily" | "weekly" | "monthly";

function range(start: number, end: number, step: number): number[] {
  const result: number[] = [];
  for (let v = start; v <= end; v += step) {
    result.push(v);
  }
  return result;
}

export function getTargetStepOptions(duration: TargetStepDuration): number[] {
  if (duration === "daily") return [100, ...range(1000, 10000, 1000)];
  if (duration === "weekly") return [100, ...range(50000, 70000, 1000)];
  return [100, ...range(250000, 300000, 1000)];
}

export function getDefaultTargetSteps(duration: TargetStepDuration): number {
  if (duration === "daily") return 10000;
  if (duration === "weekly") return 70000;
  return 300000;
}

export function isValidTargetSteps(duration: TargetStepDuration, targetSteps: number): boolean {
  return getTargetStepOptions(duration).includes(targetSteps);
}

export function isTestingTargetSteps(_duration: TargetStepDuration, targetSteps: number): boolean {
  return targetSteps === 100;
}

export function formatStepLabel(value: number): string {
  if (value < 1000) return `${value} steps`;
  const k = value / 1000;
  return Number.isInteger(k) ? `${k}k steps` : `${k.toFixed(1)}k steps`;
}

export function formatStepShortLabel(value: number): string {
  if (value < 1000) return `${value} steps`;
  const k = value / 1000;
  return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
}
