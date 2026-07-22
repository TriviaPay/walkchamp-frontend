import { storageGet, storageSet } from "@/utils/storage";

export const ONBOARDING_VERSION = "walkchamp-onboarding-v1";

export const ONBOARDING_KEYS = {
  version: "walkChampOnboardingVersion",
  completed: "walkChampOnboardingCompleted",
  status: "walkChampOnboardingStatus",
  dailyGoal: "walkChampSelectedDailyGoal",
  healthChoice: "walkChampHealthOnboardingChoice",
  notificationChoice: "walkChampNotificationOnboardingChoice",
} as const;

export type OnboardingStatus = "not_started" | "in_progress" | "completed";
export type OnboardingChoice = "accepted" | "skipped" | "denied" | null;

export const DAILY_GOAL_OPTIONS = [
  { steps: 5000, label: "5,000 steps", recommended: false },
  { steps: 7500, label: "7,500 steps", recommended: false },
  { steps: 10000, label: "10,000 steps", recommended: true },
  { steps: 15000, label: "15,000 steps", recommended: false },
] as const;

export const DEFAULT_DAILY_GOAL = 10000;

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const completed = await storageGet<boolean>(ONBOARDING_KEYS.completed);
  if (completed) return "completed";
  const status = await storageGet<OnboardingStatus>(ONBOARDING_KEYS.status);
  return status ?? "not_started";
}

export async function markOnboardingInProgress(): Promise<void> {
  await storageSet(ONBOARDING_KEYS.version, ONBOARDING_VERSION);
  await storageSet(ONBOARDING_KEYS.status, "in_progress" satisfies OnboardingStatus);
}

export async function markOnboardingCompleted(): Promise<void> {
  await storageSet(ONBOARDING_KEYS.version, ONBOARDING_VERSION);
  await storageSet(ONBOARDING_KEYS.completed, true);
  await storageSet(ONBOARDING_KEYS.status, "completed" satisfies OnboardingStatus);
}

export async function getSelectedDailyGoal(): Promise<number> {
  const stored = await storageGet<number>(ONBOARDING_KEYS.dailyGoal);
  if (typeof stored === "number" && Number.isFinite(stored) && stored > 0) return stored;
  return DEFAULT_DAILY_GOAL;
}

export async function setSelectedDailyGoal(steps: number): Promise<void> {
  await storageSet(ONBOARDING_KEYS.dailyGoal, steps);
}

export async function setHealthOnboardingChoice(choice: Exclude<OnboardingChoice, null>): Promise<void> {
  await storageSet(ONBOARDING_KEYS.healthChoice, choice);
}

export async function setNotificationOnboardingChoice(
  choice: Exclude<OnboardingChoice, null>,
): Promise<void> {
  await storageSet(ONBOARDING_KEYS.notificationChoice, choice);
}
