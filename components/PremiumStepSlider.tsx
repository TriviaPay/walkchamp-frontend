/**
 * Premium stepped slider — compact discrete snap values.
 * PanResponder (same approach as DiscreteSliderPicker) for reliable drag in ScrollViews.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "@/utils/haptics";
import { rf, rs } from "@/utils/responsive";
import {
  indexOfDiscreteValue,
  ratioFromIndex,
} from "@/utils/premiumStepSliderMath";
import { CC, ROOM_ACCENT_THEMES } from "@/constants/createChallengeTheme";

const DEFAULT_THEME = ROOM_ACCENT_THEMES.private;

export type PremiumStepSliderProps<T> = {
  label?: string;
  helperText?: string;
  values: readonly T[];
  selectedValue: T;
  onValueChange: (value: T) => void;
  formatValue: (value: T) => string;
  minLabel?: string;
  maxLabel?: string;
  disabled?: boolean;
  accessibilityLabel: string;
  accent?: string;
  trackInactive?: string;
  labelColor?: string;
  helperColor?: string;
  surfaceColor?: string;
  borderColor?: string;
  footerNote?: string;
  hideLabel?: boolean;
  /** Optional leading icon tile */
  leading?: React.ReactNode;
  /** Active track gradient (falls back to solid accent) */
  trackGradient?: readonly [string, string, ...string[]];
  valuePillBorder?: string;
  valuePillBg?: string;
  valuePillText?: string;
  style?: StyleProp<ViewStyle>;
};

const THUMB = 16;
const TRACK_H = 5;
const HIT_H = 40;

