import * as WebBrowser from "expo-web-browser";
import React from "react";
import { ActivityIndicator, View } from "react-native";

// MUST be called at module level on web — tells the auth popup that the
// redirect has landed and signals the result back to openAuthSessionAsync().
// On native this is a no-op; the OS deep-link intercept handles it instead.
WebBrowser.maybeCompleteAuthSession();

export default function AuthCallbackScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: "#0A0B14", alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" color="#00E676" />
    </View>
  );
}
