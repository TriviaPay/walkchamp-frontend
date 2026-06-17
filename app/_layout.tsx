import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider as NavThemeProvider, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, LogBox, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { initializeAds } from "@/services/ads/adMobService";
import { Provider as ReduxProvider } from "react-redux";
import { store } from "@/store";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AlertHost } from "@/components/AppAlert";
import { AuthProvider } from "@/context/AuthContext";
import { AppProvider } from "@/context/AppContext";
import { WalkProvider } from "@/context/WalkContext";
import { RaceProvider } from "@/context/RaceContext";
import { PresenceProvider } from "@/context/PresenceContext";
import { AvatarVersionProvider } from "@/context/AvatarVersionContext";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { SoundProvider } from "@/context/SoundContext";
import { UnreadProvider } from "@/context/UnreadContext";
import CoinRewardToast from "@/components/CoinRewardToast";
import { CoinRealtimeSync } from "@/components/CoinRealtimeSync";
import { RoomInvitationModal, type RoomInvitation } from "@/components/RoomInvitationModal";
import { TitleUnlockProvider } from "@/context/TitleUnlockContext";
import { TopBannerProvider } from "@/context/TopBannerContext";
import TitleUnlockModal from "@/components/TitleUnlockModal";
import { useAuth } from "@/context/AuthContext";
import { connectPusher, subscribeToChannel, unsubscribeFromChannel, CHANNELS } from "@/services/realtimeService";
import {
  initOneSignal,
  logoutOneSignal,
  getNotificationPreferences,
  registerDeviceWithBackend,
  setupNotificationClickHandler,
  setupForegroundHandler,
} from "@/services/notificationService";

// ── App startup diagnostics ────────────────────────────────────────────────
if (__DEV__) {
  console.log(`[AppStart] platform: ${Platform.OS}`);
  console.log(`[AppStart] env loaded: API_URL=${process.env.EXPO_PUBLIC_API_URL ?? "(unset)"} DESCOPE=${process.env.EXPO_PUBLIC_DESCOPE_PROJECT_ID ? "set" : "(unset)"} PUSHER_KEY=${process.env.EXPO_PUBLIC_PUSHER_KEY ? "set" : "(unset)"}`);
}

// ── Suppress fontfaceobserver timeout crash on web ─────────────────────────
// fontfaceobserver throws an uncaught Error after 6s when fonts can't load in
// the browser. React Native's error overlay catches it and shows a red screen.
// We intercept it at the window level before it can propagate.
if (Platform.OS === "web" && typeof window !== "undefined") {
  const _origOnError = window.onerror;
  window.onerror = (msg, src, _line, _col, err) => {
    if (
      typeof msg === "string" &&
      msg.includes("timeout exceeded") &&
      typeof src === "string" &&
      src.includes("fontfaceobserver")
    ) {
      return true; // swallow the error
    }
    if (typeof _origOnError === "function") {
      return _origOnError(msg, src, _line, _col, err);
    }
    return false;
  };

  window.addEventListener(
    "error",
    (e) => {
      if (
        e.message?.includes("timeout exceeded") &&
        e.filename?.includes("fontfaceobserver")
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true, // capture phase — fires before React's handler
  );

  window.addEventListener("unhandledrejection", (e) => {
    if (String(e.reason?.message ?? "").includes("timeout exceeded")) {
      e.preventDefault();
    }
  });
}

SplashScreen.preventAutoHideAsync();

// Suppress known Expo-Go-only TurboModule warnings.
// These native modules require an EAS / development build to link properly.
// In Expo Go the JS module loads but the native bridge is absent — our
// service guards handle this gracefully; the red-box adds no value in dev.
LogBox.ignoreLogs([
  "TurboModuleRegistry.getEnforcing",
  "'OneSignal' could not be found",
  "'RNGoogleMobileAdsModule' could not be found",
]);

const queryClient = new QueryClient();

const BG = "#0A0B14";
const ACCENT = "#00E676";

function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? "light" : "dark"} translucent />;
}

function RootLayoutNav() {
  const { isDark } = useTheme();
  const navTheme = React.useMemo(() => ({
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: isDark ? "#0A0B14" : "#EDEEF2",
      card:       isDark ? "#12141F" : "#FFFFFF",
      text:       isDark ? "#F0F2FF" : "#0A0B14",
      border:     isDark ? "#1E2138" : "#B8BCC8",
      primary:    isDark ? "#00E676" : "#00C853",
    },
  }), [isDark]);

  return (
    <NavThemeProvider value={navTheme}>
      <ThemedStatusBar />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: isDark ? "#0A0B14" : "#EDEEF2" } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="auth-callback" />
        <Stack.Screen name="race" options={{ presentation: "card", animation: "slide_from_right" }} />
        <Stack.Screen name="profile" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
        <Stack.Screen name="live-races" />
        <Stack.Screen name="spectator/[id]" />
        <Stack.Screen name="payment-complete" options={{ headerShown: false }} />
      </Stack>
    </NavThemeProvider>
  );
}

