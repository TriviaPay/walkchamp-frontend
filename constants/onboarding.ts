export const ONBOARDING_COLORS = {
  bg: "#070A18",
  bgSecondary: "#0E1428",
  card: "#141D34",
  primary: "#224DB6",
  cyan: "#20C7FF",
  lime: "#45F28C",
  purple: "#7C4DFF",
  text: "#F7F9FF",
  textSecondary: "#9BA7C4",
  border: "rgba(85, 111, 190, 0.30)",
} as const;

export const ONBOARDING_ASSETS = {
  welcome: require("@/assets/images/onboarding/welcome.png"),
  howItWorks: require("@/assets/images/onboarding/how-it-works.png"),
  stepGoal: require("@/assets/images/onboarding/step-goal.png"),
  healthConnect: require("@/assets/images/onboarding/health-connect.png"),
  notifications: require("@/assets/images/onboarding/notifications.png"),
  completion: require("@/assets/images/onboarding/completion-screen.png"),
} as const;

export const ONBOARDING_ROUTES = {
  welcome: "/onboarding/welcome",
  howItWorks: "/onboarding/how-it-works",
  stepGoal: "/onboarding/step-goal",
  healthConnect: "/onboarding/health-connect",
  notifications: "/onboarding/notifications",
  completion: "/onboarding/completion",
  home: "/(tabs)/walk",
} as const;
