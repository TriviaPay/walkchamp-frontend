/**
 * Mounts once after login and runs the first-launch step/motion permission flow.
 * Push remains owned by PushPermissionPrompt — this only sequences step tracking.
 *
 * Must not run while signed out (including failed session restore with stale cache).
 */

import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAppSelector } from "@/store/hooks";
import { runFirstLaunchPermissionFlow } from "@/services/permissions/firstLaunchPermissionOrchestrator";

export function FirstLaunchPermissionBootstrap() {
  const { user, loading, sessionToken } = useAuth();
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const handledUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !isAuthenticated || !sessionToken || !user?.id) return;
    if (user.profileComplete === false) return;
    if (!user.emailVerified) return;
    if (handledUserRef.current === user.id) return;
    handledUserRef.current = user.id;

    void runFirstLaunchPermissionFlow({
      userId: user.id,
      username: user.username ?? null,
    });
  }, [
    user?.id,
    user?.username,
    user?.profileComplete,
    user?.emailVerified,
    loading,
    isAuthenticated,
    sessionToken,
  ]);

  return null;
}
