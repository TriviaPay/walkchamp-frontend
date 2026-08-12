import React, { useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import {
  OnboardingFeatureCard,
  OnboardingLayout,
  OnboardingMascot,
  OnboardingPrimaryButton,
  OnboardingSecondaryButton,
} from "@/components/onboarding/OnboardingUI";
import { ONBOARDING_ASSETS, ONBOARDING_COLORS, ONBOARDING_ROUTES } from "@/constants/onboarding";
import { setHealthOnboardingChoice } from "@/utils/onboardingStorage";
import WearableSetupModal from "@/components/WearableSetupModal";
import { useWalk } from "@/context/WalkContext";
import { useAuth } from "@/context/AuthContext";
import { markPermissionEducationShown } from "@/services/permissions/permissionCoordinator";
import { markHomeStepSetupPhaseDone } from "@/services/permissions/homePermissionFlow";
import { rf } from "@/utils/responsive";

const C = ONBOARDING_COLORS;
const isIOS = Platform.OS === "ios";

export default function HealthConnectOnboardingScreen() {
  const [showSetup, setShowSetup] = useState(false);
  const completedRef = useRef(false);
  const { completeStepSetup } = useWalk();
  const { user } = useAuth();

  const continueNext = async (choice: "accepted" | "skipped" | "denied") => {
    await setHealthOnboardingChoice(choice);
    // Prevent HomeWearableSetupHost from opening the same wizard again after Enter.
    if (user?.id) {
      await markPermissionEducationShown(user.id);
    }
    markHomeStepSetupPhaseDone();
    router.push(ONBOARDING_ROUTES.notifications);
  };

  return (
    <>
      <OnboardingLayout
        step={4}
        showBack
        footer={
          <>
            <OnboardingPrimaryButton
              label="Connect Step Tracking"
              onPress={() => {
                completedRef.current = false;
                setShowSetup(true);
              }}
            />
            <OnboardingSecondaryButton
              label="Maybe Later"
              onPress={() => void continueNext("skipped")}
            />
          </>
        }
      >
        <OnboardingMascot source={ONBOARDING_ASSETS.healthConnect} />
        <Text style={styles.title}>
          {isIOS ? "Connect Apple Health" : "Connect Health Connect"}
        </Text>
        <Text style={styles.subtitle}>Sync verified steps automatically.</Text>
        <View style={styles.cards}>
          <OnboardingFeatureCard
            icon="refresh-cw"
            title="Automatic Sync"
            body="Your supported steps update WalkChamp."
          />
          <OnboardingFeatureCard
            icon="lock"
            title="Read-Only Access"
            body="WalkChamp reads only approved activity data."
          />
        </View>
      </OnboardingLayout>

      <WearableSetupModal
        visible={showSetup}
        accent="onboarding"
        onClose={() => setShowSetup(false)}
        onComplete={(_platform, permissionStatus) => {
          if (completedRef.current) return;
          completedRef.current = true;
          setShowSetup(false);
          if (permissionStatus === "connected") {
            // Allow all: HC already granted; request notifications + activity.
            void completeStepSetup({ allowAll: true }).finally(() => {
              void continueNext("accepted");
            });
            return;
          }
          void continueNext("denied");
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  title: {
    color: C.text,
    fontSize: rf(27),
    fontWeight: "900",
    textAlign: "center",
    marginTop: 4,
  },
  subtitle: {
    color: C.textSecondary,
    fontSize: rf(14.5),
    lineHeight: rf(19),
    textAlign: "center",
    marginTop: 2,
  },
  cards: { gap: 8, marginTop: 8 },
});
