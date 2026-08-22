import { Redirect, Stack, usePathname, useGlobalSearchParams } from "expo-router";
import { useAppSelector } from "@/store/hooks";

/**
 * Auth-gate race routes (audit A11). Without this, logged-out deep links paint a
 * synthetic in_progress Live Race shell because the detail fetch is session-gated.
 */
export default function RaceLayout() {
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const isRestoring = useAppSelector((s) => s.auth.isRestoringSession);
  const pathname = usePathname();
  const params = useGlobalSearchParams();

  if (!isRestoring && !isAuthenticated) {
    // Preserve destination so post-login navigation can resume the race link.
    const qs = Object.entries(params)
      .filter(([, v]) => v != null && String(v).length > 0)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    const returnTo = qs ? `${pathname}?${qs}` : pathname;
    return (
      <Redirect
        href={{
          pathname: "/(auth)",
          params: { returnTo },
        }}
      />
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="matchmaking" />
      <Stack.Screen name="room" />
      <Stack.Screen name="result" />
      <Stack.Screen name="live-detail" />
    </Stack>
  );
}
