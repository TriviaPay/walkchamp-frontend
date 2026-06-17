/**
 * AnimatedTrackOverlay
 *
 * Renders lightweight animated particles + a colored glow on top of the
 * race track background image, below player avatars (zIndex 4).
 *
 * Rules:
 *  - pointerEvents="none"  →  never blocks taps
 *  - overflow: "hidden"    →  particles stay within the track bounds
 *  - Only opacity + translate transforms animated  →  no layout re-computation
 *  - All values initialized once on mount  →  no JS-bridge traffic during animation
 *  - AppState: animations auto-pause when app is backgrounded
 *  - reducedMotion: disables particles, keeps only a faint static glow
 */

import React, { memo, useEffect } from "react";
import { AppState, StyleSheet, Text, View, type DimensionValue } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import {
  DELAY_BY_LANE,
  DURATION_MULT,
  ENABLE_TRACK_THEME_ANIMATIONS,
  getFallbackAnimConfig,
  PARTICLE_X_PCT,
  START_Y_DOWN,
  START_Y_PULSE,
  START_Y_UP,
  THEME_ANIMATION_CONFIG,
  type ThemeAnimConfig,
} from "./themeAnimations";

// ── Glow layer ────────────────────────────────────────────────────────────────
const GlowLayer = memo(function GlowLayer({
  color,
  position,
  maxOpacity,
  reducedMotion,
}: {
  color: string;
  position: "bottom" | "top" | "both";
  maxOpacity: number;
  reducedMotion: boolean;
}) {
  const opacity = useSharedValue(reducedMotion ? maxOpacity * 0.5 : 0);

  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(opacity);
      opacity.value = withTiming(maxOpacity * 0.5, { duration: 400 });
      return;
    }
    opacity.value = withRepeat(
      withSequence(
        withTiming(maxOpacity, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
        withTiming(maxOpacity * 0.30, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [reducedMotion, maxOpacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const showBottom = position === "bottom" || position === "both";
  const showTop = position === "top" || position === "both";

  return (
    <>
      {showBottom && (
        <Animated.View pointerEvents="none" style={[gl.base, gl.bottom, animStyle]}>
          <LinearGradient
            colors={["transparent", color]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </Animated.View>
      )}
      {showTop && (
        <Animated.View pointerEvents="none" style={[gl.base, gl.top, animStyle]}>
          <LinearGradient
            colors={[color, "transparent"]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </Animated.View>
      )}
    </>
  );
});

const gl = StyleSheet.create({
  base: { position: "absolute", left: 0, right: 0, height: 90 },
  bottom: { bottom: 0 },
  top: { top: 0 },
});

// ── Single animated particle ───────────────────────────────────────────────────
interface ParticleProps {
  laneIndex: number;
  config: ThemeAnimConfig;
  colorIndex: number; // 0 = primary, 1 = secondary
}

const AnimatedParticle = memo(function AnimatedParticle({
  laneIndex,
  config,
  colorIndex,
}: ParticleProps) {
  const ty = useSharedValue(0);
  const op = useSharedValue(0);
  const tx = useSharedValue(0);
  const scale = useSharedValue(0.6);

  const duration = Math.round(config.baseDuration * DURATION_MULT[laneIndex]);
  const delay = DELAY_BY_LANE[laneIndex];
  const color = colorIndex === 0 ? config.primaryColor : config.secondaryColor;
  const size = config.particleSizeRange[0] +
    ((config.particleSizeRange[1] - config.particleSizeRange[0]) * (laneIndex % 4)) / 3;
  const isCircle = !config.hasSymbol;
  const isUpward = config.direction === "up";
  const isPulse = config.direction === "pulse";

  // Slight horizontal sway amount (varies by lane)
  const driftAmt = 10 + (laneIndex % 3) * 7;

  useEffect(() => {
    cancelAnimation(ty);
    cancelAnimation(op);
    cancelAnimation(tx);
    cancelAnimation(scale);

    ty.value = 0;
    op.value = 0;
    tx.value = 0;
    scale.value = 0.6;

    if (isPulse) {
      // Stars / city lights: just pulse opacity in place
      op.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(config.maxParticleOpacity, { duration: duration * 0.4 }),
            withTiming(config.maxParticleOpacity * 0.12, { duration: duration * 0.6 }),
          ),
          -1,
          true,
        ),
      );
      // Gentle scale pulse
      scale.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1.2, { duration: duration * 0.4 }),
            withTiming(0.45, { duration: duration * 0.6 }),
          ),
          -1,
          true,
        ),
      );
    } else {
      // Rising or falling particle
      const travel = isUpward ? -config.travelY : config.travelY;

      ty.value = withDelay(
        delay,
        withRepeat(
          withTiming(travel, { duration, easing: Easing.linear }),
          -1,
          false,
        ),
      );

      op.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(config.maxParticleOpacity, { duration: duration * 0.18 }),
            withTiming(config.maxParticleOpacity * 0.80, { duration: duration * 0.62 }),
            withTiming(0, { duration: duration * 0.20 }),
          ),
          -1,
          false,
        ),
      );

      // Gentle horizontal sway
      tx.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(driftAmt, { duration: duration * 0.5, easing: Easing.inOut(Easing.sin) }),
            withTiming(-driftAmt, { duration: duration * 0.5, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
          false,
        ),
      );
    }

    return () => {
      cancelAnimation(ty);
      cancelAnimation(op);
      cancelAnimation(tx);
      cancelAnimation(scale);
    };
  }, []);  // stable on mount only — config is stable for a given race

  // AppState: pause animations when backgrounded
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        cancelAnimation(ty);
        cancelAnimation(op);
        cancelAnimation(tx);
        cancelAnimation(scale);
      }
    });
    return () => sub.remove();
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [
      { translateY: ty.value },
      { translateX: tx.value },
      { scale: scale.value },
    ],
  }));

  // Determine starting Y position — cast to DimensionValue so RN accepts % strings
  const startY = (
    isPulse ? START_Y_PULSE[laneIndex]
    : isUpward ? START_Y_UP[laneIndex]
    : START_Y_DOWN[laneIndex]
  ) as DimensionValue;
  const startX = PARTICLE_X_PCT[laneIndex] as DimensionValue;

  if (config.hasSymbol) {
    const sym = config.symbols
      ? config.symbols[laneIndex % config.symbols.length]
      : (config.symbol ?? "·");
    return (
      <Animated.View
        pointerEvents="none"
        style={[pStyles.base, { left: startX, top: startY }, animStyle]}
      >
        <Text style={{ fontSize: size + 4, color, lineHeight: size + 6 }}>{sym}</Text>
      </Animated.View>
    );
  }

  // Bubble shapes: hollow circle outline (underwater, candy)
  const isBubble = config.direction === "up" && config.particleSizeRange[1] >= 10;
  if (isBubble) {
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          pStyles.base,
          {
            left: startX,
            top: startY,
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderColor: color,
            backgroundColor: color + "22",
          },
          animStyle,
        ]}
      />
    );
  }

  if (isCircle) {
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          pStyles.base,
          {
            left: startX,
            top: startY,
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
          },
          animStyle,
        ]}
      />
    );
  }

  return null;
});

