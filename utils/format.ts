export function formatSteps(steps: number): string {
  if (steps >= 1000) {
    return (steps / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  }
  return steps.toLocaleString();
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return (meters / 1000).toFixed(2) + " km";
  }
  return Math.round(meters) + " m";
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function formatCalories(calories: number): string {
  return Math.round(calories).toLocaleString();
}

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Format a wallet amount using the wallet's currency code.
 * INR shows whole rupees (₹), USD shows dollars with cents ($).
 */
export function formatWalletAmount(amount: number, currency: string): string {
  if (currency === "INR") return `₹${Math.round(amount).toLocaleString()}`;
  return `$${amount.toFixed(2)}`;
}

export function formatRank(rank: number): string {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return `${rank}th`;
}

export function stepsToDistance(steps: number): number {
  return steps * 0.762;
}

export function stepsToCalories(steps: number): number {
  return steps * 0.04;
}

export function getTodayKey(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}
