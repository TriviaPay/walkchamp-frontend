/**
 * Mounts once after login and runs the first-launch step/motion permission flow.
 * Push remains owned by PushPermissionPrompt — this only sequences step tracking.
 *
 * Must not run while signed out, on splash/login, or before the main tabs are visible.
 */

import { useEffect, useRef } from "react";
import { useSegments } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useAppSelector } from "@/store/hooks";
import { runFirstLaunchPermissionFlow } from "@/services/permissions/firstLaunchPermissionOrchestrator";
import {
  isHomeStepSetupShellReady,
} from "@/services/permissions/homePermissionFlow";
import { waitForAppStartupReady } from "@/services/appStartup";

function isMainAppSegment(segments: string[]): boolean {
  return segments.some((s) => s === "(tabs)");
}

function isAuthOrOnboardingSegment(segments: string[]): boolean {
  return segments.some(
    (s) => s === "(auth)" || s === "onboarding" || s === "(onboarding)",
  );
}

export function FirstLaunchPermissionBootstrap() {
  const { user, loading, sessionToken } = useAuth();
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const segments = useSegments();
  const handledUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id) {
      handledUserRef.current = null;
      return;
    }
    if (loading || !isAuthenticated || !sessionToken) return;
    if (user.profileComplete === false) return;
    if (!user.emailVerified) return;
    // Stay off splash/login/onboarding — only after home tabs.
    if (isAuthOrOnboardingSegment(segments as string[])) return;
    if (!isMainAppSegment(segments as string[])) return;
    if (handledUserRef.current === user.id) return;

    let cancelled = false;
    void (async () => {
      await waitForAppStartupReady();
      if (cancelled) return;
      // Wait until splash has marked the shell ready. Do NOT proceed on timeout —
      // opening HC while splash is still visible is the bug we must avoid.
      if (!isHomeStepSetupShellReady()) {
        await new Promise<void>((resolve) => {
          const id = setInterval(() => {
            if (cancelled || isHomeStepSetupShellReady()) {
              clearInterval(id);
              resolve();
            }
          }, 100);
        });
      }
      if (cancelled) return;
      if (!isHomeStepSetupShellReady()) return;
      if (handledUserRef.current === user.id) return;
      handledUserRef.current = user.id;
      await runFirstLaunchPermissionFlow({
        userId: user.id,
        username: user.username ?? null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    user?.id,
    user?.username,
    user?.profileComplete,
    user?.emailVerified,
    loading,
    isAuthenticated,
    sessionToken,
    segments,
  ]);

  // Hide setup if the user signs out mid-sheet (do not clear splash shell readiness —
  // next login on the same session still uses the already-dismissed splash).
  useEffect(() => {
    if (!isAuthenticated) {
      handledUserRef.current = null;
    }
  }, [isAuthenticated]);

  return null;
}