// ── OneSignal push notification setup ────────────────────────────────────────
// Initializes OneSignal after login, registers the device, and wires up
// notification click routing. Tears down on logout.
function PushNotificationSetup() {
  const { user } = useAuth();
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || user.id === prevUserIdRef.current) return;
    prevUserIdRef.current = user.id;

    void (async () => {
      try {
        await initOneSignal(user.id);
        const enabled = await getNotificationPreferences();
        if (enabled) {
          await registerDeviceWithBackend();
        }
        // Set up foreground display handler (fire-and-forget cleanup not needed
        // since the app lifecycle owns this component)
        await setupForegroundHandler();
      } catch {
        // Never crash on notification setup
      }
    })();
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      prevUserIdRef.current = null;
      void logoutOneSignal().catch(() => {});
    }
  }, [user]);

  // Set up click routing — router is stable for the app lifetime
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void setupNotificationClickHandler((route) => {
      try {
        // expo-router global navigate
        const { router } = require("expo-router") as { router: { push: (r: string) => void } };
        router.push(route as never);
      } catch {
        // Ignore routing errors
      }
    }).then((fn) => { cleanup = fn; });
    return () => { cleanup?.(); };
  }, []);

  return null;
}

// ── Global room invitation overlay ────────────────────────────────────────────
// Listens on the user's private Pusher channel for incoming room invites and
// shows the RoomInvitationModal wherever the user is in the app.
function RoomInvitationOverlay() {
  const { user } = useAuth();
  const [invitation, setInvitation] = React.useState<RoomInvitation | null>(null);

  React.useEffect(() => {
    if (!user?.id) return;
    connectPusher();
    const channel = subscribeToChannel(CHANNELS.privateUser(user.id));
    if (!channel) return;

    const onNewInvite = (data: RoomInvitation) => {
      setInvitation(data);
    };

    const onExpired = (data: { inviteId: string }) => {
      setInvitation((prev) =>
        prev?.inviteId === data.inviteId ? null : prev,
      );
    };

    channel.bind("room_invite:new", onNewInvite);
    channel.bind("room_invite:expired", onExpired);

    return () => {
      channel.unbind("room_invite:new", onNewInvite);
      channel.unbind("room_invite:expired", onExpired);
      unsubscribeFromChannel(CHANNELS.privateUser(user.id));
    };
  }, [user?.id]);

  return (
    <RoomInvitationModal
      invitation={invitation}
      onDismiss={() => setInvitation(null)}
    />
  );
}

export default function RootLayout() {
  const isWeb = Platform.OS === "web";

  // On web, pass empty map so fontfaceobserver never queues font checks.
  // Any residual errors are caught by the module-level window handlers above.
  const [fontsLoaded, fontError] = useFonts(
    isWeb
      ? {}
      : {
          Inter_400Regular,
          Inter_500Medium,
          Inter_600SemiBold,
          Inter_700Bold,
        },
  );

  const [fontTimedOut, setFontTimedOut] = useState(isWeb);

  useEffect(() => {
    if (isWeb) return;
    const t = setTimeout(() => setFontTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, [isWeb]);

  useEffect(() => {
    if (fontsLoaded || fontError || fontTimedOut) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded, fontError, fontTimedOut]);

  // Initialize AdMob SDK once after fonts settle
  useEffect(() => {
    void initializeAds();
  }, []);

  if (!fontsLoaded && !fontError && !fontTimedOut) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={ACCENT} size="large" />
      </View>
    );
  }

  return (
    <ThemeProvider>
    <SoundProvider>
    <ReduxProvider store={store}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <AppProvider>
                <WalkProvider>
                  <RaceProvider>
                    <PresenceProvider>
                      <AvatarVersionProvider>
                        <UnreadProvider>
                          <GestureHandlerRootView style={{ flex: 1 }}>
                            <KeyboardProvider>
                              <TopBannerProvider>
                              <TitleUnlockProvider>
                                <RootLayoutNav />
                                <AlertHost />
                                <CoinRealtimeSync />
                                <CoinRewardToast />
                                <RoomInvitationOverlay />
                                <PushNotificationSetup />
                                <TitleUnlockModal />
                              </TitleUnlockProvider>
                              </TopBannerProvider>
                            </KeyboardProvider>
                          </GestureHandlerRootView>
                        </UnreadProvider>
                      </AvatarVersionProvider>
                    </PresenceProvider>
                  </RaceProvider>
                </WalkProvider>
              </AppProvider>
            </AuthProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </ReduxProvider>
    </SoundProvider>
    </ThemeProvider>
  );
}
