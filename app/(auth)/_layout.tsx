import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="signup" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="onboarding" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="verify-email" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="forgot-password" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="complete-profile" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="account-restricted" options={{ animation: "fade" }} />
    </Stack>
  );
}
