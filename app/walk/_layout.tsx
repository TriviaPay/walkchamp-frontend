import { Stack } from "expo-router";

export default function WalkLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="step-history" />
    </Stack>
  );
}
