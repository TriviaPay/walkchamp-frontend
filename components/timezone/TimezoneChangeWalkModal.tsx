/**
 * Streak timezone confirmation overlays (Image 2 stages 1–3).
 * Rendered on Walk as a blurred overlay — not a separate screen.
 * Does NOT include the “After Final Day Complete” modal.
 */
import React, { memo, useMemo } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { Feather } from "@expo/vector-icons";
import { useUnlimitedTimezone } from "@/context/UnlimitedTimezoneContext";
import { nextChallengeDayGuess } from "@/features/unlimited/mappers/unlimitedTimezoneChange";
import { rf } from "@/utils/responsive";

export const TimezoneChangeWalkModal = memo(function TimezoneChangeWalkModal() {
  const {
    modalStage,
    snapshot,
    deviceTimezone,
    lastChangeResult,
    confirming,
    confirmDeviceTimezone,
    keepCurrentTimezone,
    dismissModal,
  } = useUnlimitedTimezone();

  const visible = modalStage != null;
  const currentTz =
    lastChangeResult?.previousTimezone ||
    snapshot?.viewerTimezone ||
    "—";
  const newTz = lastChangeResult?.newTimezone || deviceTimezone;
  const effectiveDay =
    lastChangeResult?.effectiveChallengeDay ||
    (snapshot ? nextChallengeDayGuess(snapshot) : 1);

  const body = useMemo(() => {
    if (modalStage === "detect") {
      return (
        <>
          <View style={[styles.iconCircle, { backgroundColor: "rgba(59,130,246,0.18)" }]}>
            <Feather name="globe" size={28} color="#60A5FA" />
          </View>
          <Text style={styles.title}>Time Zone Change Detected</Text>
          <Text style={styles.label}>Your challenge is currently using</Text>
          <View style={styles.tzBox}>
            <Text style={styles.tzText}>{currentTz}</Text>
          </View>
          <Text style={[styles.label, { marginTop: 12 }]}>Your device is now using</Text>
          <View style={styles.tzBox}>
            <Text style={[styles.tzText, styles.tzNew]}>{newTz}</Text>
          </View>
          <Text style={styles.explain}>
            Day {Math.max(1, snapshot?.currentDayIndex ?? Math.max(1, effectiveDay - 1))} will continue using{" "}
            {currentTz}. If you confirm, {newTz} will be used starting from Day {effectiveDay}.
          </Text>
          <Pressable
            style={[styles.primaryBtn, styles.primaryGreen]}
            disabled={confirming}
            onPress={() => void confirmDeviceTimezone()}
          >
            {confirming ? (
              <ActivityIndicator color="#0A0A0A" />
            ) : (
              <Text style={styles.primaryGreenText}>Use {newTz} From Day {effectiveDay}</Text>
            )}
          </Pressable>
          <Pressable
            style={styles.secondaryBtn}
            disabled={confirming}
            onPress={() => keepCurrentTimezone()}
          >
            <Text style={styles.secondaryText}>Keep {currentTz}</Text>
          </Pressable>
        </>
      );
    }

    if (modalStage === "updated") {
      return (
        <>
          <View style={[styles.iconCircle, { backgroundColor: "rgba(0,230,118,0.18)" }]}>
            <Feather name="check" size={28} color="#00E676" />
          </View>
          <Text style={styles.title}>Time Zone Updated</Text>
          <Text style={styles.label}>Day {Math.max(1, (lastChangeResult?.currentChallengeDay ?? effectiveDay - 1))}</Text>
          <View style={styles.tzBox}>
            <Text style={styles.tzText}>{currentTz}</Text>
          </View>
          <Feather name="arrow-down" size={20} color="#A78BFA" style={{ marginVertical: 8 }} />
          <Text style={styles.label}>Starting Day {effectiveDay}</Text>
          <View style={styles.tzBox}>
            <Text style={[styles.tzText, styles.tzNew]}>{newTz}</Text>
          </View>
          <Text style={styles.explain}>
            Your current and previous challenge days will not be changed.
          </Text>
          <Pressable style={[styles.primaryBtn, styles.primaryGreen]} onPress={dismissModal}>
            <Text style={styles.primaryGreenText}>Got It</Text>
          </Pressable>
        </>
      );
    }

    if (modalStage === "final_day_locked") {
      return (
        <>
          <View style={[styles.iconCircle, { backgroundColor: "rgba(167,139,250,0.2)" }]}>
            <Feather name="lock" size={26} color="#A78BFA" />
          </View>
          <Text style={styles.title}>Final Day Time Zone Locked</Text>
          <Text style={styles.label}>Your final challenge day started using</Text>
          <View style={styles.tzBox}>
            <Text style={styles.tzText}>{currentTz}</Text>
          </View>
          <Text style={styles.explain}>
            Today&apos;s deadline will remain 11:59 PM {currentTz}.
          </Text>
          <Text style={[styles.explain, { marginTop: 8 }]}>
            {newTz} can be used for future challenges.
          </Text>
          <Pressable style={[styles.primaryBtn, styles.primaryPurple]} onPress={dismissModal}>
            <Text style={styles.primaryPurpleText}>Understood</Text>
          </Pressable>
        </>
      );
    }

    return null;
  }, [
    modalStage,
    currentTz,
    newTz,
    effectiveDay,
    confirming,
    confirmDeviceTimezone,
    keepCurrentTimezone,
    dismissModal,
    lastChangeResult,
    snapshot,
  ]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismissModal}>
      <View style={styles.root}>
        <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} />
        <Pressable style={StyleSheet.absoluteFill} onPress={dismissModal} />
        <View style={styles.card}>{body}</View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    backgroundColor: "rgba(4,8,18,0.45)",
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(120,140,180,0.35)",
    backgroundColor: "#0B1224",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 18,
    alignItems: "stretch",
  },
  iconCircle: {
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    color: "#FFFFFF",
    fontSize: rf(20),
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 14,
  },
  label: {
    color: "rgba(180,190,210,0.95)",
    fontSize: rf(13),
    textAlign: "center",
    marginBottom: 6,
  },
  tzBox: {
    backgroundColor: "#152038",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  tzText: {
    color: "#FFFFFF",
    fontSize: rf(15),
    fontWeight: "700",
  },
  tzNew: { color: "#00E676" },
  explain: {
    color: "rgba(160,174,200,0.95)",
    fontSize: rf(13),
    textAlign: "center",
    lineHeight: rf(18),
    marginTop: 14,
    marginBottom: 16,
  },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  primaryGreen: { backgroundColor: "#00E676" },
  primaryGreenText: {
    color: "#0A0A0A",
    fontSize: rf(14),
    fontWeight: "800",
    textAlign: "center",
    paddingHorizontal: 8,
  },
  primaryPurple: { backgroundColor: "#7C3AFF" },
  primaryPurpleText: {
    color: "#FFFFFF",
    fontSize: rf(15),
    fontWeight: "800",
  },
  secondaryBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#152038",
    borderWidth: 1,
    borderColor: "rgba(120,140,180,0.3)",
  },
  secondaryText: {
    color: "#FFFFFF",
    fontSize: rf(14),
    fontWeight: "700",
  },
});
