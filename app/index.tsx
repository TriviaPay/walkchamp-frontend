import { Redirect } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { perf } from "@/utils/perfLogger";
import { ENABLE_PREMIUM_ONBOARDING } from "@/config/featureFlags";
import { ONBOARDING_ROUTES } from "@/constants/onboarding";
import { getOnboardingStatus } from "@/utils/onboardingStorage";

export default function RootIndex() {
  const { user, loading, isAuthenticating } = useAuth();
  const routeReadyLogged = useRef(false);
  const [onboardingChecked, setOnboardingChecked] = useState(!ENABLE_PREMIUM_ONBOARDING);
  const [onboardingInProgress, setOnboardingInProgress] = useState(false);

  useEffect(() => {
    if (!loading && !isAuthenticating && !routeReadyLogged.current) {
      routeReadyLogged.current = true;
      perf.initialRouteReady(perf.elapsedSinceAppStart());
    }
  }, [loading, isAuthenticating]);

  useEffect(() => {
    if (!ENABLE_PREMIUM_ONBOARDING || !user) {
      setOnboardingChecked(true);
      setOnboardingInProgress(false);
      return;
    }

    let cancelled = false;
    setOnboardingChecked(false);
    void (async () => {
      const status = await getOnboardingStatus();
      if (!cancelled) {
        // Resume only if signup started onboarding and it wasn't finished yet.
        setOnboardingInProgress(status === "in_progress");
        setOnboardingChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Block only when there is no cached user to route with.
  // Logged-in users with a hydrated profile proceed immediately while
  // restoreSession validates the token in the background.
  // Splash already waits for auth/onboarding settle — keep a quiet fallback.
  if ((loading && !user) || isAuthenticating || (user && !onboardingChecked)) {
    return <View style={[styles.loading, { backgroundColor: "#EAF6E8" }]} />;
  }

  if (!user) {
    return <Redirect href="/(auth)" />;
  }

  // Restricted account
  if (user.accountStatus === "suspended" || user.accountStatus === "banned") {
    return <Redirect href="/(auth)/account-restricted" />;
  }

  // Email not verified yet
  if (!user.emailVerified) {
    return <Redirect href={{ pathname: "/(auth)/verify-email", params: { email: user.email, userId: user.id } }} />;
  }

  // Profile incomplete (social login first time)
  if (!user.profileComplete) {
    return <Redirect href={{ pathname: "/(auth)/complete-profile", params: { userId: user.id, email: user.email } }} />;
  }

  // Resume post-signup onboarding if the user left mid-flow
  if (ENABLE_PREMIUM_ONBOARDING && onboardingInProgress) {
    return <Redirect href={ONBOARDING_ROUTES.welcome} />;
  }

  return <Redirect href="/(tabs)/walk" />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
