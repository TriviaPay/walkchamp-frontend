import { useRouter } from "expo-router";
import React, { useEffect } from "react";
import { View } from "react-native";

/**
 * Invisible redirect-only screen.
 *
 * On iOS, openAuthSessionAsync intercepts the deep link before expo-router
 * ever renders this screen — so it is never reached.
 *
 * On Android, Chrome Custom Tabs sometimes lets the deep link escape to the
 * OS intent system. The Linking listener in wallet.tsx catches it FIRST and
 * shows the PaymentResultModal. This screen just sends the user straight back
 * to the wallet tab, which is already showing the modal.
 */
export default function PaymentCompleteScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/(tabs)/wallet");
  }, [router]);

  return <View />;
}
