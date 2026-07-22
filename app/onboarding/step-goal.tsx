import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import {
  OnboardingLayout,
  OnboardingMascot,
  OnboardingOptionRow,
  OnboardingPrimaryButton,
} from "@/components/onboarding/OnboardingUI";
import { ONBOARDING_ASSETS, ONBOARDING_COLORS, ONBOARDING_ROUTES } from "@/constants/onboarding";
import {
  DAILY_GOAL_OPTIONS,
  DEFAULT_DAILY_GOAL,
  getSelectedDailyGoal,
  setSelectedDailyGoal,
} from "@/utils/onboardingStorage";
import { rf } from "@/utils/responsive";

const C = ONBOARDING_COLORS;

export default function StepGoalScreen() {
  const [goal, setGoal] = useState(DEFAULT_DAILY_GOAL);

  useEffect(() => {
    void getSelectedDailyGoal().then((stored) => {
      const allowed = DAILY_GOAL_OPTIONS.some((o) => o.steps === stored);
      setGoal(allowed ? stored : DEFAULT_DAILY_GOAL);
    });
  }, []);

  const saveAndContinue = async () => {
    await setSelectedDailyGoal(goal);
    router.push(ONBOARDING_ROUTES.healthConnect);
  };

  return (
    <OnboardingLayout
      step={3}
      showBack
      footer={
        <OnboardingPrimaryButton
          label="Save Goal & Continue"
          onPress={() => void saveAndContinue()}
        />
      }
    >
      <OnboardingMascot source={ONBOARDING_ASSETS.stepGoal} />
      <Text style={styles.title}>Set Your Daily Step Goal</Text>
      <Text style={styles.subtitle}>Choose a target you can reach consistently.</Text>
      <View style={styles.list}>
        {DAILY_GOAL_OPTIONS.map((opt) => (
          <OnboardingOptionRow
            key={opt.steps}
            title={opt.label}
            recommended={opt.recommended}
            selected={goal === opt.steps}
            onPress={() => setGoal(opt.steps)}
          />
        ))}
      </View>
    </OnboardingLayout>
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
  list: { gap: 8, marginTop: 8 },
});