function PremiumStepSliderInner<T>({
  label,
  helperText,
  values,
  selectedValue,
  onValueChange,
  formatValue,
  minLabel,
  maxLabel,
  disabled = false,
  accessibilityLabel,
  accent = DEFAULT_THEME.primary,
  trackInactive = CC.trackInactive,
  labelColor = CC.text,
  helperColor = CC.textSecondary,
  surfaceColor = CC.cardEntry,
  borderColor = CC.borderEntry,
  footerNote,
  hideLabel = false,
  leading,
  trackGradient = DEFAULT_THEME.gradientTrack,
  valuePillBorder = DEFAULT_THEME.valuePillBorder,
  valuePillBg = DEFAULT_THEME.valuePillBg,
  valuePillText = DEFAULT_THEME.valuePillText,
  style,
}: PremiumStepSliderProps<T>) {
  const count = Math.max(values.length, 1);
  const maxIdx = Math.max(1, count - 1);
  const trackRef = useRef<View>(null);
  const trackPageXRef = useRef(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const selectedIndex = indexOfDiscreteValue(values, selectedValue);

  const idxRef = useRef(selectedIndex);
  const [idx, setIdx] = useState(selectedIndex);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const onChangeRef = useRef(onValueChange);
  onChangeRef.current = onValueChange;
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const formatRef = useRef(formatValue);
  formatRef.current = formatValue;

  useEffect(() => {
    if (draggingRef.current) return;
    idxRef.current = selectedIndex;
    setIdx(selectedIndex);
  }, [selectedIndex]);

  const applyIndex = useCallback((nextIdx: number, fireHaptic: boolean) => {
    const list = valuesRef.current;
    const clamped = Math.max(0, Math.min(nextIdx, list.length - 1));
    const changed = clamped !== idxRef.current;
    idxRef.current = clamped;
    setIdx(clamped);
    const next = list[clamped];
    if (next !== undefined) onChangeRef.current(next);
    if (changed && fireHaptic) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const measureTrack = useCallback(() => {
    trackRef.current?.measureInWindow((x) => {
      if (Number.isFinite(x)) trackPageXRef.current = x;
    });
  }, []);

  const ratioFromPageX = useCallback(
    (pageX: number) => {
      if (trackWidth <= 0) return 0;
      return Math.max(0, Math.min(1, (pageX - trackPageXRef.current) / trackWidth));
    },
    [trackWidth],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onStartShouldSetPanResponderCapture: () => !disabled,
        onMoveShouldSetPanResponder: (_, g) =>
          !disabled && Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 1,
        onMoveShouldSetPanResponderCapture: (_, g) =>
          !disabled && Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 1,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (evt) => {
          draggingRef.current = true;
          measureTrack();
          const ratio = ratioFromPageX(evt.nativeEvent.pageX);
          setDragRatio(ratio);
          applyIndex(Math.round(ratio * maxIdx), true);
        },
        onPanResponderMove: (evt) => {
          const ratio = ratioFromPageX(evt.nativeEvent.pageX);
          setDragRatio(ratio);
          const nextIdx = Math.round(ratio * maxIdx);
          if (nextIdx !== idxRef.current) applyIndex(nextIdx, true);
        },
        onPanResponderRelease: (evt) => {
          const ratio = ratioFromPageX(evt.nativeEvent.pageX);
          draggingRef.current = false;
          setDragRatio(null);
          applyIndex(Math.round(ratio * maxIdx), true);
        },
        onPanResponderTerminate: (evt) => {
          const ratio = ratioFromPageX(evt.nativeEvent.pageX);
          draggingRef.current = false;
          setDragRatio(null);
          applyIndex(Math.round(ratio * maxIdx), false);
        },
      }),
    [disabled, ratioFromPageX, maxIdx, applyIndex, measureTrack],
  );

  const displayIdx =
    dragRatio != null
      ? Math.max(0, Math.min(Math.round(dragRatio * maxIdx), count - 1))
      : idx;
  const displayValue = formatRef.current(values[displayIdx] ?? selectedValue);
  const snappedRatio = ratioFromIndex(displayIdx, count);
  const displayRatio = dragRatio ?? snappedRatio;
  const thumbLeft =
    trackWidth > 0 ? displayRatio * Math.max(0, trackWidth - THUMB) : 0;
  const fillWidth = trackWidth > 0 ? Math.max(THUMB / 2, thumbLeft + THUMB / 2) : 0;

  const resolvedMin = minLabel ?? (values[0] !== undefined ? formatValue(values[0]) : "");
  const resolvedMax =
    maxLabel ??
    (values[count - 1] !== undefined ? formatValue(values[count - 1]!) : "");

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: surfaceColor, borderColor, opacity: disabled ? 0.5 : 1 },
        style,
      ]}
      accessibilityRole="adjustable"
      accessibilityLabel={`${accessibilityLabel}, ${displayValue}`}
      accessibilityValue={{
        min: 0,
        max: count - 1,
        now: displayIdx,
        text: `${displayValue} selected`,
      }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        if (disabled) return;
        if (event.nativeEvent.actionName === "increment") applyIndex(idxRef.current + 1, true);
        else if (event.nativeEvent.actionName === "decrement") applyIndex(idxRef.current - 1, true);
      }}
    >
      <View style={styles.header}>
        {leading ? <View style={styles.leading}>{leading}</View> : null}
        <View style={{ flex: 1, paddingRight: 8, minWidth: 0 }}>
          {!hideLabel && label ? (
            <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
          ) : null}
          {helperText ? (
            <Text
              style={[styles.helper, { color: helperColor, marginTop: hideLabel || !label ? 0 : 2 }]}
              numberOfLines={1}
            >
              {helperText}
            </Text>
          ) : null}
        </View>
        <View style={[styles.valuePill, { backgroundColor: valuePillBg, borderColor: valuePillBorder }]}>
          <Text style={[styles.valueText, { color: valuePillText }]}>{displayValue}</Text>
        </View>
      </View>

      <View
        ref={trackRef}
        style={styles.hitArea}
        onLayout={(e: LayoutChangeEvent) => {
          const w = e.nativeEvent.layout.width;
          if (w > 0 && Math.abs(w - trackWidth) > 0.5) setTrackWidth(w);
          measureTrack();
        }}
        {...panResponder.panHandlers}
      >
        <View style={[styles.track, { backgroundColor: trackInactive }]}>
          {fillWidth > 0 ? (
            <LinearGradient
              colors={[...trackGradient]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={[styles.fill, { width: fillWidth }]}
            />
          ) : null}
        </View>
        <View
          style={[
            styles.thumb,
            {
              left: thumbLeft,
              borderColor: accent,
              shadowColor: accent,
              shadowOpacity: dragRatio != null ? 0.45 : 0.28,
              transform: [{ scale: dragRatio != null ? 1.1 : 1 }],
            },
          ]}
        />
      </View>

      <View style={styles.rangeRow}>
        <Text style={[styles.rangeLabel, { color: helperColor }]}>{resolvedMin}</Text>
        <Text style={[styles.rangeLabel, { color: helperColor }]}>{resolvedMax}</Text>
      </View>

      {footerNote ? (
        <View style={styles.warningRow}>
          <Text style={styles.warningIcon}>⚠</Text>
          <Text style={[styles.footerNote, { color: helperColor }]}>{footerNote}</Text>
        </View>
      ) : null}
    </View>
  );
}

export const PremiumStepSlider = memo(PremiumStepSliderInner) as typeof PremiumStepSliderInner;

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderWidth: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 2,
  },
  leading: {
    width: 32,
    height: 32,
    borderRadius: 10,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: rf(13),
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  helper: {
    fontSize: rf(11),
    lineHeight: rs(15),
  },
  valuePill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: rs(8),
    paddingVertical: rs(3),
    alignSelf: "center",
  },
  valueText: {
    fontSize: rf(12),
    fontWeight: "800",
  },
  hitArea: {
    height: HIT_H,
    justifyContent: "center",
  },
  track: {
    height: TRACK_H,
    borderRadius: 999,
    overflow: "hidden",
    justifyContent: "center",
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
  },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: "#FFF",
    borderWidth: 2.5,
    top: (HIT_H - THUMB) / 2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  rangeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 0,
  },
  rangeLabel: {
    fontSize: rf(9),
    fontWeight: "600",
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 6,
  },
  warningIcon: {
    fontSize: rf(11),
    color: CC.warning,
    marginTop: 1,
  },
  footerNote: {
    fontSize: rf(10),
    lineHeight: 13,
    flex: 1,
  },
});

/** @deprecated Prefer getUnlimitedDailyGoalStepOptions from utils/unlimitedGoal. */
export { getUnlimitedDailyGoalStepOptions as buildDailyGoalSteps } from "@/utils/unlimitedGoal";
