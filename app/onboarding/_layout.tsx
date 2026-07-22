import { Stack } from "expo-router";
import { ENABLE_PREMIUM_ONBOARDING } from "@/config/featureFlags";
import { Redirect } from "expo-router";

export default function OnboardingLayout() {
  if (!ENABLE_PREMIUM_ONBOARDING) {
    return <Redirect href="/(auth)" />;
  }
  return (
    <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="how-it-works" />
      <Stack.Screen name="step-goal" />
      <Stack.Screen name="health-connect" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="completion" />
    </Stack>
  );
}
