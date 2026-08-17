/**
 * App-root host for first-login Health Connect / Apple Health setup.
 * Lives outside the Walk tab so setup still opens if that tab mounts late.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import WearableSetupModal from "@/components/WearableSetupModal";
import { useAuth } from "@/context/AuthContext";
import { useWalk } from "@/context/WalkContext";
import {
  homeStepSetupCountsAsLater,
  isHomeStepSetupShellReady,
  markHomeStepSetupPhaseDone,
  registerHomeStepSetupCloser,
  registerHomeStepSetupOpener,
  registerHomeStepGrantHandler,
  setHomeStepSetupInProgress,
} from "@/services/permissions/homePermissionFlow";
import {
  markPermissionEducationShown,
  markDeviceStepSetupCompleted,
  recordDeviceSetupLater,
} from "@/services/permissions/permissionCoordinator";

export function HomeWearableSetupHost() {
  const { user } = useAuth();
  const { completeStepSetup, requestStepPermission } = useWalk();
  const [visible, setVisible] = useState(false);
  const [countsAsLater, setCountsAsLater] = useState(false);
  const completedRef = useRef(false);

  useEffect(() => {
    registerHomeStepGrantHandler(() => {
      void requestStepPermission();
    });
    return () => {
      registerHomeStepGrantHandler(null);
    };
  }, [requestStepPermission]);

  useEffect(() => {
    registerHomeStepSetupOpener(() => {
      // Never show over splash/login — opener only runs after shell ready flush.
      if (!isHomeStepSetupShellReady()) return;
      if (!user?.id) return;
      // Extra guard: modal must not mount while splash overlay could still be up.
      setHomeStepSetupInProgress(true);
      completedRef.current = false;
      setCountsAsLater(homeStepSetupCountsAsLater());
      // Defer one frame so splash unmount paint commits first.
      requestAnimationFrame(() => {
        if (!isHomeStepSetupShellReady() || !user?.id) return;
        setVisible(true);
      });
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
      countsAsLater={countsAsLater}
      onClose={() => {
        setVisible(false);
        finishPhase();
        if (!completedRef.current && homeStepSetupCountsAsLater()) {
          void recordDeviceSetupLater();
        }
        completedRef.current = false;
      }}
      onComplete={(_platform, permissionStatus) => {
        completedRef.current = true;
        setVisible(false);
        finishPhase();
        if (permissionStatus === "connected") {
          void markDeviceStepSetupCompleted();
          // First setup: enable HC steps + notifications + activity together.
          void completeStepSetup({ allowAll: true, assumeGranted: true });
        }
      }}
    />
  );
}
