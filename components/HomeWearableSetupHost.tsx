/**
 * App-root host for first-login Health Connect / Apple Health setup.
 * Lives outside the Walk tab so setup still opens if that tab mounts late.
 */

import React, { useCallback, useEffect, useState } from "react";
import WearableSetupModal from "@/components/WearableSetupModal";
import { useAuth } from "@/context/AuthContext";
import { useWalk } from "@/context/WalkContext";
import {
  isHomeStepSetupShellReady,
  markHomeStepSetupPhaseDone,
  registerHomeStepSetupCloser,
  registerHomeStepSetupOpener,
  setHomeStepSetupInProgress,
} from "@/services/permissions/homePermissionFlow";
import { markPermissionEducationShown } from "@/services/permissions/permissionCoordinator";

export function HomeWearableSetupHost() {
  const { user } = useAuth();
  const { completeStepSetup } = useWalk();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    registerHomeStepSetupOpener(() => {
      // Never show over splash/login — opener only runs after shell ready flush.
      if (!isHomeStepSetupShellReady()) return;
      if (!user?.id) return;
      setHomeStepSetupInProgress(true);
      setVisible(true);
    });
    registerHomeStepSetupCloser(() => {
      setVisible(false);
    });
    return () => {
      registerHomeStepSetupOpener(null);
      registerHomeStepSetupCloser(null);
    };
  }, [user?.id]);

  // Hide if auth user disappears (logout) so the sheet cannot linger on login.
  useEffect(() => {
    if (!user?.id && visible) {
      setVisible(false);
    }
  }, [user?.id, visible]);

  const finishPhase = useCallback(() => {
    markHomeStepSetupPhaseDone();
    if (user?.id) {
      void markPermissionEducationShown(user.id);
    }
  }, [user?.id]);

  return (
    <WearableSetupModal
      visible={visible}
      accent="onboarding"
      onClose={() => {
        setVisible(false);
        finishPhase();
      }}
      onComplete={(_platform, permissionStatus) => {
        setVisible(false);
        finishPhase();
        if (permissionStatus === "connected") {
          // First setup: enable HC steps + notifications + activity together.
          void completeStepSetup({ allowAll: true });
        }
      }}
    />
  );
}
