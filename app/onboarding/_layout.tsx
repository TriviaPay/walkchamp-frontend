import { Redirect, Stack } from "expo-router";
import { ENABLE_PREMIUM_ONBOARDING } from "@/config/featureFlags";
import { useAppSelector } from "@/store/hooks";

export default function OnboardingLayout() {
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const isRestoring = useAppSelector((s) => s.auth.isRestoringSession);

  if (!ENABLE_PREMIUM_ONBOARDING) {
    return <Redirect href="/(auth)" />;
  }

  // Onboarding runs after Sign In / Sign Up — bounce signed-out users to auth.
  if (!isRestoring && !isAuthenticated) {
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
