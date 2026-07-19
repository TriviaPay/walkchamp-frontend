import React, { memo, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { ChallengeEndsPillLabel } from "@/components/ChallengeEndsPillLabel";
import { SponsoredEventWindowLabel } from "@/components/SponsoredEventWindowLabel";

export type LiveTaglineAlt =
  | { kind: "ends"; label: string }
  | { kind: "sponsored"; start: string; end: string | null };

const HOLD_MS = 5000;
const FADE_MS = 800;

function AltContent({ alt }: { alt: LiveTaglineAlt }) {
  if (alt.kind === "ends") {
    return (
      <View style={styles.endsPill} collapsable={false}>
        <Feather name="calendar" size={13} color="#FFFFFF" />
        <ChallengeEndsPillLabel label={alt.label} style={styles.endsPillText} />
      </View>
    );
  }
  return (
    <View style={styles.endsPill} collapsable={false}>
      <Feather name="clock" size={13} color="#FFFFFF" />
      <SponsoredEventWindowLabel
        startIso={alt.start}
        endIso={alt.end}
        style={styles.endsPillText}
      />
    </View>
  );
}

function BeatContent() {
  return (
    <Text style={styles.subtitle} numberOfLines={1}>
      Beat your friends. Hit your goal!
    </Text>
  );
}

function altStableKey(alt: LiveTaglineAlt | null): string | null {
  if (!alt) return null;
  if (alt.kind === "ends") return `ends:${alt.label}`;
  return `sponsored:${alt.start}:${alt.end ?? ""}`;
}

/**
 * Start time (5s) ↔ Beat your friends (5s) with a real crossfade both ways.
 * Reanimated + memo so the live clock's 1s re-renders cannot interrupt opacity.
 */
function LiveTaglineRotatorInner({
  raceId,
  alt,
  visible,
}: {
  raceId: string | null;
  alt: LiveTaglineAlt | null;
  visible: boolean;
}) {
  const [frozen, setFrozen] = useState<LiveTaglineAlt | null>(alt);
  const frozenRef = useRef<LiveTaglineAlt | null>(alt);
  const animateKey = altStableKey(frozen);

  useEffect(() => {
    if (!alt) return;
    if (frozenRef.current && raceId) return;
    frozenRef.current = alt;
    setFrozen(alt);
  }, [alt, raceId]);

  useEffect(() => {
    frozenRef.current = alt;
    setFrozen(alt);
  }, [raceId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 0 = Start time, 1 = Beat your friends */
  const progress = useSharedValue(0);
  const showAltRef = useRef(true);
  const cancelledRef = useRef(false);

  const altStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
  }));
  const beatStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  useEffect(() => {
    if (!visible || !animateKey) {
      if (!animateKey && visible) {
        showAltRef.current = false;
        progress.value = 1;
      }
      return;
    }

    cancelledRef.current = false;
    showAltRef.current = true;
    cancelAnimation(progress);
    progress.value = 0;

    let holdTimeout: ReturnType<typeof setTimeout> | null = null;

    const clearHold = () => {
      if (holdTimeout) {
        clearTimeout(holdTimeout);
        holdTimeout = null;
      }
    };

    const afterFade = () => {
      if (cancelledRef.current) return;
      scheduleHold();
    };

    const runCrossfade = () => {
      if (cancelledRef.current) return;
      const nextAlt = !showAltRef.current;
      showAltRef.current = nextAlt;
      progress.value = withTiming(
        nextAlt ? 0 : 1,
        { duration: FADE_MS, easing: Easing.inOut(Easing.quad) },
        (finished) => {
          if (finished) runOnJS(afterFade)();
        },
      );
    };

    const scheduleHold = () => {
      clearHold();
      holdTimeout = setTimeout(runCrossfade, HOLD_MS);
    };

    scheduleHold();

    return () => {
      cancelledRef.current = true;
      clearHold();
      cancelAnimation(progress);
    };
  }, [visible, animateKey, raceId, progress]);

  if (!visible) return null;

  if (!frozen) {
    return (
      <View style={styles.slot}>
        <BeatContent />
      </View>
    );
  }

  return (
    <View style={styles.slot} collapsable={false}>
      <Animated.View
        pointerEvents="none"
        collapsable={false}
        needsOffscreenAlphaCompositing={Platform.OS === "android"}
        style={[styles.layer, altStyle]}
      >
        <AltContent alt={frozen} />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        collapsable={false}
        needsOffscreenAlphaCompositing={Platform.OS === "android"}
        style={[styles.layer, beatStyle]}
      >
        <BeatContent />
      </Animated.View>
    </View>
  );
}

export const LiveTaglineRotator = memo(LiveTaglineRotatorInner);

const styles = StyleSheet.create({
  slot: {
    marginTop: 2,
    marginBottom: 6,
    paddingHorizontal: 16,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    width: "100%",
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  subtitle: {
    fontSize: 12,
    color: "#64748B",
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 16,
    width: "100%",
  },
  endsPill: {
    alignSelf: "center",
    maxWidth: "100%",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#1E1535",
    borderWidth: 1,
    borderColor: "#3D2A6B",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  endsPillText: {
    color: "#F5F3FF",
    fontSize: 11.5,
    fontWeight: "600",
    textAlign: "center",
    flexShrink: 1,
  },
});