const pStyles = StyleSheet.create({
  base: { position: "absolute" },
});

// ── Main component ─────────────────────────────────────────────────────────────
export interface AnimatedTrackOverlayProps {
  themeCode: string;
  isEnabled?: boolean;
  reducedMotion?: boolean;
  /** Optional: passed through for debug logging only — has no visual effect */
  raceStatus?: string;
  /** Optional: passed through for debug logging only — has no visual effect */
  isFullscreen?: boolean;
}

export const AnimatedTrackOverlay = memo(function AnimatedTrackOverlay({
  themeCode,
  isEnabled = true,
  reducedMotion = false,
  raceStatus,
  isFullscreen,
}: AnimatedTrackOverlayProps) {
  // Resolve config — fall back to keyword matching for unknown backend themes
  const config = THEME_ANIMATION_CONFIG[themeCode] ?? getFallbackAnimConfig(themeCode);
  const isFallback = !(themeCode in THEME_ANIMATION_CONFIG);

  useEffect(() => {
    if (!isEnabled || !ENABLE_TRACK_THEME_ANIMATIONS) return;
    if (__DEV__) {
      console.log(`[TrackAnimation] overlay mounted`);
      console.log(`[TrackAnimation] theme name: ${themeCode}`);
      console.log(`[TrackAnimation] theme id: ${themeCode}`);
      console.log(`[TrackAnimation] preset: ${isFallback ? "fallback (" + themeCode + ")" : themeCode}`);
      console.log(`[TrackAnimation] race status: ${raceStatus ?? "unknown"}`);
      console.log(`[TrackAnimation] fullscreen: ${isFullscreen ?? false}`);
      console.log(`[TrackAnimation] reduced motion: ${reducedMotion}`);
    }
    return () => {
      if (__DEV__) console.log(`[TrackAnimation] overlay unmounted: ${themeCode}`);
    };
  }, [themeCode, isEnabled, reducedMotion, raceStatus, isFullscreen]);

  if (!isEnabled || !ENABLE_TRACK_THEME_ANIMATIONS) return null;

  // Build lane indices for the configured particle count
  const laneIndices = Array.from({ length: config.particleCount }, (_, i) => i);

  return (
    <View
      pointerEvents="none"
      style={styles.overlay}
    >
      {/* Bottom / top glow */}
      <GlowLayer
        color={config.glowColor}
        position={config.glowPosition}
        maxOpacity={config.glowOpacity}
        reducedMotion={reducedMotion}
      />

      {/* Particles — hidden when reducedMotion is on */}
      {!reducedMotion &&
        laneIndices.map((i) => (
          <AnimatedParticle
            key={i}
            laneIndex={i}
            config={config}
            colorIndex={i % 2}
          />
        ))}
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
    overflow: "hidden",
  },
});
