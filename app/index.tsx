import { Redirect } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { perf } from "@/utils/perfLogger";

export default function RootIndex() {
  const { user, loading, isAuthenticating } = useAuth();
  const colors = useColors();
  const routeReadyLogged = useRef(false);

  useEffect(() => {
    if (!loading && !isAuthenticating && !routeReadyLogged.current) {
      routeReadyLogged.current = true;
      perf.initialRouteReady(perf.elapsedSinceAppStart());
    }
  }, [loading, isAuthenticating]);

  // Block only when there is no cached user to route with.
  // Logged-in users with a hydrated profile proceed immediately while
  // restoreSession validates the token in the background.
  if ((loading && !user) || isAuthenticating) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!user) return <Redirect href="/(auth)" />;

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

  return <Redirect href="/(tabs)/walk" />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
