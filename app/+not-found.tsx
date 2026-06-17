import { Link, Stack, useRouter, usePathname } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useEffect } from "react";

import { useColors } from "@/hooks/useColors";

export default function NotFoundScreen() {
  const colors = useColors();
  const router = useRouter();
  const pathname = usePathname();

  // Redirect payment-complete deep links back to wallet.
  // Triggered when a device has an old Expo Go bundle that doesn't include
  // the payment-complete route — the wallet screen (always mounted as a tab)
  // detects the payment result via polling and shows the modal.
  useEffect(() => {
    if (pathname.includes("payment-complete")) {
      router.replace("/(tabs)/wallet");
    }
  }, [pathname, router]);

  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          This screen doesn&apos;t exist.
        </Text>

        <Link href="/" style={styles.link}>
          <Text style={[styles.linkText, { color: colors.primary }]}>
            Go to home screen!
          </Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
  },
});
