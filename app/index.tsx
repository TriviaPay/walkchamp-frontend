import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function RootIndex() {
  const { user, loading, isAuthenticating } = useAuth();
  const colors = useColors();

  // Show spinner while session is restoring OR while login() is completing its
  // handoff — this prevents the routing guards below from racing ahead of the
  // manual router.replace() called by the login/signup screens.
  if (loading || isAuthenticating) {
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
