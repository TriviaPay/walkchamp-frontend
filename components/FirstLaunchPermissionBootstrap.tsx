/**
 * Mounts once after login and runs the first-launch step/motion permission flow.
 * Push remains owned by PushPermissionPrompt — this only sequences step tracking.
 */

import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { runFirstLaunchPermissionFlow } from "@/services/permissions/firstLaunchPermissionOrchestrator";

export function FirstLaunchPermissionBootstrap() {
  const { user, loading } = useAuth();
  const handledUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !user?.id) return;
    if (user.profileComplete === false) return;
    if (handledUserRef.current === user.id) return;
    handledUserRef.current = user.id;

    void runFirstLaunchPermissionFlow({
      userId: user.id,
      username: user.username ?? null,
    });
  }, [user?.id, user?.username, user?.profileComplete, loading]);

  return null;
}
