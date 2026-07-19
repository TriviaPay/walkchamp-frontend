import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ChallengeEndsPillLabel } from "@/components/ChallengeEndsPillLabel";
import { SponsoredEventWindowLabel } from "@/components/SponsoredEventWindowLabel";

export type LiveTaglineAlt =
  | { kind: "ends"; label: string }
  | { kind: "sponsored"; start: string; end: string | null };

const HOLD_MS = 5000;
const FADE_MS = 500;

function AltContent({ alt }: { alt: LiveTaglineAlt }) {
  if (alt.kind === "ends") {
    return (
      <View style={styles.endsPill}>
        <Feather name="calendar" size={13} color="#FFFFFF" />
        <ChallengeEndsPillLabel label={alt.label} style={styles.endsPillText} />
      </View>
    );
  }
  return (
    <View style={styles.endsPill}>
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

/**
 * Start time (5s) ↔ Beat your friends (5s) with a reliable crossfade.
 * Uses one interval; frozen copy is read from a ref so parent re-renders
 * (1s clock ticks) do not cancel / restart the timer.
 */
export function LiveTaglineRotator({
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
  const raceKey = raceId ?? (alt ? `pending:${alt.kind}` : null);

  // Capture first non-null alt for this race; ignore later parent re-renders.
  useEffect(() => {
    if (!alt) return;
    if (frozenRef.current && raceKey) return;
    frozenRef.current = alt;
    setFrozen(alt);
  }, [alt, raceKey]);

  // Reset when race changes.
  useEffect(() => {
    frozenRef.current = alt;
    setFrozen(alt);
  }, [raceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const altOpacity = useRef(new Animated.Value(1)).current;
  const beatOpacity = useRef(new Animated.Value(0)).current;
  const showAltRef = useRef(true);
  const fadingRef = useRef(false);

  useEffect(() => {
    if (!visible) return;

    if (!frozen) {
      showAltRef.current = false;
      altOpacity.setValue(0);
      beatOpacity.setValue(1);
      return;
    }

    // Start on Start time for a full 5s.
    showAltRef.current = true;
    fadingRef.current = false;
    altOpacity.stopAnimation();
    beatOpacity.stopAnimation();
    altOpacity.setValue(1);
    beatOpacity.setValue(0);

    const crossfade = () => {
      if (fadingRef.current) return;
      fadingRef.current = true;
      const nextAlt = !showAltRef.current;
      showAltRef.current = nextAlt;

      Animated.parallel([
        Animated.timing(altOpacity, {
          toValue: nextAlt ? 1 : 0,
          duration: FADE_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(beatOpacity, {
          toValue: nextAlt ? 0 : 1,
          duration: FADE_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        fadingRef.current = false;
        if (!finished) {
          // Snap to intended end state if interrupted.
          altOpacity.setValue(nextAlt ? 1 : 0);
          beatOpacity.setValue(nextAlt ? 0 : 1);
        }
      });
    };

    const intervalId = setInterval(crossfade, HOLD_MS);

    return () => {
      clearInterval(intervalId);
      fadingRef.current = false;
      altOpacity.stopAnimation();
      beatOpacity.stopAnimation();
    };
  }, [visible, frozen, raceId, altOpacity, beatOpacity]);

  if (!visible) return null;

  if (!frozen) {
    return (
      <View style={styles.slot}>
        <BeatContent />
      </View>
    );
  }

  return (
    <View style={styles.slot}>
      <Animated.View
        pointerEvents="none"
        style={[styles.layer, { opacity: altOpacity }]}
      >
        <AltContent alt={frozen} />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[styles.layer, { opacity: beatOpacity }]}
      >
        <BeatContent />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    marginTop: 2,
    marginBottom: 6,
    paddingHorizontal: 16,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    width: "100%",
    overflow: "hidden",
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
